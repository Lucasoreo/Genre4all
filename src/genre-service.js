/* Genre4all genre resolver (v1.11). Priority: Discogs -> MusicBrainz (+ Spotify) -> Spotify. */
const Genre4allGenres = (() => {
  'use strict';
  const PROVIDERS = Object.freeze(['discogs', 'musicbrainz', 'spotify']);
  const STATUSES = Object.freeze(['success', 'empty', 'no_match', 'not_configured', 'unsupported', 'rate_limited', 'error', 'cancelled']);
  const HOUR = 3600000;
  const TTL = { discogs: 30 * 24 * HOUR, musicbrainz: 30 * 24 * HOUR, spotify: HOUR };
  const CACHE_VERSION = 2;
  const CACHE_LIMIT = 2000;
  const clone = typeof structuredClone === 'function' ? value => structuredClone(value) : value => JSON.parse(JSON.stringify(value));
  const identityCache = new WeakMap();
  const key = value => String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  const matchText = value => key(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const defaultConfig = () => ({
    version: 2,
    order: [...PROVIDERS],
    enabled: Object.fromEntries(PROVIDERS.map(p => [p, true])),
    showGenres: true,
    showStyles: true,
    colors: true,
    discogsToken: '',
    musicbrainzToken: ''
  });
  function configFrom(value) {
    const v = value && typeof value === 'object' ? value : {};
    const defaults = defaultConfig();
    const validOrder = v.version >= 2 && Array.isArray(v.order) ? v.order.filter(p => PROVIDERS.includes(p)) : [];
    return {
      ...defaults,
      order: [...new Set([...validOrder, ...PROVIDERS])],
      enabled: Object.fromEntries(PROVIDERS.map(p => [p, typeof v.enabled?.[p] === 'boolean' ? v.enabled[p] : true])),
      showGenres: v.showGenres !== false,
      showStyles: v.showStyles !== false,
      colors: v.colors !== false,
      discogsToken: typeof v.discogsToken === 'string' ? v.discogsToken.trim() : '',
      musicbrainzToken: typeof v.musicbrainzToken === 'string' ? v.musicbrainzToken.trim() : ''
    };
  }
  /** @typedef {{key:string,label:string,kind:'genre'|'style'|'tag',kinds?:string[],rawValue:string,provider?:string}} GenreLabel */
  /** @typedef {{provider:string,status:string,labels:GenreLabel[],entityType?:string,entityId?:string,sourceUrl?:string,fetchedAt?:number,expiresAt?:number,match?:{method:string,explanation:string,accepted:boolean},retryAt?:number,errorCode?:string}} ProviderResult */
  function labelsFrom(values, kind = 'genre', provider = undefined) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).flatMap(raw => {
      const text = typeof raw === 'string' ? raw : (raw?.label ?? raw?.name);
      if (typeof text !== 'string' || !text.trim() || /[\u0000-\u001f]/u.test(text)) return [];
      const k = key(text);
      const itemKind = (typeof raw === 'object' && raw?.kind) ? raw.kind : kind;
      if (seen.has(`${k}:${itemKind}`)) return [];
      seen.add(`${k}:${itemKind}`);
      const itemProvider = (typeof raw === 'object' && raw?.provider) ? raw.provider : provider;
      return [{
        key: k,
        label: text.trim().replace(/\s+/gu, ' '),
        kind: itemKind,
        rawValue: typeof raw === 'object' && typeof raw?.rawValue === 'string' ? raw.rawValue : text,
        ...(itemProvider ? { provider: itemProvider } : {})
      }];
    });
  }
  function dedupeLabels(values) {
    const seen = new Map();
    for (const label of values) {
      const kinds = label.kinds || [label.kind];
      if (seen.has(label.key)) {
        const existing = seen.get(label.key);
        existing.kinds = [...new Set([...existing.kinds, ...kinds])];
      } else {
        seen.set(label.key, { ...label, kinds: [...kinds] });
      }
    }
    return [...seen.values()];
  }
  function sortLabelsByKind(values) {
    const genres = [], styles = [];
    for (const label of values) {
      if (label.kind === 'genre') genres.push(label);
      else styles.push(label);
    }
    return [...genres, ...styles];
  }
  // Discogs top-level genres are broad umbrella categories (Electronic, Pop, Rock...).
  // Promote the most specific style/subgenre (Electro, Techno, Deep House...) to primary
  // while keeping the umbrella genre in the expandable list.
  const VAGUE_STYLES = new Set(['vocal', 'instrumental', 'ballad', 'novelty', 'soundtrack', 'score', 'theme', 'spoken word', 'interview', 'comedy', 'dialogue', 'medley', 'education', 'field recording', 'promotional', 'non-music']);
  const UMBRELLA_GENRES = new Set(['electronic', 'eletronica', 'eletrônica', 'electronica', 'pop', 'rock', 'hip hop', 'hip-hop', 'funk / soul', 'latin', 'jazz', 'reggae', 'classical', 'blues', 'folk, world, & country', 'stage & screen', 'non-music']);
  function promoteSpecificPrimary(values) {
    if (!Array.isArray(values) || values.length < 2) return values;
    const genres = [], styles = [];
    for (const label of values) {
      if (label.kind === 'genre') genres.push(label);
      else styles.push(label);
    }
    if (styles.length) {
      const bestStyle = styles.find(s => !VAGUE_STYLES.has(s.key) && !UMBRELLA_GENRES.has(s.key));
      if (bestStyle) return [bestStyle, ...genres, ...styles.filter(s => s !== bestStyle)];
    }
    if (genres.length > 1 && UMBRELLA_GENRES.has(genres[0].key)) {
      const specificGenre = genres.find(g => !UMBRELLA_GENRES.has(g.key) && !VAGUE_STYLES.has(g.key));
      if (specificGenre) return [specificGenre, ...genres.filter(g => g !== specificGenre), ...styles];
    }
    return [...genres, ...styles];
  }
  function orderProviderLabels(provider, values) {
    if (provider === 'spotify') return values;
    const sorted = sortLabelsByKind(values);
    return provider === 'discogs' ? promoteSpecificPrimary(sorted) : sorted;
  }
  function identityFor(track) {
    const t = track && typeof track === 'object' ? track : {};
    const metadata = t.metadata || {};
    const rawTitle = String(t.name || t.title || metadata.title || '').trim();
    const rawUri = String(t.uri || '');
    const rawIsrcField = String(t.external_ids?.isrc || t.isrc || t.track?.external_ids?.isrc || '');
    if (track && typeof track === 'object') {
      const hit = identityCache.get(track);
      if (hit && hit.uri === rawUri && hit.title === rawTitle && hit.isrc === rawIsrcField) return hit.value;
    }
    const title = rawTitle;
    const artists = (t.artists?.length ? t.artists.map(a => typeof a === 'string' ? a : a.name) : [t.artistName || metadata.artist_name]).filter(Boolean).map(String);
    const uri = rawUri;
    const durationValue = Number(t.duration_ms || t.durationMs || t.duration?.milliseconds || t.duration?.totalMilliseconds || (typeof t.duration === 'number' ? t.duration : null) || metadata.duration);
    const durationMs = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : null;
    const album = String(t.album?.name || t.albumName || metadata.album_title || '').trim();
    const rawIsrc = rawIsrcField.toUpperCase();
    const isrc = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/u.test(rawIsrc) ? rawIsrc : '';
    const version = versionOf(title);
    const value = {
      uri, title, artists, durationMs, album, isrc, version,
      key: JSON.stringify([uri, key(title), artists.map(key), durationMs, key(album), isrc, version])
    };
    if (track && typeof track === 'object') identityCache.set(track, { uri: rawUri, title: rawTitle, isrc: rawIsrcField, value });
    return value;
  }
  // Do not strip version text for matching. Distinct remix names remain distinct titles.
  function versionOf(title) {
    const text = matchText(title);
    if (/\bradio\b/u.test(text)) return 'radio';
    if (/\bremix\b|\brework\b|\bmashup\b/u.test(text)) return 'remix';
    if (/\bextended\b/u.test(text)) return 'extended';
    if (/\blive\b/u.test(text)) return 'live';
    if (/\bedit\b/u.test(text)) return 'edit';
    if (/\bacoustic\b/u.test(text)) return 'acoustic';
    if (/\binstrumental\b/u.test(text)) return 'instrumental';
    return 'original';
  }
  function matchRecording(identity, candidate) {
    if (matchText(identity.title) !== matchText(candidate.title) || versionOf(candidate.title) !== identity.version) return false;
    const artists = candidate.artists || [];
    if (!artists.length || !identity.artists.length) return false;
    const names = new Set(artists.map(a => matchText(String(typeof a === 'string' ? a : a.name).replace(/\s*\(\d+\)$/u, ''))));
    if (!identity.artists.every(a => names.has(matchText(a)))) return false;
    const length = candidate.durationMs;
    if (identity.durationMs && length && Math.abs(identity.durationMs - length) > Math.min(4000, Math.max(2000, identity.durationMs * 0.01))) return false;
    if (identity.isrc && candidate.isrcs?.length && !candidate.isrcs.includes(identity.isrc)) return false;
    return true;
  }
  const accepted = (method, explanation) => ({ method, explanation, accepted: true });
  class GenreError extends Error {
    constructor(status, code, retryAt) { super(code); this.status = status; this.code = code; this.retryAt = retryAt; }
  }
  const cancelled = () => new GenreError('cancelled', 'CANCELLED');
  function checkAbort(signal) { if (signal?.aborted) throw cancelled(); }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      checkAbort(signal);
      const timer = setTimeout(done, Math.max(0, ms));
      function done() { signal?.removeEventListener('abort', abort); resolve(); }
      function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(cancelled()); }
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  // Shared operations have independent subscribers. Abort only after the last subscriber leaves.
  function subscribe(map, id, work, signal) {
    if (signal?.aborted) return Promise.reject(cancelled());
    let entry = map.get(id);
    if (!entry || entry.controller.signal.aborted) {
      entry = { controller: new AbortController(), users: 0 };
      map.set(id, entry);
      entry.promise = new Promise((resolve, reject) => {
        const abort = () => { entry.controller.signal.removeEventListener('abort', abort); reject(cancelled()); };
        entry.controller.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => { checkAbort(entry.controller.signal); return work(entry.controller.signal); }).then(
          value => { entry.controller.signal.removeEventListener('abort', abort); resolve(value); },
          error => { entry.controller.signal.removeEventListener('abort', abort); reject(error); }
        );
      }).finally(() => { if (map.get(id) === entry) map.delete(id); });
    }
    entry.users++;
    return new Promise((resolve, reject) => {
      let finished = false;
      function finish(fn, value) {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', abort);
        entry.users--;
        if (!entry.users) { entry.controller.abort(); if (map.get(id) === entry) map.delete(id); }
        fn(value);
      }
      function abort() { finish(reject, cancelled()); }
      signal?.addEventListener('abort', abort, { once: true });
      entry.promise.then(v => finish(resolve, v), e => finish(reject, e));
    });
  }
  function createLimiter(interval, { now = Date.now, wait = sleep, maxQueue = 64 } = {}) {
    let tail = Promise.resolve(), pending = 0, nextAt = 0, blockedUntil = 0, spacing = interval;
    return {
      block(until) { if (Number.isFinite(until)) blockedUntil = Math.max(blockedUntil, until); },
      unblock() { blockedUntil = 0; },
      isBlocked() { return now() < blockedUntil; },
      isBusy() { return pending > 0 || nextAt > now() + 50; },
      get blockedUntil() { return blockedUntil; },
      setSpacing(ms) { if (Number.isFinite(ms) && ms > 0) { spacing = Math.max(interval, ms); nextAt = Math.max(nextAt, now() + spacing); } },
      async run(work, signal) {
        checkAbort(signal);
        if (now() < blockedUntil) throw new GenreError('rate_limited', 'RATE_LIMITED', blockedUntil);
        if (pending >= maxQueue) throw new GenreError('error', 'QUEUE_FULL');
        pending++;
        const result = tail.then(async () => {
          checkAbort(signal);
          if (now() < blockedUntil) throw new GenreError('rate_limited', 'RATE_LIMITED', blockedUntil);
          if (nextAt > now() + spacing) nextAt = now() + spacing;
          await wait(Math.max(0, nextAt - now()), signal);
          checkAbort(signal);
          if (now() < blockedUntil) throw new GenreError('rate_limited', 'RATE_LIMITED', blockedUntil);
          nextAt = now() + spacing;
          return work();
        }).finally(() => pending--);
        tail = result.catch(() => {});
        return result;
      },
      get pending() { return pending; }
    };
  }
  function retryTime(value, now) {
    if (!value) return now + 60000;
    const number = Number(value);
    return Math.max(now, Number.isFinite(number) ? now + number * 1000 : (Date.parse(value) || now + 60000));
  }
  // Protobuf decoder for Spotify MetadataService extensionKind 6 (track concepts).
  function decodeConcepts(raw) {
    if (raw == null) return [];
    let bytes;
    if (raw instanceof Uint8Array) bytes = raw;
    else if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
    else {
      const values = Array.isArray(raw) ? raw : (typeof raw === 'object' ? Object.values(raw) : null);
      if (!values || values.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new GenreError('error', 'SPOTIFY_BUFFER_INVALID');
      bytes = new Uint8Array(values);
    }
    if (bytes.byteLength === 0) return [];
    let pos = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const fail = () => { throw new GenreError('error', 'SPOTIFY_BUFFER_INVALID'); };
    function int(end) {
      let n = 0, factor = 1;
      for (let i = 0; i < 10 && pos < end; i++) {
        const b = bytes[pos++];
        n += (b & 127) * factor;
        if (!(b & 128)) return n;
        factor *= 128;
      }
      return fail();
    }
    function skip(wire, end) {
      if (wire === 0) int(end);
      else if (wire === 1) pos += 8;
      else if (wire === 5) pos += 4;
      else if (wire === 2) { const len = int(end); pos += len; }
      else fail();
      if (pos > end) fail();
    }
    const out = [];
    while (pos < bytes.length) {
      const tag = int(bytes.length), field = Math.floor(tag / 8), wire = tag % 8;
      if (!field) fail();
      if (field !== 1 || wire !== 2) { skip(wire, bytes.length); continue; }
      const len = int(bytes.length), end = pos + len;
      if (end > bytes.length) fail();
      let rawValue = '', score;
      while (pos < end) {
        const sub = int(end), f = Math.floor(sub / 8), w = sub % 8;
        if (!f) fail();
        if (f === 1 && w === 2) {
          const size = int(end);
          if (pos + size > end) fail();
          rawValue = decoder.decode(bytes.subarray(pos, pos + size));
          pos += size;
        } else if (f === 2 && (w === 5 || w === 1)) {
          const size = w === 5 ? 4 : 8;
          if (pos + size > end) fail();
          const view = new DataView(bytes.buffer, bytes.byteOffset + pos, size);
          score = size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
          if (!Number.isFinite(score)) fail();
          pos += size;
        } else skip(w, end);
      }
      const name = rawValue.replace(/^spotify:concept:/iu, '').replace(/_/gu, ' ').trim();
      if (name && key(name) !== 'track') out.push({ name, rawValue, ...(score === undefined ? {} : { score }) });
    }
    if (out.some(item => item.score !== undefined)) {
      const byName = new Map();
      for (const item of out) {
        const k = key(item.name);
        const prev = byName.get(k);
        if (!prev || (item.score ?? 0) > (prev.score ?? 0)) byName.set(k, item);
      }
      return [...byName.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }
    return out;
  }
  function createService(options = {}) {
    const now = options.now || (() => Date.now());
    const storage = options.storage || { async get() {}, async set() {}, async remove() {}, async clear() {}, async entries() { return []; } };
    const providerCache = new Map(), resolved = new Map(), inflight = new Map(), pinnedGenres = new Map();
    const PINNED_STORAGE_KEY = 'genre4all-pinned-genres-v1';
    try {
      const rawPinned = globalThis.localStorage?.getItem?.(PINNED_STORAGE_KEY);
      if (rawPinned) {
        for (const line of rawPinned.split('\n')) {
          const tab = line.indexOf('\t');
          if (tab > 0) pinnedGenres.set(line.slice(0, tab), line.slice(tab + 1));
        }
      }
    } catch { /* Ignore localStorage read errors. */ }
    function persistPinnedGenres() {
      while (pinnedGenres.size > CACHE_LIMIT) pinnedGenres.delete(pinnedGenres.keys().next().value);
      const obj = Object.fromEntries(pinnedGenres);
      write('settings', 'genre-pinned-v1', obj);
      try {
        const txt = [...pinnedGenres.entries()].map(([k, v]) => `${String(k).replace(/[\t\n\r]/gu, ' ')}\t${String(v).replace(/[\t\n\r]/gu, ' ')}`).join('\n');
        globalThis.localStorage?.setItem?.(PINNED_STORAGE_KEY, txt);
      } catch { /* Ignore quota errors. */ }
    }
    function getPinnedKey(identity) {
      if (!identity) return null;
      return (identity.uri && pinnedGenres.get(identity.uri)) || (identity.key && pinnedGenres.get(identity.key)) || null;
    }
    function applyPinnedOrder(labels, identity) {
      if (!Array.isArray(labels) || !labels.length) return labels;
      const pKey = getPinnedKey(identity);
      if (!pKey) return labels;
      const idx = labels.findIndex(l => l.key === pKey);
      if (idx < 0) return labels;
      const next = labels.map((l, i) => {
        if (i === idx) return { ...l, pinned: true };
        if (l.pinned) { const copy = { ...l }; delete copy.pinned; return copy; }
        return l;
      });
      if (idx > 0) {
        const [picked] = next.splice(idx, 1);
        next.unshift(picked);
      }
      return next;
    }
    const intervals = { discogs: options.discogsInterval ?? 1100, musicbrainz: options.musicbrainzInterval ?? 1150, spotify: options.spotifyInterval ?? 25 };
    const limiters = Object.fromEntries(PROVIDERS.map(p => [p, createLimiter(intervals[p] ?? 25, { now, wait: options.wait, maxQueue: 256 })]));
    let config = defaultConfig(), revision = 1, closed = false;
    let persistence = Promise.resolve(), cacheMutation = Promise.resolve(), expiryTimer = null, nextExpiryAt = Infinity;
    const changes = new Set();
    function write(space, id, value) { const operation = persistence.then(() => storage.set(space, id, clone(value))); persistence = operation.catch(() => {}); return operation; }
    function remove(space, id) { const operation = persistence.then(() => storage.remove(space, id)); persistence = operation.catch(() => {}); return operation; }
    const ready = (async () => {
      const savedConfig = await storage.get('settings', 'genre-selector-v1');
      config = configFrom(savedConfig);
      if (savedConfig && savedConfig.version !== config.version) write('settings', 'genre-selector-v1', config);
      const savedPinned = await storage.get('settings', 'genre-pinned-v1');
      if (savedPinned && typeof savedPinned === 'object') {
        for (const [k, v] of Object.entries(savedPinned)) {
          if (typeof k === 'string' && typeof v === 'string' && v && !pinnedGenres.has(k)) pinnedGenres.set(k, v);
        }
      }
      for (const [id, entry] of await storage.entries('cache')) {
        if (entry?.version === CACHE_VERSION && entry.value && typeof entry.value === 'object' && Number.isFinite(entry.expiresAt) && entry.expiresAt > now() && PROVIDERS.some(p => id.startsWith(`provider:${p}:`))) {
          providerCache.set(id, entry);
        } else await storage.remove('cache', id);
      }
      while (providerCache.size > CACHE_LIMIT) { const id = providerCache.keys().next().value; providerCache.delete(id); await storage.remove('cache', id); }
      armExpiry();
    })();
    function notify() { for (const fn of changes) fn(); }
    function armExpiry(candidateExpiry) {
      if (closed) return;
      if (Number.isFinite(candidateExpiry) && expiryTimer !== null && candidateExpiry >= nextExpiryAt) return;
      clearTimeout(expiryTimer);
      expiryTimer = null;
      nextExpiryAt = Infinity;
      let expiry = Infinity;
      for (const v of providerCache.values()) if (Number.isFinite(v.expiresAt) && v.expiresAt < expiry) expiry = v.expiresAt;
      for (const v of resolved.values()) if (Number.isFinite(v.expiresAt) && v.expiresAt < expiry) expiry = v.expiresAt;
      if (!Number.isFinite(expiry)) return;
      nextExpiryAt = expiry;
      expiryTimer = setTimeout(async () => {
        expiryTimer = null;
        nextExpiryAt = Infinity;
        let expiredAny = false;
        try {
          for (const [id, entry] of providerCache) if (entry.expiresAt <= now()) {
            providerCache.delete(id); expiredAny = true; await remove('cache', id);
          }
          for (const [id, entry] of resolved) if (entry.expiresAt <= now()) {
            resolved.delete(id); expiredAny = true;
          }
        } catch { /* Reads check expiry too. */ }
        finally { armExpiry(); if (expiredAny) notify(); }
      }, Math.min(Math.max(1, expiry - now()), 2147483647));
      expiryTimer.unref?.();
    }
    function invalidate() {
      revision++; resolved.clear();
      for (const entry of inflight.values()) entry.controller.abort();
      inflight.clear();
      notify();
    }
    function mutateCache(work) {
      const operation = cacheMutation.then(async () => { await persistence; await work(); });
      cacheMutation = operation.catch(() => {});
      invalidate();
      return operation;
    }
    async function cachePut(map, id, value, expiresAt) {
      const entry = { version: CACHE_VERSION, expiresAt, value: clone(value) };
      map.set(id, entry);
      while (map.size > CACHE_LIMIT) { const oldest = map.keys().next().value; map.delete(oldest); remove('cache', oldest); }
      write('cache', id, entry);
      armExpiry(expiresAt);
    }
    async function cacheGet(map, id) {
      const item = map.get(id);
      if (!item) return null;
      if (item.expiresAt <= now()) { map.delete(id); remove('cache', id); return null; }
      return clone(item.value);
    }
    function failure(provider, error) {
      const e = error instanceof GenreError ? error : new GenreError('error', 'REQUEST_FAILED');
      const retryAt = e.retryAt || (provider && limiters[provider]?.blockedUntil > now() ? limiters[provider].blockedUntil : undefined);
      return { provider, status: e.status, labels: [], errorCode: e.code, ...(retryAt ? { retryAt } : {}) };
    }
    function response(provider, state, labels = [], fields = {}) {
      return { provider, status: state, labels: dedupeLabels(labels), fetchedAt: now(), expiresAt: now() + (TTL[provider] || HOUR), ...fields };
    }
    function blockOnError(limiter, e) {
      if (e instanceof GenreError) {
        if (e.status === 'cancelled') return;
        if (e.retryAt) limiter.block(e.retryAt);
        else if (e.status === 'rate_limited') limiter.block(now() + 60000);
        else if (e.status === 'error') limiter.block(now() + 20000);
      } else {
        limiter.block(now() + 20000);
      }
    }
    async function discogs(identity, signal) {
      if (!options.discogs || (typeof options.discogs.isConfigured === 'function' && !options.discogs.isConfigured())) {
        return failure('discogs', new GenreError('not_configured', 'DISCOGS_TOKEN_REQUIRED'));
      }
      if (!identity.title || !identity.artists?.length) return failure('discogs', new GenreError('unsupported', 'TRACK_METADATA_REQUIRED'));
      let data;
      try {
        const runStep = work => limiters.discogs.run(work, signal);
        if (options.discogs.usesStepLimiter) {
          if (limiters.discogs.isBlocked()) throw new GenreError('rate_limited', 'RATE_LIMITED', limiters.discogs.blockedUntil);
          try {
            data = await options.discogs(identity, signal, runStep);
            if (data?.rateLimitExhaustedUntil) limiters.discogs.block(data.rateLimitExhaustedUntil);
          } catch (err) {
            blockOnError(limiters.discogs, err);
            throw err;
          }
        } else {
          data = await limiters.discogs.run(async () => {
            try {
              const res = await options.discogs(identity, signal);
              if (res?.rateLimitExhaustedUntil) limiters.discogs.block(res.rateLimitExhaustedUntil);
              return res;
            } catch (err) {
              blockOnError(limiters.discogs, err);
              throw err;
            }
          }, signal);
        }
      } catch (e) {
        throw e instanceof GenreError ? e : new GenreError('error', 'DISCOGS_REQUEST_FAILED');
      }
      checkAbort(signal);
      if (!data) return response('discogs', 'no_match', []);
      const rawGenres = Array.isArray(data.genres) ? data.genres : (Array.isArray(data.genre) ? data.genre : []);
      const rawStyles = Array.isArray(data.styles) ? data.styles : (Array.isArray(data.style) ? data.style : []);
      const genreLabels = labelsFrom(rawGenres, 'genre', 'discogs');
      const styleLabels = labelsFrom(rawStyles, 'style', 'discogs');
      if (!genreLabels.length && styleLabels.length) {
        if (options.formatSpotifyGenres) {
          const derived = labelsFrom(options.formatSpotifyGenres(styleLabels.map(s => ({ name: s.label, rawValue: s.rawValue }))), 'genre', 'discogs').filter(l => l.kind === 'genre');
          if (derived.length) genreLabels.push(...derived);
          else styleLabels[0].kind = 'genre';
        } else {
          styleLabels[0].kind = 'genre';
        }
      }
      const labels = orderProviderLabels('discogs', dedupeLabels([...genreLabels, ...styleLabels]));
      return response('discogs', labels.length ? 'success' : 'empty', labels, {
        entityType: data.entityType || 'release',
        entityId: data.entityId || identity.key,
        sourceUrl: data.sourceUrl || 'https://www.discogs.com',
        validationRule: 'discogs-search-v1',
        match: accepted('discogs-search', 'Gêneros e subgêneros obtidos do Discogs.')
      });
    }
    async function musicbrainz(identity, signal) {
      if (!options.musicbrainz || (typeof options.musicbrainz.isConfigured === 'function' && !options.musicbrainz.isConfigured())) {
        return failure('musicbrainz', new GenreError('not_configured', 'MUSICBRAINZ_UNAVAILABLE'));
      }
      if (!identity.isrc && (!identity.title || !identity.artists?.length)) return failure('musicbrainz', new GenreError('unsupported', 'TRACK_METADATA_REQUIRED'));
      let data;
      try {
        const runStep = work => limiters.musicbrainz.run(work, signal);
        if (options.musicbrainz.usesStepLimiter) {
          if (limiters.musicbrainz.isBlocked()) throw new GenreError('rate_limited', 'RATE_LIMITED', limiters.musicbrainz.blockedUntil);
          try {
            data = await options.musicbrainz(identity, signal, runStep);
          } catch (err) {
            blockOnError(limiters.musicbrainz, err);
            throw err;
          }
        } else {
          data = await limiters.musicbrainz.run(async () => {
            try {
              return await options.musicbrainz(identity, signal);
            } catch (err) {
              blockOnError(limiters.musicbrainz, err);
              throw err;
            }
          }, signal);
        }
      } catch (e) {
        throw e instanceof GenreError ? e : new GenreError('error', 'MUSICBRAINZ_REQUEST_FAILED');
      }
      checkAbort(signal);
      if (!data) return response('musicbrainz', 'no_match', []);
      await options.prepareSpotifyGenres?.();
      checkAbort(signal);
      const rawGenres = Array.isArray(data.genres) ? data.genres : [];
      const rawTags = Array.isArray(data.styles) ? data.styles : (Array.isArray(data.tags) ? data.tags : []);
      const validTags = rawTags.filter(t => {
        const name = typeof t === 'string' ? t : t?.name;
        if (!name || typeof name !== 'string') return false;
        return options.validateSpotifyGenre ? options.validateSpotifyGenre(name, 1) === true : true;
      });
      const genreLabels = labelsFrom(rawGenres, 'genre', 'musicbrainz');
      const styleLabels = labelsFrom(validTags, 'style', 'musicbrainz');
      if (!genreLabels.length && styleLabels.length) {
        if (options.formatSpotifyGenres) {
          const formatted = labelsFrom(options.formatSpotifyGenres(styleLabels.map(s => ({ name: s.label, rawValue: s.rawValue }))), 'genre', 'musicbrainz');
          const derivedGenres = formatted.filter(l => l.kind === 'genre');
          if (derivedGenres.length) genreLabels.push(...derivedGenres);
          else styleLabels[0].kind = 'genre';
        } else {
          styleLabels[0].kind = 'genre';
        }
      }
      const labels = sortLabelsByKind(dedupeLabels([...genreLabels, ...styleLabels]));
      return response('musicbrainz', labels.length ? 'success' : 'empty', labels, {
        entityType: data.entityType || 'recording',
        entityId: data.entityId || identity.key,
        sourceUrl: data.sourceUrl || 'https://musicbrainz.org',
        validationRule: 'musicbrainz-ws2-v1',
        match: accepted('musicbrainz-ws2', 'Gêneros e subgêneros obtidos do MusicBrainz.')
      });
    }
    async function spotify(identity, signal) {
      if (!identity.uri.startsWith('spotify:track:') || !options.spotify) return failure('spotify', new GenreError('unsupported', 'SPOTIFY_TRACK_REQUIRED'));
      let concepts;
      try { concepts = await limiters.spotify.run(() => options.spotify(identity.uri, signal), signal); }
      catch (e) { throw e instanceof GenreError ? e : new GenreError('error', 'SPOTIFY_METADATA_FAILED'); }
      checkAbort(signal);
      if (!Array.isArray(concepts)) throw new GenreError('error', 'SPOTIFY_RESPONSE_INVALID');
      await options.prepareSpotifyGenres?.();
      checkAbort(signal);
      const valid = concepts.filter(c => {
        if (!c || typeof c.name !== 'string') return false;
        if (Number.isFinite(c.score) && (c.score * 100) <= 5) return false;
        return options.validateSpotifyGenre ? options.validateSpotifyGenre(c.name, c.score) === true : true;
      });
      const formatted = options.formatSpotifyGenres
        ? options.formatSpotifyGenres(valid)
        : labelsFrom(valid.map(c => c.name), 'genre', 'spotify');
      const labels = Array.isArray(formatted) ? dedupeLabels(labelsFrom(formatted, 'genre', 'spotify')) : labelsFrom(valid.map(c => c.name), 'genre', 'spotify');
      labels.forEach(label => {
        label.provider ||= 'spotify';
        label.rawValue ||= valid.find(c => key(c.name) === label.key)?.rawValue || label.label;
      });
      return response('spotify', labels.length ? 'success' : 'empty', labels, {
        entityType: 'recording',
        entityId: identity.uri,
        sourceUrl: `https://open.spotify.com/track/${identity.uri.split(':')[2]}`,
        validationRule: 'spotify-track-metadata-v2',
        match: accepted('spotify-uri', 'Gêneros obtidos automaticamente dos metadados da faixa no Spotify (MetadataService).')
      });
    }
    const adapters = { discogs, musicbrainz, spotify, ...options.providers };
    async function runProvider(provider, identity, signal) {
      const cacheKey = provider === 'spotify' && identity.uri.startsWith('spotify:track:') ? identity.uri : identity.key;
      const id = `provider:${provider}:${cacheKey}`;
      const cached = await cacheGet(providerCache, id);
      if (cached) return cached;
      try {
        const r = await adapters[provider](identity, signal);
        checkAbort(signal);
        if (!r || r.provider !== provider || !STATUSES.includes(r.status) || !Array.isArray(r.labels)) throw new GenreError('error', 'PROVIDER_CONTRACT_INVALID');
        if (r.status === 'success' && !r.labels.length) throw new GenreError('error', 'PROVIDER_EMPTY_SUCCESS');
        const labels = r.labels.map(l => ({ ...l, provider: l.provider || provider }));
        const orderedLabels = orderProviderLabels(provider, labels);
        const result = { ...r, labels: orderedLabels, dependencies: [] };
        if (['success', 'empty', 'no_match'].includes(r.status)) await cachePut(providerCache, id, result, r.expiresAt || now() + (TTL[provider] || HOUR));
        return result;
      } catch (e) { return failure(provider, e); }
    }
    function filterByPolicy(rawLabels, policy, provider) {
      const filtered = rawLabels
        .map(l => ({ ...l, provider: l.provider || provider }))
        .filter(l => (l.kinds || [l.kind]).some(kind => kind === 'style' ? policy.showStyles : policy.showGenres));
      return orderProviderLabels(provider, filtered);
    }
    async function resolve(track, { signal, onPreview } = {}) {
      try { await ready; await cacheMutation; } catch { return { ...failure(null, new GenreError('error', 'STORAGE_UNAVAILABLE')), configVersion: revision, attempts: [] }; }
      const identity = identityFor(track), currentRevision = revision, policy = config;
      if (closed || signal?.aborted) return { status: 'cancelled', labels: [], configVersion: currentRevision, attempts: [] };
      const id = `${identity.key}:${currentRevision}`;
      const cached = resolved.get(id);
      if (cached) {
        if (cached.expiresAt > now()) return clone(cached);
        resolved.delete(id);
      }
      let mainDone = false;
      if (typeof onPreview === 'function') {
        (async () => {
          try {
            const enabled = policy.order.filter(p => policy.enabled[p]);
            if (enabled.length < 2 || !identity.uri?.startsWith('spotify:track:')) return;
            const isDiscogsReady = Boolean(options.providers?.discogs || (options.discogs && (typeof options.discogs.isConfigured !== 'function' || options.discogs.isConfigured())));
            const isMbReady = Boolean(options.providers?.musicbrainz || (options.musicbrainz && (typeof options.musicbrainz.isConfigured !== 'function' || options.musicbrainz.isConfigured())));
            const activeEnabled = enabled.filter(p => (p !== 'discogs' || isDiscogsReady) && (p !== 'musicbrainz' || isMbReady));
            if (activeEnabled.length < 2) return;
            const top = activeEnabled[0];
            if (top === 'spotify') return;
            const topCached = await cacheGet(providerCache, `provider:${top}:${identity.key}`);
            if (topCached?.status === 'success') return;
            await Promise.resolve();
            await Promise.resolve();
            if (!limiters[top]?.isBusy()) await (options.wait || sleep)(180, signal);
            if (mainDone || signal?.aborted || revision !== currentRevision) return;
            if (activeEnabled.includes('spotify')) {
              const spRaw = await runProvider('spotify', identity, signal);
              if (mainDone || signal?.aborted || revision !== currentRevision) return;
              const spLabels = filterByPolicy(spRaw.labels, policy, 'spotify');
              if (spRaw.status === 'success' && spLabels.length) {
                onPreview({
                  ...spRaw,
                  labels: applyPinnedOrder(dedupeLabels(spLabels), identity),
                  selectedProvider: 'spotify',
                  isPreview: true,
                  configVersion: currentRevision
                });
              }
            }
          } catch { /* Preview is best-effort while paced APIs resolve. */ }
        })();
      }
      try {
        const out = await subscribe(inflight, id, async sharedSignal => {
          const attempts = [], enabled = policy.order.filter(p => policy.enabled[p]);
          if (!enabled.length) return { status: 'empty', reason: 'SOURCES_DISABLED', labels: [], attempts, configVersion: currentRevision };
          if (!identity.uri || !identity.uri.startsWith('spotify:track:')) return { status: 'unsupported', errorCode: 'SPOTIFY_TRACK_REQUIRED', labels: [], attempts, configVersion: currentRevision };
          let final = null;
          let mbSuccess = null;
          for (const provider of enabled) {
            checkAbort(sharedSignal);
            const isDiscogsReady = Boolean(options.providers?.discogs || (options.discogs && (typeof options.discogs.isConfigured !== 'function' || options.discogs.isConfigured())));
            const isMbReady = Boolean(options.providers?.musicbrainz || (options.musicbrainz && (typeof options.musicbrainz.isConfigured !== 'function' || options.musicbrainz.isConfigured())));
            if (provider === 'discogs' && !isDiscogsReady && enabled.length > 1) continue;
            if (provider === 'musicbrainz' && !isMbReady && enabled.length > 1) continue;
            const raw = await runProvider(provider, identity, sharedSignal);
            checkAbort(sharedSignal);
            if (revision !== currentRevision) throw cancelled();
            const labels = filterByPolicy(raw.labels, policy, provider);
            const usable = raw.status === 'success' && !labels.length
              ? { ...raw, status: 'empty', reason: 'LABEL_FILTERS_EMPTY', labels: [] }
              : { ...raw, labels: dedupeLabels(labels) };
            attempts.push(usable);
            if (usable.status === 'success') {
              if (provider === 'discogs') {
                // Rule 1: Discogs found genres -> short-circuit immediately (do not query MusicBrainz or Spotify).
                final = { ...usable, selectedProvider: 'discogs' };
                break;
              }
              if (provider === 'musicbrainz') {
                // Rule 2: MusicBrainz found genres -> retain as primary, and also query Spotify if enabled.
                mbSuccess = usable;
                const spIdx = enabled.indexOf('spotify');
                if (spIdx === -1 || spIdx < enabled.indexOf('musicbrainz')) {
                  final = { ...usable, selectedProvider: 'musicbrainz' };
                  break;
                }
                continue;
              }
              if (provider === 'spotify') {
                if (mbSuccess) {
                  // Combine MusicBrainz (primary) + Spotify (complementary).
                  // Keep MusicBrainz labels first (with main genre at index 0), followed by Spotify labels.
                  const merged = dedupeLabels([...mbSuccess.labels, ...usable.labels]);
                  const firstGenreIdx = merged.findIndex(l => l.kind === 'genre');
                  if (firstGenreIdx > 0) {
                    const [firstGenre] = merged.splice(firstGenreIdx, 1);
                    merged.unshift(firstGenre);
                  }
                  final = {
                    ...mbSuccess,
                    labels: merged,
                    selectedProvider: 'musicbrainz',
                    expiresAt: Math.min(mbSuccess.expiresAt || Infinity, usable.expiresAt || Infinity)
                  };
                } else {
                  final = { ...usable, selectedProvider: 'spotify' };
                }
                break;
              }
            }
          }
          if (!final && mbSuccess) {
            final = { ...mbSuccess, selectedProvider: 'musicbrainz' };
          }
          if (!final) {
            const lastAttempt = attempts[attempts.length - 1];
            const anyEmpty = attempts.some(a => a.status === 'empty');
            if (anyEmpty) {
              final = { status: 'empty', reason: 'ALL_SOURCES_EMPTY', labels: [], selectedProvider: null };
            } else if (lastAttempt && !['empty', 'no_match', 'not_configured'].includes(lastAttempt.status)) {
              final = { ...lastAttempt, labels: [], selectedProvider: null };
            } else {
              const allNotConfigured = attempts.length > 0 && attempts.every(a => a.status === 'not_configured');
              final = allNotConfigured
                ? { ...attempts[0], labels: [], selectedProvider: null }
                : { status: 'empty', reason: 'ALL_SOURCES_EMPTY', labels: [], selectedProvider: null };
            }
          }
          if (Array.isArray(final.labels) && final.labels.length) {
            final = { ...final, labels: applyPinnedOrder(final.labels, identity) };
          }
          const retryTimes = attempts.filter(r => ['rate_limited', 'error'].includes(r.status) && Number.isFinite(r.retryAt) && r.retryAt > now()).map(r => r.retryAt);
          const validExpiries = [...attempts.map(r => r.expiresAt).filter(Number.isFinite), ...retryTimes];
          const baseExpiry = Number.isFinite(final.expiresAt) ? final.expiresAt : (validExpiries.length ? Math.min(...validExpiries) : now() + HOUR);
          const expiresAt = retryTimes.length ? Math.min(baseExpiry, ...retryTimes) : baseExpiry;
          const result = { ...final, identityKey: identity.key, configVersion: currentRevision, attempts, expiresAt };
          if (['success', 'empty'].includes(result.status) && expiresAt > now()) {
            resolved.set(id, result);
            armExpiry(expiresAt);
          }
          while (resolved.size > CACHE_LIMIT) resolved.delete(resolved.keys().next().value);
          return result;
        }, signal);
        mainDone = true;
        return clone(out);
      } catch (e) { mainDone = true; return { ...failure(null, e), configVersion: currentRevision, attempts: [] }; }
    }
    return {
      ready, resolve, identityFor,
      getConfig: () => clone(config),
      get revision() { return revision; },
      onChange(fn) { changes.add(fn); return () => changes.delete(fn); },
      getPinnedGenre(track) {
        return getPinnedKey(identityFor(track));
      },
      async pinGenre(track, labelOrKey) {
        await ready;
        const targetKey = key(typeof labelOrKey === 'string' ? labelOrKey : (labelOrKey?.key || labelOrKey?.label || ''));
        if (!targetKey) return null;
        const identity = identityFor(track);
        if (identity.key) pinnedGenres.set(identity.key, targetKey);
        if (identity.uri && identity.uri.startsWith('spotify:track:')) pinnedGenres.set(identity.uri, targetKey);
        persistPinnedGenres();

        for (const p of PROVIDERS) {
          const cacheKey = p === 'spotify' && identity.uri.startsWith('spotify:track:') ? identity.uri : identity.key;
          const cacheId = `provider:${p}:${cacheKey}`;
          const entry = providerCache.get(cacheId);
          if (entry?.value?.labels?.some(l => l.key === targetKey)) {
            const updatedValue = { ...entry.value, labels: applyPinnedOrder(entry.value.labels, identity) };
            await cachePut(providerCache, cacheId, updatedValue, entry.expiresAt);
          }
        }

        const resId = `${identity.key}:${revision}`;
        const cachedRes = resolved.get(resId);
        if (cachedRes?.labels?.length) {
          const updatedRes = { ...cachedRes, labels: applyPinnedOrder(cachedRes.labels, identity) };
          resolved.set(resId, updatedRes);
          notify();
          return clone(updatedRes);
        }
        notify();
        return null;
      },
      async configure(patch) {
        await ready;
        const next = configFrom({ ...config, ...patch, enabled: { ...config.enabled, ...patch.enabled } });
        const tokenChanged = next.discogsToken !== config.discogsToken || next.musicbrainzToken !== config.musicbrainzToken;
        const policyChanged = tokenChanged || JSON.stringify({ ...next, colors: true }) !== JSON.stringify({ ...config, colors: true });
        const previous = config;
        config = next;
        if (tokenChanged) {
          if (next.discogsToken !== previous.discogsToken) limiters.discogs.unblock();
          if (next.musicbrainzToken !== previous.musicbrainzToken) limiters.musicbrainz.unblock();
          for (const [id] of providerCache) {
            if ((next.discogsToken !== previous.discogsToken && id.startsWith('provider:discogs:'))
              || (next.musicbrainzToken !== previous.musicbrainzToken && id.startsWith('provider:musicbrainz:'))) {
              providerCache.delete(id);
              remove('cache', id);
            }
          }
        }
        if (policyChanged) invalidate(); else notify();
        try { await write('settings', 'genre-selector-v1', next); }
        catch (error) { if (config === next) { config = previous; invalidate(); } throw error; }
        return clone(config);
      },
      async resetConfig() { return this.configure(defaultConfig()); },
      async clearCache() {
        await ready;
        for (const p of PROVIDERS) limiters[p].unblock();
        await mutateCache(async () => {
          providerCache.clear(); resolved.clear(); clearTimeout(expiryTimer);
          await storage.clear('cache');
        });
      },
      async refresh(track, opts = {}) {
        await ready;
        for (const p of PROVIDERS) limiters[p].unblock();
        await mutateCache(async () => {
          const identity = identityFor(track);
          const target = identity.uri.startsWith('spotify:track:') ? identity.uri : identity.key;
          for (const [id] of providerCache) if (id.includes(target) || id.includes(identity.key)) {
            providerCache.delete(id); await storage.remove('cache', id);
          }
        });
        return resolve(track, opts);
      },
      async refreshContext(tracks, opts = {}) {
        await ready;
        for (const p of PROVIDERS) limiters[p].unblock();
        await mutateCache(async () => {
          const targets = new Set(tracks.flatMap(t => {
            const id = identityFor(t);
            return [id.key, ...(id.uri.startsWith('spotify:track:') ? [id.uri] : [])];
          }));
          const removeIds = new Set();
          for (const [id] of providerCache) if ([...targets].some(k => k && id.includes(k))) removeIds.add(id);
          for (const id of removeIds) { providerCache.delete(id); await storage.remove('cache', id); }
        });
        const results = [];
        for (const track of tracks) { if (opts.signal?.aborted) break; results.push(await resolve(track, opts)); }
        return results;
      },
      async testSpotify(track, signal) {
        await ready;
        try { return await spotify(identityFor(track), signal); } catch (e) { return failure('spotify', e); }
      },
      diagnostics(result) {
        const clean = r => Object.fromEntries(['provider', 'status', 'reason', 'errorCode', 'retryAt', 'entityType', 'entityId', 'sourceUrl', 'match', 'fetchedAt', 'expiresAt'].filter(k => r?.[k] !== undefined).map(k => [k, clone(r[k])]));
        return { ...clean(result), configVersion: result?.configVersion, attempts: (result?.attempts || []).map(clean) };
      },
      stats: () => ({ revision, resources: 0, providerCache: providerCache.size, resolutions: resolved.size, inflight: inflight.size, pending: Object.fromEntries(PROVIDERS.map(p => [p, limiters[p].pending])) }),
      cancel() { invalidate(); },
      close() { closed = true; clearTimeout(expiryTimer); invalidate(); changes.clear(); }
    };
  }
  return { PROVIDERS, STATUSES, TTL, GenreError, defaultConfig, configFrom, labelsFrom, dedupeLabels, sortLabelsByKind, identityFor, versionOf, matchRecording, createLimiter, subscribe, decodeConcepts, createService, retryTime };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Genre4allGenres;
