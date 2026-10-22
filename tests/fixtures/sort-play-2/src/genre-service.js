/* Sort-Play genre resolver. MIT, hoeci and contributors. Spotify metadata priority. */
const SortPlayGenres = (() => {
  'use strict';
  const PROVIDERS = Object.freeze(['spotify']);
  const STATUSES = Object.freeze(['success', 'empty', 'no_match', 'not_configured', 'unsupported', 'rate_limited', 'error', 'cancelled']);
  const HOUR = 3600000;
  const TTL = { spotify: HOUR };
  const CACHE_VERSION = 2;
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = value => String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  const matchText = value => key(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const defaultConfig = () => ({ version: 1, order: [...PROVIDERS], enabled: Object.fromEntries(PROVIDERS.map(p => [p, true])), showGenres: true, showStyles: true, colors: true });
  function configFrom(value) {
    const v = value && typeof value === 'object' ? value : {};
    const defaults = defaultConfig();
    return {
      ...defaults,
      order: [...new Set([...(Array.isArray(v.order) ? v.order : []).filter(p => PROVIDERS.includes(p)), ...PROVIDERS])],
      enabled: Object.fromEntries(PROVIDERS.map(p => [p, typeof v.enabled?.[p] === 'boolean' ? v.enabled[p] : true])),
      showGenres: v.showGenres !== false,
      showStyles: v.showStyles !== false,
      colors: v.colors !== false
    };
  }
  /** @typedef {{key:string,label:string,kind:'genre'|'style'|'tag',kinds?:string[],rawValue:string}} GenreLabel */
  /** @typedef {{provider:string,status:string,labels:GenreLabel[],entityType?:string,entityId?:string,sourceUrl?:string,fetchedAt?:number,expiresAt?:number,match?:{method:string,explanation:string,accepted:boolean},retryAt?:number,errorCode?:string}} ProviderResult */
  function labelsFrom(values, kind = 'genre') {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).flatMap(raw => {
      const text = typeof raw === 'string' ? raw : (raw?.label ?? raw?.name);
      if (typeof text !== 'string' || !text.trim() || /[\u0000-\u001f]/u.test(text)) return [];
      const k = key(text);
      const itemKind = (typeof raw === 'object' && raw?.kind) ? raw.kind : kind;
      if (seen.has(`${k}:${itemKind}`)) return [];
      seen.add(`${k}:${itemKind}`);
      return [{ key: k, label: text.trim().replace(/\s+/gu, ' '), kind: itemKind, rawValue: typeof raw === 'object' && typeof raw?.rawValue === 'string' ? raw.rawValue : text }];
    });
  }
  function dedupeLabels(values) {
    const seen = new Map();
    for (const label of values) {
      const kinds = label.kinds || [label.kind];
      if (seen.has(label.key)) seen.get(label.key).kinds = [...new Set([...seen.get(label.key).kinds, ...kinds])];
      else seen.set(label.key, { ...label, kinds: [...kinds] });
    }
    return [...seen.values()];
  }
  function identityFor(track) {
    const t = track || {};
    const metadata = t.metadata || {};
    const title = String(t.name || t.title || metadata.title || '').trim();
    const artists = (t.artists?.length ? t.artists.map(a => typeof a === 'string' ? a : a.name) : [t.artistName || metadata.artist_name]).filter(Boolean).map(String);
    const uri = String(t.uri || '');
    const durationValue = Number(t.duration_ms || t.durationMs || t.duration?.milliseconds || t.duration?.totalMilliseconds || (typeof t.duration === 'number' ? t.duration : null) || metadata.duration);
    const durationMs = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : null;
    const album = String(t.album?.name || t.albumName || metadata.album_title || '').trim();
    const rawIsrc = String(t.external_ids?.isrc || t.isrc || t.track?.external_ids?.isrc || '').toUpperCase();
    const isrc = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/u.test(rawIsrc) ? rawIsrc : '';
    const version = versionOf(title);
    return {
      uri, title, artists, durationMs, album, isrc, version,
      key: JSON.stringify([uri, key(title), artists.map(key), durationMs, key(album), isrc, version])
    };
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
      setSpacing(ms) { if (Number.isFinite(ms) && ms > 0) { spacing = Math.max(interval, ms); nextAt = Math.max(nextAt, now() + spacing); } },
      async run(work, signal) {
        checkAbort(signal);
        if (now() < blockedUntil) throw new GenreError('rate_limited', 'RATE_LIMITED', blockedUntil);
        if (pending >= maxQueue) throw new GenreError('error', 'QUEUE_FULL');
        pending++;
        const result = tail.then(async () => {
          checkAbort(signal);
          if (now() < blockedUntil) throw new GenreError('rate_limited', 'RATE_LIMITED', blockedUntil);
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
    const now = options.now || Date.now;
    const storage = options.storage || { async get() {}, async set() {}, async remove() {}, async clear() {}, async entries() { return []; } };
    const providerCache = new Map(), resolved = new Map(), inflight = new Map();
    const limiters = Object.fromEntries(PROVIDERS.map(p => [p, createLimiter(25, { now, wait: options.wait, maxQueue: 128 })]));
    let config = defaultConfig(), revision = 1, closed = false;
    let persistence = Promise.resolve(), cacheMutation = Promise.resolve(), expiryTimer = null;
    const changes = new Set();
    function write(space, id, value) { const operation = persistence.then(() => storage.set(space, id, clone(value))); persistence = operation.catch(() => {}); return operation; }
    const ready = (async () => {
      config = configFrom(await storage.get('settings', 'genre-selector-v1'));
      for (const [id, entry] of await storage.entries('cache')) {
        if (entry?.version === CACHE_VERSION && entry.value && typeof entry.value === 'object' && Number.isFinite(entry.expiresAt) && entry.expiresAt > now() && id.startsWith('provider:spotify:')) {
          providerCache.set(id, entry);
        } else await storage.remove('cache', id);
      }
      while (providerCache.size > 500) { const id = providerCache.keys().next().value; providerCache.delete(id); await storage.remove('cache', id); }
      armExpiry();
    })();
    function notify() { for (const fn of changes) fn(); }
    function armExpiry() {
      clearTimeout(expiryTimer);
      if (closed) return;
      const expiry = Math.min(...[...providerCache.values()].map(v => v.expiresAt));
      if (!Number.isFinite(expiry)) return;
      expiryTimer = setTimeout(async () => {
        try {
          for (const map of [providerCache, resolved]) for (const [id, entry] of map) if (entry.expiresAt <= now()) {
            map.delete(id); if (map !== resolved) await storage.remove('cache', id);
          }
        } catch { /* Reads check expiry too. */ }
        finally { armExpiry(); }
      }, Math.max(1, expiry - now()));
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
      while (map.size > 500) { const oldest = map.keys().next().value; map.delete(oldest); await storage.remove('cache', oldest); }
      await write('cache', id, entry);
      armExpiry();
    }
    async function cacheGet(map, id) {
      const item = map.get(id);
      if (!item) return null;
      if (item.expiresAt <= now()) { map.delete(id); await storage.remove('cache', id); return null; }
      return clone(item.value);
    }
    function failure(provider, error) {
      const e = error instanceof GenreError ? error : new GenreError('error', 'REQUEST_FAILED');
      return { provider, status: e.status, labels: [], errorCode: e.code, ...(e.retryAt ? { retryAt: e.retryAt } : {}) };
    }
    function response(provider, state, labels = [], fields = {}) {
      return { provider, status: state, labels: dedupeLabels(labels), fetchedAt: now(), expiresAt: now() + TTL[provider], ...fields };
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
        : labelsFrom(valid.map(c => c.name));
      const labels = Array.isArray(formatted) ? dedupeLabels(labelsFrom(formatted)) : labelsFrom(valid.map(c => c.name));
      labels.forEach(label => { label.rawValue ||= valid.find(c => key(c.name) === label.key)?.rawValue || label.label; });
      return response('spotify', labels.length ? 'success' : 'empty', labels, {
        entityType: 'recording',
        entityId: identity.uri,
        sourceUrl: `https://open.spotify.com/track/${identity.uri.split(':')[2]}`,
        validationRule: 'spotify-track-metadata-v2',
        match: accepted('spotify-uri', 'Gêneros obtidos automaticamente dos metadados da faixa no Spotify (MetadataService).')
      });
    }
    const adapters = { spotify, ...options.providers };
    async function runProvider(provider, identity, signal) {
      const cacheKey = identity.uri.startsWith('spotify:track:') ? identity.uri : identity.key;
      const id = `provider:${provider}:${cacheKey}`;
      const cached = await cacheGet(providerCache, id);
      if (cached) return cached;
      try {
        const r = await adapters[provider](identity, signal);
        checkAbort(signal);
        if (!r || r.provider !== provider || !STATUSES.includes(r.status) || !Array.isArray(r.labels)) throw new GenreError('error', 'PROVIDER_CONTRACT_INVALID');
        if (r.status === 'success' && !r.labels.length) throw new GenreError('error', 'PROVIDER_EMPTY_SUCCESS');
        const result = { ...r, dependencies: [] };
        if (['success', 'empty', 'no_match'].includes(r.status)) await cachePut(providerCache, id, result, r.expiresAt || now() + TTL[provider]);
        return result;
      } catch (e) { return failure(provider, e); }
    }
    async function resolve(track, { signal } = {}) {
      try { await ready; await cacheMutation; } catch { return { ...failure(null, new GenreError('error', 'STORAGE_UNAVAILABLE')), configVersion: revision, attempts: [] }; }
      const identity = identityFor(track), currentRevision = revision, policy = clone(config);
      if (closed || signal?.aborted) return { status: 'cancelled', labels: [], configVersion: currentRevision, attempts: [] };
      const id = `${identity.key}:${currentRevision}`;
      const cached = resolved.get(id);
      if (cached && cached.expiresAt > now()) return clone(cached);
      try {
        return clone(await subscribe(inflight, id, async sharedSignal => {
          const attempts = [], enabled = policy.order.filter(p => policy.enabled[p]);
          if (!enabled.length) return { status: 'empty', reason: 'SOURCES_DISABLED', labels: [], attempts, configVersion: currentRevision };
          if (!identity.uri) return { status: 'unsupported', errorCode: 'SPOTIFY_TRACK_REQUIRED', labels: [], attempts, configVersion: currentRevision };
          let final;
          for (const provider of enabled) {
            checkAbort(sharedSignal);
            const raw = await runProvider(provider, identity, sharedSignal);
            checkAbort(sharedSignal);
            if (revision !== currentRevision) throw cancelled();
            const labels = raw.labels.filter(l => (l.kinds || [l.kind]).some(kind => kind === 'style' ? policy.showStyles : policy.showGenres));
            const usable = raw.status === 'success' && !labels.length ? { ...raw, status: 'empty', reason: 'LABEL_FILTERS_EMPTY' } : raw;
            attempts.push({ ...usable, labels: dedupeLabels(labels) });
            if (usable.status === 'success' || !['empty', 'no_match'].includes(usable.status)) {
              final = { ...usable, labels: dedupeLabels(labels), selectedProvider: usable.status === 'success' ? provider : null };
              break;
            }
          }
          final ||= { status: 'empty', reason: 'ALL_SOURCES_EMPTY', labels: [], selectedProvider: null };
          const expiresAt = Math.min(...attempts.map(r => r.expiresAt || now()));
          const result = { ...final, identityKey: identity.key, configVersion: currentRevision, attempts, expiresAt };
          if (['success', 'empty'].includes(result.status) && expiresAt > now()) resolved.set(id, result);
          while (resolved.size > 500) resolved.delete(resolved.keys().next().value);
          return result;
        }, signal));
      } catch (e) { return { ...failure(null, e), configVersion: currentRevision, attempts: [] }; }
    }
    return {
      ready, resolve, identityFor,
      getConfig: () => clone(config),
      get revision() { return revision; },
      onChange(fn) { changes.add(fn); return () => changes.delete(fn); },
      async configure(patch) {
        await ready;
        const next = configFrom({ ...config, ...patch, enabled: { ...config.enabled, ...patch.enabled } });
        const policyChanged = JSON.stringify({ ...next, colors: true }) !== JSON.stringify({ ...config, colors: true });
        const previous = config;
        config = next;
        if (policyChanged) invalidate(); else notify();
        try { await write('settings', 'genre-selector-v1', next); }
        catch (error) { if (config === next) { config = previous; invalidate(); } throw error; }
        return clone(config);
      },
      async resetConfig() { return this.configure(defaultConfig()); },
      async clearCache() {
        await ready;
        await mutateCache(async () => {
          providerCache.clear(); resolved.clear(); clearTimeout(expiryTimer);
          await storage.clear('cache');
        });
      },
      async refresh(track, opts = {}) {
        await ready;
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
        await mutateCache(async () => {
          const targets = new Set(tracks.flatMap(t => {
            const id = identityFor(t);
            return [id.key, ...(id.uri.startsWith('spotify:track:') ? [id.uri] : [])];
          }));
          const remove = new Set();
          for (const [id] of providerCache) if ([...targets].some(k => k && id.includes(k))) remove.add(id);
          for (const id of remove) { providerCache.delete(id); await storage.remove('cache', id); }
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
  return { PROVIDERS, STATUSES, TTL, GenreError, defaultConfig, configFrom, labelsFrom, dedupeLabels, identityFor, versionOf, matchRecording, createLimiter, subscribe, decodeConcepts, createService, retryTime };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SortPlayGenres;
