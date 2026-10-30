/*
Genre4all 1.0.0 — standalone Spicetify genre column.
Adapted from Lucasoreo/Sort-Play-2 @ c1fc205bccfd4200ad0660c75e55e8d138155936.

MIT License

Copyright (c) 2026 hoeci

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
(function () {
"use strict";
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
    const providerCache = new Map(), resolved = new Map(), inflight = new Map();
    const intervals = { discogs: options.discogsInterval ?? 1100, musicbrainz: options.musicbrainzInterval ?? 1150, spotify: options.spotifyInterval ?? 25 };
    const limiters = Object.fromEntries(PROVIDERS.map(p => [p, createLimiter(intervals[p] ?? 25, { now, wait: options.wait, maxQueue: 256 })]));
    let config = defaultConfig(), revision = 1, closed = false;
    let persistence = Promise.resolve(), cacheMutation = Promise.resolve(), expiryTimer = null;
    const changes = new Set();
    function write(space, id, value) { const operation = persistence.then(() => storage.set(space, id, clone(value))); persistence = operation.catch(() => {}); return operation; }
    function remove(space, id) { const operation = persistence.then(() => storage.remove(space, id)); persistence = operation.catch(() => {}); return operation; }
    const ready = (async () => {
      const savedConfig = await storage.get('settings', 'genre-selector-v1');
      config = configFrom(savedConfig);
      if (savedConfig && savedConfig.version !== config.version) write('settings', 'genre-selector-v1', config);
      for (const [id, entry] of await storage.entries('cache')) {
        if (entry?.version === CACHE_VERSION && entry.value && typeof entry.value === 'object' && Number.isFinite(entry.expiresAt) && entry.expiresAt > now() && PROVIDERS.some(p => id.startsWith(`provider:${p}:`))) {
          providerCache.set(id, entry);
        } else await storage.remove('cache', id);
      }
      while (providerCache.size > CACHE_LIMIT) { const id = providerCache.keys().next().value; providerCache.delete(id); await storage.remove('cache', id); }
      armExpiry();
    })();
    function notify() { for (const fn of changes) fn(); }
    function armExpiry() {
      clearTimeout(expiryTimer);
      if (closed) return;
      const expiries = [...providerCache.values(), ...resolved.values()].map(v => v.expiresAt).filter(Number.isFinite);
      if (!expiries.length) return;
      const expiry = Math.min(...expiries);
      expiryTimer = setTimeout(async () => {
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
      armExpiry();
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
      const labels = sortLabelsByKind(dedupeLabels([...genreLabels, ...styleLabels]));
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
        const orderedLabels = provider === 'spotify' ? labels : sortLabelsByKind(labels);
        const result = { ...r, labels: orderedLabels, dependencies: [] };
        if (['success', 'empty', 'no_match'].includes(r.status)) await cachePut(providerCache, id, result, r.expiresAt || now() + (TTL[provider] || HOUR));
        return result;
      } catch (e) { return failure(provider, e); }
    }
    function filterByPolicy(rawLabels, policy, provider) {
      const filtered = rawLabels
        .map(l => ({ ...l, provider: l.provider || provider }))
        .filter(l => (l.kinds || [l.kind]).some(kind => kind === 'style' ? policy.showStyles : policy.showGenres));
      return provider === 'spotify' ? filtered : sortLabelsByKind(filtered);
    }
    async function resolve(track, { signal, onPreview } = {}) {
      try { await ready; await cacheMutation; } catch { return { ...failure(null, new GenreError('error', 'STORAGE_UNAVAILABLE')), configVersion: revision, attempts: [] }; }
      const identity = identityFor(track), currentRevision = revision, policy = clone(config);
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
                  labels: dedupeLabels(spLabels),
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
          const retryTimes = attempts.filter(r => ['rate_limited', 'error'].includes(r.status) && Number.isFinite(r.retryAt) && r.retryAt > now()).map(r => r.retryAt);
          const validExpiries = [...attempts.map(r => r.expiresAt).filter(Number.isFinite), ...retryTimes];
          const baseExpiry = Number.isFinite(final.expiresAt) ? final.expiresAt : (validExpiries.length ? Math.min(...validExpiries) : now() + HOUR);
          const expiresAt = retryTimes.length ? Math.min(baseExpiry, ...retryTimes) : baseExpiry;
          const result = { ...final, identityKey: identity.key, configVersion: currentRevision, attempts, expiresAt };
          if (['success', 'empty'].includes(result.status) && expiresAt > now()) {
            resolved.set(id, result);
            armExpiry();
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

/* Transport adapters (Discogs, MusicBrainz, Spotify MetadataService) and compact persistent cache for Genre4all. */
const Genre4allTransport = (() => {
  'use strict';
  const COMPACT_CACHE_KEY = 'genre4all-cache-txt-v11';
  const COMPACT_MAX_LINES = 2000;

  function encodeCompactCache(map) {
    const lines = [];
    for (const [id, entry] of map) {
      if (!entry || !entry.value || !Number.isFinite(entry.expiresAt)) continue;
      const v = entry.value;
      if (!['success', 'empty', 'no_match'].includes(v.status)) continue;
      const labelsPart = (v.labels || [])
        .map(l => `${String(l.label || '').replace(/[\t\n\r;~]/gu, ' ')}~${l.kind || 'genre'}~${l.provider || v.provider || ''}`)
        .join(';');
      const safeId = String(id).replace(/[\t\n\r]/gu, ' ');
      const provider = String(v.provider || '').replace(/[\t\n\r]/gu, '');
      const status = String(v.status || 'empty');
      const exp = Math.floor(entry.expiresAt).toString(36);
      const ver = Number(entry.version || 2).toString(36);
      lines.push(`${safeId}\t${provider}\t${status}\t${exp}\t${ver}\t${labelsPart}`);
    }
    return lines.slice(-COMPACT_MAX_LINES).join('\n');
  }

  function decodeCompactCache(text, now = Date.now()) {
    const map = new Map();
    if (!text || typeof text !== 'string') return map;
    for (const line of text.split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length < 5) continue;
      const [id, provider, status, exp36, ver36, labelsRaw = ''] = parts;
      const expiresAt = parseInt(exp36, 36);
      const version = parseInt(ver36, 36) || 2;
      if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
      const labels = labelsRaw
        ? labelsRaw.split(';').filter(Boolean).map(item => {
            const [label = '', kind = 'genre', itemProv = ''] = item.split('~');
            const k = label.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
            return { key: k, label: label.trim(), kind, kinds: [kind], rawValue: label.trim(), ...(itemProv ? { provider: itemProv } : {}) };
          }).filter(l => l.key)
        : [];
      map.set(id, {
        version,
        expiresAt,
        value: {
          provider,
          status,
          labels,
          fetchedAt: now,
          expiresAt
        }
      });
    }
    return map;
  }

  function createIndexedDBStorage(indexedDB = globalThis.indexedDB, localStore = globalThis.localStorage) {
    const spaces = ['settings', 'cache'];
    const compactMap = (() => {
      try { return decodeCompactCache(localStore?.getItem?.(COMPACT_CACHE_KEY)); }
      catch { return new Map(); }
    })();
    let flushTimer = null;
    function scheduleCompactFlush() {
      if (!localStore || flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        try {
          while (compactMap.size > COMPACT_MAX_LINES) {
            const oldest = compactMap.keys().next().value;
            compactMap.delete(oldest);
          }
          localStore.setItem(COMPACT_CACHE_KEY, encodeCompactCache(compactMap));
        } catch { /* Quota or private mode; IndexedDB still persists. */ }
      }, 120);
      flushTimer.unref?.();
    }
    const ready = new Promise((resolve, reject) => {
      if (!indexedDB || typeof indexedDB.open !== 'function') {
        reject(new Error('Genre storage unavailable'));
        return;
      }
      const request = indexedDB.open('Genre4allDB', 1);
      request.onupgradeneeded = () => { for (const space of spaces) if (!request.result.objectStoreNames.contains(space)) request.result.createObjectStore(space); };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
      request.onerror = request.onblocked = () => reject(new Error('Genre storage unavailable'));
    });
    async function transaction(space, mode, work) {
      const db = await ready;
      if (!spaces.includes(space)) throw new Error('Invalid genre storage namespace');
      return new Promise((resolve, reject) => {
        const tx = db.transaction(space, mode);
        const result = work(tx.objectStore(space));
        tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result?.result);
        tx.onerror = tx.onabort = () => reject(new Error('Genre storage failed'));
      });
    }
    return {
      async get(s, k) {
        if (s === 'cache' && compactMap.has(k)) return compactMap.get(k);
        try { return await transaction(s, 'readonly', os => os.get(k)); }
        catch { return s === 'cache' ? compactMap.get(k) : undefined; }
      },
      async set(s, k, v) {
        if (s === 'cache') {
          compactMap.set(k, v);
          scheduleCompactFlush();
        }
        return transaction(s, 'readwrite', os => os.put(v, k));
      },
      async remove(s, k) {
        if (s === 'cache') {
          compactMap.delete(k);
          scheduleCompactFlush();
        }
        return transaction(s, 'readwrite', os => os.delete(k));
      },
      async clear(s) {
        if (s === 'cache') {
          compactMap.clear();
          clearTimeout(flushTimer); flushTimer = null;
          try { localStore?.removeItem?.(COMPACT_CACHE_KEY); } catch {}
        }
        return transaction(s, 'readwrite', os => os.clear());
      },
      async entries(s) {
        try {
          const idbEntries = await transaction(s, 'readonly', os => {
            const keys = os.getAllKeys(), values = os.getAll();
            return () => keys.result.map((k, i) => [k, values.result[i]]);
          });
          if (s === 'cache') {
            const merged = new Map(compactMap);
            for (const [k, v] of idbEntries) merged.set(k, v);
            for (const [k, v] of merged) compactMap.set(k, v);
            return [...merged.entries()];
          }
          return idbEntries;
        } catch {
          return s === 'cache' ? [...compactMap.entries()] : [];
        }
      },
      async close() { clearTimeout(flushTimer); (await ready).close(); }
    };
  }

  const normText = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function cleanSearchTitle(title) {
    return String(title || '')
      .replace(/\s*\((?:feat\.?|ft\.?|with\s|remaster|live|bonus|deluxe|version|edit|mix)[^)]*\)/giu, '')
      .replace(/\s*\[(?:feat\.?|ft\.?|with\s|remaster|live|bonus|deluxe|version|edit|mix)[^\]]*\]/giu, '')
      .replace(/\s*-\s*(?:\d{4}\s+)?(?:remaster(?:ed)?|live|mono|stereo|single\s+version|album\s+version|radio\s+edit).*$/giu, '')
      .trim() || String(title || '').trim();
  }
  function escapeLucene(value) {
    return String(value || '').replace(/(["\\+\-&|!(){}[\]^~*?:\/])/gu, '\\$1');
  }
  function waitAbortable(ms, signal, api) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new api.GenreError('cancelled', 'CANCELLED')); return; }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.max(0, ms));
      function onAbort() {
        clearTimeout(timer);
        reject(new api.GenreError('cancelled', 'CANCELLED'));
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function fetchJson(api, fetchImpl, url, headers, signal, prefix, runStep) {
    if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
    if (typeof fetchImpl !== 'function') throw new api.GenreError('unsupported', `${prefix}_FETCH_UNAVAILABLE`);
    const exec = typeof runStep === 'function' ? runStep : fn => fn();

    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
      try {
        return await exec(async () => {
          if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
          const controller = new AbortController();
          let timedOut = false;
          const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
          const onAbort = () => controller.abort();
          signal?.addEventListener('abort', onAbort, { once: true });
          try {
            const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
            if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
            if (res.status === 401 || res.status === 403) throw new api.GenreError('not_configured', `${prefix}_AUTH_FAILED`);
            if (res.status === 429 || res.status === 503) {
              const retryHeader = res.headers?.get?.('retry-after');
              const retryAt = retryHeader ? api.retryTime(retryHeader, Date.now()) : (Date.now() + (attempt + 1) * 2500);
              throw new api.GenreError('rate_limited', `${prefix}_RATE_LIMITED`, retryAt);
            }
            if (res.status === 404) return null;
            if (!res.ok) throw new api.GenreError('error', `${prefix}_HTTP_${res.status}`);
            const remHeader = res.headers?.get?.('x-discogs-ratelimit-remaining');
            const remaining = remHeader !== null && remHeader !== undefined && String(remHeader).trim() !== '' ? Number(remHeader) : NaN;
            const data = await res.json();
            if (Number.isFinite(remaining) && remaining <= 1 && data && typeof data === 'object') {
              data.__rateLimitLow = true;
            }
            return data;
          } catch (err) {
            if (err instanceof api.GenreError) throw err;
            if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
            if (timedOut) throw new api.GenreError('error', `${prefix}_TIMEOUT`);
            throw new api.GenreError('error', `${prefix}_REQUEST_FAILED`);
          } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
          }
        });
      } catch (err) {
        if (err instanceof api.GenreError && err.status === 'rate_limited' && attempt < 2) {
          const waitMs = Math.min(12000, Math.max(1500, (err.retryAt || (Date.now() + 2500)) - Date.now()));
          await waitAbortable(waitMs, signal, api);
          continue;
        }
        throw err;
      }
    }
    return null;
  }

  function createDiscogsAdapter(api, getConfig, fetchImpl = globalThis.fetch) {
    function applyAuth(params, token) {
      if (token.includes(':')) {
        const [k, ...rest] = token.split(':');
        params.set('key', k.trim());
        params.set('secret', rest.join(':').trim());
      } else {
        params.set('token', token);
      }
    }
    function pickBest(identity, results) {
      if (!Array.isArray(results) || !results.length) return null;
      const targetTitle = normText(identity.title);
      const targetClean = normText(cleanSearchTitle(identity.title));
      const targetAlbum = normText(cleanSearchTitle(identity.album));
      const targetArtists = (identity.artists || []).map(a => normText(String(a).replace(/\s*\(\d+\)$/u, ''))).filter(Boolean);
      let best = null, bestScore = -1;
      for (const item of results) {
        const genres = Array.isArray(item?.genre) ? item.genre.filter(Boolean) : [];
        const styles = Array.isArray(item?.style) ? item.style.filter(Boolean) : [];
        if (!genres.length && !styles.length) continue;
        const rawTitle = String(item.title || '');
        const parts = rawTitle.split(' - ');
        const itemArtist = normText((parts[0] || '').replace(/\s*\(\d+\)$/u, ''));
        const itemRelease = normText(parts.slice(1).join(' - ') || rawTitle);
        const fullNorm = normText(rawTitle);
        const exactArtist = targetArtists.some(a => itemArtist === a);
        const partialArtist = exactArtist || targetArtists.some(a => a && (itemArtist.includes(a) || a.includes(itemArtist) || fullNorm.includes(a)));
        if (!partialArtist) continue;
        let score = exactArtist ? 50 : 25;
        if (targetTitle && (itemRelease === targetTitle || itemRelease === targetClean)) score += 40;
        else if (targetAlbum && itemRelease === targetAlbum) score += 35;
        else if ((targetClean && itemRelease.includes(targetClean)) || (targetAlbum && itemRelease.includes(targetAlbum))) score += 20;
        if (item.type === 'master') score += 15;
        if (genres.length) score += 10;
        if (styles.length) score += 5;
        if (score > bestScore) { bestScore = score; best = item; }
      }
      return best;
    }
    const adapter = async (identity, signal, runStep) => {
      if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
      const cfg = typeof getConfig === 'function' ? getConfig() : (getConfig || {});
      const token = String(cfg?.discogsToken || '').trim();
      if (!token) throw new api.GenreError('not_configured', 'DISCOGS_TOKEN_REQUIRED');
      const title = cleanSearchTitle(identity?.title);
      const album = cleanSearchTitle(identity?.album);
      const artists = Array.isArray(identity?.artists) ? identity.artists.filter(Boolean) : [];
      if (!title || !artists.length) throw new api.GenreError('unsupported', 'TRACK_METADATA_REQUIRED');

      const q1 = `${artists[0]} ${title}`.trim();
      const params1 = new URLSearchParams({ q: q1, per_page: '15' });
      applyAuth(params1, token);
      const data1 = await fetchJson(api, fetchImpl, `https://api.discogs.com/database/search?${params1}`, {}, signal, 'DISCOGS', runStep);
      let best = pickBest(identity, data1?.results);

      if (!best && album && normText(album) !== normText(title)) {
        const q2 = `${artists[0]} ${album}`.trim();
        const params2 = new URLSearchParams({ q: q2, per_page: '10' });
        applyAuth(params2, token);
        const data2 = await fetchJson(api, fetchImpl, `https://api.discogs.com/database/search?${params2}`, {}, signal, 'DISCOGS', runStep);
        best = pickBest(identity, data2?.results);
      }
      if (!best) return null;
      return {
        genres: Array.isArray(best.genre) ? best.genre : [],
        styles: Array.isArray(best.style) ? best.style : [],
        entityType: best.type || 'release',
        entityId: String(best.id || ''),
        sourceUrl: best.uri ? new URL(best.uri, 'https://www.discogs.com').href : 'https://www.discogs.com'
      };
    };
    adapter.isConfigured = () => {
      const cfg = typeof getConfig === 'function' ? getConfig() : (getConfig || {});
      return Boolean(String(cfg?.discogsToken || '').trim());
    };
    adapter.usesStepLimiter = true;
    return adapter;
  }

  function createMusicBrainzAdapter(api, getConfig, fetchImpl = globalThis.fetch) {
    function collectBuckets(rec) {
      const genreMap = new Map(), tagMap = new Map();
      const add = (map, list, weight = 1) => {
        if (!Array.isArray(list)) return;
        for (const item of list) {
          const name = typeof item === 'string' ? item.trim() : String(item?.name || '').trim();
          const count = Number.isFinite(item?.count) ? item.count : 1;
          if (!name || count <= 0) continue;
          const k = name.toLocaleLowerCase('en-US');
          const prev = map.get(k);
          const score = count * weight;
          if (!prev || score > prev.score) map.set(k, { name: prev?.name || name, score });
        }
      };
      add(genreMap, rec?.genres, 3);
      add(tagMap, rec?.tags, 3);
      for (const rel of rec?.releases || []) {
        add(genreMap, rel?.['release-group']?.genres, 2);
        add(tagMap, rel?.['release-group']?.tags, 2);
        add(genreMap, rel?.genres, 2);
        add(tagMap, rel?.tags, 2);
      }
      if (rec?.['release-group']) {
        add(genreMap, rec['release-group'].genres, 2);
        add(tagMap, rec['release-group'].tags, 2);
      }
      for (const ac of rec?.['artist-credit'] || []) {
        add(genreMap, ac?.artist?.genres, 1);
        add(tagMap, ac?.artist?.tags, 1);
      }
      const genres = [...genreMap.values()].sort((a, b) => b.score - a.score).map(x => x.name);
      const tags = [...tagMap.values()].sort((a, b) => b.score - a.score).map(x => x.name);
      return { genres, tags };
    }
    function matchCandidate(identity, recordings) {
      if (!Array.isArray(recordings) || !recordings.length) return null;
      for (const rec of recordings) {
        const recArtists = (rec?.['artist-credit'] || []).map(ac => ac?.artist?.name || ac?.name).filter(Boolean);
        const isrcs = (rec?.isrcs || []).map(x => typeof x === 'string' ? x : x?.id).filter(Boolean);
        if (api.matchRecording(identity, { title: rec?.title, artists: recArtists, durationMs: rec?.length, isrcs })) return rec;
      }
      const targetClean = normText(cleanSearchTitle(identity.title));
      const targetArtists = (identity.artists || []).map(normText).filter(Boolean);
      for (const rec of recordings) {
        const recClean = normText(cleanSearchTitle(rec?.title));
        if (!recClean || (recClean !== targetClean && !recClean.includes(targetClean) && !targetClean.includes(recClean))) continue;
        const recArtists = (rec?.['artist-credit'] || []).map(ac => normText(ac?.artist?.name || ac?.name)).filter(Boolean);
        if (targetArtists.length && recArtists.some(ra => targetArtists.some(ta => ra === ta || ra.includes(ta) || ta.includes(ra)))) return rec;
      }
      return null;
    }
    const adapter = async (identity, signal, runStep) => {
      if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
      const cfg = typeof getConfig === 'function' ? getConfig() : (getConfig || {});
      const token = String(cfg?.musicbrainzToken || '').trim();
      const isrc = String(identity?.isrc || '').trim();
      const title = cleanSearchTitle(identity?.title);
      const artists = Array.isArray(identity?.artists) ? identity.artists.filter(Boolean) : [];
      if (!isrc && (!title || !artists.length)) throw new api.GenreError('unsupported', 'TRACK_METADATA_REQUIRED');

      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const parts = [];
      if (isrc) parts.push(`isrc:${escapeLucene(isrc)}`);
      if (title && artists.length) parts.push(`(recording:"${escapeLucene(title)}" AND artist:"${escapeLucene(artists[0])}")`);
      const query = parts.join(' OR ');

      const searchUrl = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&limit=8&fmt=json`;
      const data = await fetchJson(api, fetchImpl, searchUrl, headers, signal, 'MUSICBRAINZ', runStep);
      const matched = matchCandidate(identity, data?.recordings);
      if (!matched) return null;

      let { genres, tags } = collectBuckets(matched);
      if (!genres.length && !tags.length && matched.id) {
        const detailUrl = `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(matched.id)}?inc=genres+tags+artists+release-groups&fmt=json`;
        const detail = await fetchJson(api, fetchImpl, detailUrl, headers, signal, 'MUSICBRAINZ', runStep);
        if (detail) ({ genres, tags } = collectBuckets(detail));
      }
      return {
        genres,
        tags,
        entityType: 'recording',
        entityId: String(matched.id || ''),
        sourceUrl: matched.id ? `https://musicbrainz.org/recording/${matched.id}` : 'https://musicbrainz.org'
      };
    };
    adapter.usesStepLimiter = true;
    return adapter;
  }

  function createSpotifyAdapter(api, getClient) {
    return async (uri, signal) => {
      if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
      let client = getClient();
      if (!client || typeof client.fetch !== 'function') {
        for (let attempt = 0; attempt < 10 && (!client || typeof client.fetch !== 'function'); attempt++) {
          await new Promise((resolve, reject) => {
            const waitTimer = setTimeout(resolve, 250);
            signal?.addEventListener('abort', () => { clearTimeout(waitTimer); reject(new api.GenreError('cancelled', 'CANCELLED')); }, { once: true });
          });
          client = getClient();
        }
      }
      if (!client || typeof client.fetch !== 'function') throw new api.GenreError('unsupported', 'SPOTIFY_METADATA_UNAVAILABLE');
      let timer, abort;
      const cancelled = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new api.GenreError('error', 'SPOTIFY_TIMEOUT')), 12000);
        abort = () => reject(new api.GenreError('cancelled', 'CANCELLED'));
        signal?.addEventListener('abort', abort, { once: true });
      });
      try {
        const response = await Promise.race([client.fetch({ extensionQuery: [{ extensionKind: 6, entityUri: [uri] }] }), cancelled]);
        if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
        const extension = response?.extension?.find(e => e.extensionKind === 6) || response?.extension?.[0];
        const entity = extension?.entityExtension?.find(e => e.entityUri === uri) || extension?.entityExtension?.[0];
        if (!extension || !entity || (entity.entityUri && entity.entityUri !== uri)) {
          throw new api.GenreError('unsupported', 'SPOTIFY_EXTENSION_MISSING');
        }
        const statusCode = entity.status?.code ?? entity.status?.statusCode;
        if (Number.isFinite(statusCode) && statusCode !== 0 && statusCode !== 200 && statusCode !== 404) {
          throw new api.GenreError('unsupported', 'SPOTIFY_EXTENSION_MISSING');
        }
        if (statusCode === 404 || entity.extensionData?.value == null) return [];
        return api.decodeConcepts(entity.extensionData.value);
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    };
  }

  return { COMPACT_CACHE_KEY, encodeCompactCache, decodeCompactCache, createIndexedDBStorage, createSpotifyAdapter, createDiscogsAdapter, createMusicBrainzAdapter };
})();

/* Native extra-column view. All genre data and request caching belong to genre-service.js. */
const Genre4allColumn = (() => {
  'use strict';
  const PALETTE = Object.freeze([
    '#ff7eb6', '#6895ff', '#2ee6a8', '#c996ff', '#00e5d4', '#2ec4ff',
    '#ff9f43', '#ffd166', '#a3e635', '#ff6b6b', '#38bdf8', '#f472b6',
    '#4ade80', '#fb7185', '#7c3aed', '#2563eb', '#db2777', '#059669',
    '#dc2626', '#4f46e5', '#0891b2', '#9333ea', '#ea580c', '#c026d3'
  ]);
  const INK = '#121212';
  const LIGHT_INK = '#ffffff';
  const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  function colorFor(key, colors = true) {
    let hash = 2166136261;
    for (const char of normalize(key)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
    return colors ? PALETTE[(hash >>> 0) % PALETTE.length] : '#ddd5e5';
  }
  function textColorFor(hex) {
    const clean = String(hex || '').replace('#', '');
    if (clean.length !== 6) return INK;
    const [r, g, b] = [0, 2, 4].map(i => {
      const c = parseInt(clean.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 0.30 ? LIGHT_INK : INK;
  }
  const STATES = { queued: 'Aguardando', loading: 'Carregando…', success: 'Gêneros', empty: 'Sem gêneros', no_match: 'Sem correspondência', not_configured: 'Configurar gêneros', unsupported: 'Indisponível', rate_limited: 'Limite da fonte', error: 'Falha nos gêneros', cancelled: 'Cancelado', expired: 'Carregando…' };
  const stateLabel = r => r.result?.reason === 'SOURCES_DISABLED' ? 'Fontes desativadas' : STATES[r.state] || STATES.error;
  function trackFromRow(row, uri, legacy) {
    if (legacy?.uri === uri && (legacy.name || legacy.title || legacy.metadata?.title)) return legacy;
    const seen = new Set();
    function find(value, depth = 10) {
      if (!value || typeof value !== 'object' || depth <= 0 || seen.has(value) || seen.size >= 300) return null;
      seen.add(value);
      if (value.uri === uri && typeof (value.name || value.title) === 'string') {
        const source = Array.isArray(value.artists)
          ? value.artists
          : [...(value.artists?.items || []), ...(value.firstArtist?.items || []), ...(value.otherArtists?.items || [])];
        const artists = (source || []).map(a => ({ name: typeof a === 'string' ? a : a.name || a.profile?.name || a.artist?.profile?.name })).filter(a => a.name);
        if (artists.length) return { ...value, uri, name: value.name || value.title, artists, album: value.album || value.albumOfTrack,
          duration_ms: value.duration_ms || value.duration?.totalMilliseconds || value.duration?.milliseconds };
      }
      for (const k of Object.keys(value)) if (['children', 'props', 'value', 'item', 'track', 'data', 'content', 'node'].includes(k) || /^\d+$/u.test(k)) {
        const found = find(value[k], depth - 1); if (found) return found;
      }
      return null;
    }
    const propsKey = row.__g4aPropsKey ?? (row.__g4aPropsKey = Object.keys(row).find(k => k.startsWith('__reactProps$')) || '');
    if (propsKey) {
      const fromProps = find(row[propsKey]); if (fromProps) return fromProps;
    }
    const fiberKey = row.__g4aFiberKey ?? (row.__g4aFiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber$')) || '');
    let fiber = fiberKey ? row[fiberKey] : null;
    for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
      const found = find(fiber.memoizedProps) || find(fiber.pendingProps); if (found) return found;
      const parentUri = fiber.return?.memoizedProps?.uri;
      if (parentUri?.startsWith('spotify:track:') && parentUri !== uri) break;
    }
    const doc = row.ownerDocument || document;
    const titleCell = row.querySelector('[data-sp-layout-position="native:title"], .main-trackList-rowSectionStart, [role="gridcell"][aria-colindex="2"]');
    const title = (row.querySelector('.main-trackList-rowTitle, [data-testid="tracklist-row-title"], [data-testid="internal-track-link"]')
      || titleCell?.querySelector('[data-encore-id="text"][dir="auto"]'))?.textContent?.trim();
    let artists = [...row.querySelectorAll('a[href*="/artist/"]')].map(a => ({ name: a.textContent.trim() })).filter(a => a.name);
    if (!artists.length) {
      const pageArtist = doc.querySelector('[data-testid="creator-link"], main [data-testid="entityTitle"] ~ * a[href*="/artist/"]')?.textContent?.trim();
      if (pageArtist) artists = [{ name: pageArtist }];
    }
    const album = row.querySelector('a[href*="/album/"]')?.textContent?.trim();
    const duration = row.querySelector('.main-trackList-rowSectionEnd, [data-sp-layout-position="native:end"], [role="gridcell"]:last-of-type')?.textContent?.match(/\b(\d{1,2}):(\d{2})\b/u);
    return { uri, ...(title ? { name: title } : {}), artists: [...new Map(artists.map(a => [a.name, a])).values()], ...(album ? { album: { name: album } } : {}),
      ...(duration ? { duration_ms: (Number(duration[1]) * 60 + Number(duration[2])) * 1000 } : {}) };
  }
  function sourceLink(result) {
    try {
      const url = new URL(result.sourceUrl);
      const host = {
        discogs: 'www.discogs.com',
        musicbrainz: 'musicbrainz.org',
        spotify: 'open.spotify.com'
      }[result.selectedProvider || result.provider];
      return host && url.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.port ? url.href : null;
    } catch { return null; }
  }
  const CSS = `
    .g4a-genre-gridcell { min-width:0 !important; overflow:visible !important; }
    .g4a-genre-host { display:flex !important; align-items:center; justify-content:flex-start; width:100%; min-width:0; max-width:100%; height:100%; padding:0 3px; box-sizing:border-box; overflow:visible; font:12px/1.2 var(--font-family,CircularSp,sans-serif); }
    .g4a-genre-chip { display:inline-block; flex:0 1 auto; min-width:0; max-width:100%; height:22px; box-sizing:border-box; border:none; border-radius:5px; padding:0 8px; font:700 12px/22px var(--font-family,CircularSp,sans-serif); letter-spacing:0.01em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; color:var(--g4a-genre-ink,${INK}) !important; background:var(--g4a-genre-color,#ddd5e5); text-shadow:none; user-select:none; transition:box-shadow .5s ease,transform .18s cubic-bezier(.22,1,.36,1),filter .18s ease; }
    .g4a-genre-chip[data-contrast="light"] { text-shadow:0 1px 1px rgba(0,0,0,.25); }
    .g4a-genre-chip[data-provider="discogs"],.g4a-genre-fan .g4a-genre-chip[data-provider="discogs"] { border:1.5px solid rgb(255,255,255); line-height:19px; box-shadow:0 0 10px rgba(255,255,255,.78),0 0 3px rgba(255,255,255,.95); }
    .g4a-genre-chip[data-provider="discogs"]:hover,.g4a-genre-chip[data-provider="discogs"]:focus-visible,.g4a-genre-fan .g4a-genre-chip[data-provider="discogs"]:hover { box-shadow:0 0 4px rgb(255,255,255),0 0 12px rgb(255,255,255),0 0 24px rgba(255,255,255,.92),0 0 44px rgba(255,255,255,.75); }
    .g4a-genre-chip[data-provider="musicbrainz"],.g4a-genre-fan .g4a-genre-chip[data-provider="musicbrainz"] { border:1.5px solid transparent; line-height:19px; background:linear-gradient(var(--g4a-genre-color,#ddd5e5),var(--g4a-genre-color,#ddd5e5)) padding-box,linear-gradient(135deg,rgb(168,85,247) 0%,rgb(168,85,247) 48%,rgb(255,122,0) 52%,rgb(255,122,0) 100%) border-box; box-shadow:-2px -2px 9px rgba(168,85,247,.85),2px 2px 9px rgba(255,122,0,.85); }
    .g4a-genre-chip[data-provider="musicbrainz"]:hover,.g4a-genre-chip[data-provider="musicbrainz"]:focus-visible,.g4a-genre-fan .g4a-genre-chip[data-provider="musicbrainz"]:hover { box-shadow:-1px -1px 4px rgb(168,85,247),-3px -3px 12px rgb(168,85,247),-5px -5px 24px rgba(168,85,247,.92),-8px -8px 42px rgba(168,85,247,.72),1px 1px 4px rgb(255,122,0),3px 3px 12px rgb(255,122,0),5px 5px 24px rgba(255,122,0,.92),8px 8px 42px rgba(255,122,0,.72); }
    .g4a-genre-primary[data-has-more="true"] { cursor:pointer; }
    .g4a-genre-primary:hover { filter:brightness(1.06); }
    .g4a-genre-state { color:var(--spice-subtext,#ddd); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px; }
    .g4a-genre-state-action { cursor:pointer; text-decoration:underline; text-underline-offset:2px; }
    .g4a-genre-host :focus-visible { outline:2px solid #7850a0; outline-offset:-2px; }
    .g4a-genre-fan { position:fixed; z-index:9999; display:flex; flex-direction:column; align-items:flex-start; gap:6px; margin:0; padding:4px 6px; list-style:none; pointer-events:auto; }
    .g4a-genre-fan[data-direction="up"] { flex-direction:column-reverse; }
    .g4a-genre-fan .g4a-genre-chip { flex:none; width:max-content; max-width:min(320px,calc(100vw - 24px)); transform-origin:top left; will-change:transform,opacity; animation:g4a-domino-down var(--g4a-dur,320ms) cubic-bezier(.42,0,.2,1) both; animation-delay:var(--g4a-delay,0ms); }
    .g4a-genre-fan .g4a-genre-chip[data-provider="spotify"] { box-shadow:0 8px 20px rgba(0,0,0,.48),0 2px 6px rgba(0,0,0,.32),inset 0 0 0 1px rgba(255,255,255,.14); }
    .g4a-genre-fan[data-direction="up"] .g4a-genre-chip { transform-origin:bottom left; animation-name:g4a-domino-up; }
    .g4a-genre-fan.g4a-genre-fan-closing .g4a-genre-chip { animation:g4a-domino-out 130ms cubic-bezier(.4,0,1,1) both; }
    @keyframes g4a-domino-down {
      0% { opacity:0; transform:translate3d(-3.5px,-14px,0) scale(.94); }
      38% { opacity:.6; transform:translate3d(-1.5px,-9.5px,0) scale(.96); }
      78% { opacity:1; transform:translate3d(2.5px,0,0) scale(1); }
      100% { opacity:1; transform:translate3d(0,0,0) scale(1); }
    }
    @keyframes g4a-domino-up {
      0% { opacity:0; transform:translate3d(-3.5px,14px,0) scale(.94); }
      38% { opacity:.6; transform:translate3d(-1.5px,9.5px,0) scale(.96); }
      78% { opacity:1; transform:translate3d(2.5px,0,0) scale(1); }
      100% { opacity:1; transform:translate3d(0,0,0) scale(1); }
    }
    @keyframes g4a-domino-out {
      0% { opacity:1; transform:translate3d(0,0,0) scale(1); }
      100% { opacity:0; transform:translate3d(-2px,-8px,0) scale(.94); }
    }
    @media (forced-colors:active) { .g4a-genre-chip { forced-color-adjust:none; background:Canvas; color:CanvasText !important; border:1px solid CanvasText; } .g4a-genre-host :focus-visible { outline:2px solid Highlight; box-shadow:none; } }
  `;
  function createController(service, options) {
    const doc = options.document || document, win = doc.defaultView;
    const records = new Map(), rowRecords = new Map(), lifecycle = new AbortController();
    let active = 0, frame = null, closed = false, activeFan = null, fanTimer = null, closeTimer = null;
    const style = doc.createElement('style'); style.id = 'genre4all-column-style'; style.textContent = CSS; doc.head.append(style);
    function node(tag, text, attrs = {}) {
      const n = doc.createElement(tag); if (text != null) n.textContent = text;
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      return n;
    }
    function valid(r) {
      return !closed && records.get(r.cell) === r && r.cell.isConnected && r.row.contains(r.cell)
        && options.getUri(r.row) === r.uri && options.getContext() === r.context && options.isEnabled(r.cell, r.row)
        && service.identityFor(options.getTrack(r.row)).key === r.identityKey
        && service.revision === r.revision;
    }
    function isExpired(r) {
      return r.state === 'expired' || (['success', 'empty', 'no_match'].includes(r.state) && r.result?.expiresAt && r.result.expiresAt <= Date.now());
    }
    function expire(r) {
      if (isExpired(r)) {
        clearTimeout(r.expiry); r.expiry = null;
        if (!r.task) {
          r.result = null;
          r.state = 'queued';
          schedule();
        }
      }
    }
    function chip(label, tag = 'span', fallbackProvider = 'spotify') {
      const bg = colorFor(label.key, service.getConfig().colors);
      const fg = textColorFor(bg);
      const provider = label.provider || fallbackProvider || 'spotify';
      const n = node(tag, label.label, tag === 'li' ? {} : { role: 'listitem' });
      n.className = 'g4a-genre-chip';
      n.dataset.provider = provider;
      if (label.kind) n.dataset.kind = label.kind;
      n.style.setProperty('--g4a-genre-color', bg);
      n.style.setProperty('--g4a-genre-ink', fg);
      if (fg === LIGHT_INK) n.dataset.contrast = 'light';
      return n;
    }
    function closeFan(immediate = false) {
      clearTimeout(fanTimer); fanTimer = null;
      clearTimeout(closeTimer); closeTimer = null;
      if (!activeFan) return;
      const current = activeFan;
      if (immediate) {
        activeFan = null;
        current.element.remove();
        return;
      }
      current.closing = true;
      current.element.classList.add('g4a-genre-fan-closing');
      closeTimer = setTimeout(() => {
        if (activeFan === current) activeFan = null;
        current.element.remove();
      }, 130);
    }
    function scheduleCloseFan(r) {
      clearTimeout(fanTimer);
      fanTimer = setTimeout(() => {
        if (activeFan?.record === r) closeFan(false);
      }, 70);
    }
    function openFan(r, anchor) {
      if (!valid(r) || r.state !== 'success') return;
      const extra = (r.result?.labels || []).slice(1);
      if (!extra.length) return;
      clearTimeout(fanTimer); fanTimer = null;
      if (activeFan?.record === r && activeFan.element.isConnected && !activeFan.closing) return;
      closeFan(true);
      const defaultProvider = r.result?.selectedProvider || r.result?.provider || 'spotify';
      const fan = node('ul', null, { class: 'g4a-genre-fan', role: 'list', 'aria-label': 'Gêneros e subgêneros associados' });
      let delay = 0;
      extra.forEach((label, i) => {
        const item = chip(label, 'li', defaultProvider);
        item.classList.add('g4a-genre-fan-chip');
        const dur = Math.max(190, Math.round(320 * Math.pow(0.88, i)));
        item.style.setProperty('--g4a-i', String(i));
        item.style.setProperty('--g4a-delay', `${delay}ms`);
        item.style.setProperty('--g4a-dur', `${dur}ms`);
        delay += Math.max(24, Math.round(68 * Math.pow(0.78, i)));
        fan.append(item);
      });
      const rect = anchor.getBoundingClientRect();
      const estHeight = extra.length * 28 + 10;
      const vh = win.innerHeight || 800;
      const spaceBelow = vh - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const dir = spaceBelow < estHeight && spaceAbove > spaceBelow ? 'up' : 'down';
      fan.dataset.direction = dir;
      fan.style.left = `${Math.max(4, Math.round(rect.left - 6))}px`;
      if (dir === 'down') fan.style.top = `${Math.round(rect.bottom + 3)}px`;
      else fan.style.bottom = `${Math.round(vh - rect.top + 3)}px`;
      fan.addEventListener('mouseenter', () => { clearTimeout(fanTimer); fanTimer = null; });
      fan.addEventListener('mouseleave', () => scheduleCloseFan(r));
      for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup', 'contextmenu']) fan.addEventListener(type, e => e.stopPropagation());
      doc.body.append(fan);
      activeFan = { element: fan, record: r, anchor, closing: false };
    }
    function render(r) {
      if (!valid(r)) return;
      expire(r);
      const focused = doc.activeElement, restore = r.cell.contains(focused);
      if (activeFan?.record === r) closeFan(true);
      r.cell.replaceChildren(); r.cell.classList.add('g4a-genre-host'); r.cell.dataset.genreState = r.state;
      r.cell.setAttribute('aria-busy', String(r.state === 'loading'));
      if (r.state === 'success' && r.result?.labels?.length) {
        const defaultProvider = r.result.selectedProvider || r.result.provider || 'spotify';
        const primary = chip(r.result.labels[0], 'span', defaultProvider);
        primary.classList.add('g4a-genre-primary');
        primary.tabIndex = 0;
        const hasMore = r.result.labels.length > 1;
        primary.dataset.hasMore = String(hasMore);
        primary.setAttribute('aria-label', hasMore ? `${r.result.labels[0].label} (+${r.result.labels.length - 1} gêneros associados)` : r.result.labels[0].label);
        primary.addEventListener('mouseenter', () => openFan(r, primary));
        primary.addEventListener('mouseleave', () => scheduleCloseFan(r));
        primary.addEventListener('focus', () => openFan(r, primary));
        primary.addEventListener('blur', () => scheduleCloseFan(r));
        primary.addEventListener('keydown', e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFan(true); }
          else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); openFan(r, primary); }
        });
        r.cell.append(primary);
      } else {
        const st = node('span', stateLabel(r), { class: 'g4a-genre-state' });
        if (r.state === 'not_configured' && typeof options.onConfigure === 'function') {
          st.classList.add('g4a-genre-state-action');
          st.tabIndex = 0;
          st.setAttribute('role', 'button');
          st.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); options.onConfigure(); });
          st.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); options.onConfigure(); } });
        }
        r.cell.append(st);
      }
      if (restore) r.cell.querySelector('.g4a-genre-primary,.g4a-genre-state-action')?.focus({ preventScroll: true });
    }
    function release(cell) {
      const r = records.get(cell); if (!r) return;
      records.delete(cell); r.events?.abort(); r.task?.abort(); clearTimeout(r.expiry);
      if (activeFan?.record === r) closeFan(true);
      const rowSet = rowRecords.get(r.row);
      if (rowSet) {
        rowSet.delete(r);
        if (!rowSet.size) { rowRecords.delete(r.row); observer?.unobserve(r.row); }
      }
      cell.replaceChildren(); cell.classList.remove('g4a-genre-host'); delete cell.dataset.genreState; cell.removeAttribute('aria-busy');
      if (r.gridcell && ![...records.values()].some(other => other.gridcell === r.gridcell)) r.gridcell.classList.remove('g4a-genre-gridcell');
    }
    function prune() { for (const r of records.values()) if (!valid(r)) release(r.cell); }
    function schedule() { if (!closed && frame === null) frame = win.requestAnimationFrame(pump); }
    function pump() {
      frame = null; prune();
      const candidates = [];
      for (const r of records.values()) {
        if (isExpired(r) && !r.task) { clearTimeout(r.expiry); r.expiry = null; r.result = null; r.state = 'queued'; render(r); }
        if (r.visible && r.state === 'queued' && !r.task) candidates.push(r);
      }
      if (!candidates.length || active >= 24) return;
      if (candidates.length > 1) {
        const distances = new Map(candidates.map(r => [r, Math.abs(r.row.getBoundingClientRect().top)]));
        candidates.sort((a, b) => distances.get(a) - distances.get(b));
      }
      for (const r of candidates) { if (active >= 24) break; start(r); }
    }
    async function start(r) {
      if (!valid(r) || r.task) return;
      clearTimeout(r.expiry); r.expiry = null; r.state = 'loading'; r.result = null; render(r);
      const task = new AbortController(); r.task = task; active++;
      try {
        const result = await service.resolve(r.track, {
          signal: task.signal,
          onPreview: preview => {
            if (!valid(r) || task.signal.aborted || preview.configVersion !== r.revision) return;
            if (r.state === 'loading' || r.result?.isPreview) {
              r.result = preview;
              r.state = preview.status;
              render(r);
            }
          }
        });
        if (!valid(r) || task.signal.aborted || result.configVersion !== r.revision) return;
        r.result = result; r.state = result.status;
        render(r);
        const expiryTime = result.expiresAt || result.retryAt;
        if (['success', 'empty', 'no_match', 'rate_limited', 'error'].includes(result.status) && expiryTime) {
          const delay = Math.max(50, Math.min(expiryTime - Date.now(), 2147483647));
          r.expiry = setTimeout(() => {
            if (!valid(r)) return;
            r.expiry = null; r.result = null; r.state = 'queued';
            render(r); schedule();
          }, delay);
        }
      } catch { if (valid(r) && !task.signal.aborted) { r.result = { status: 'error', errorCode: 'GENRE_VIEW_FAILED' }; r.state = 'error'; render(r); } }
      finally { if (r.task === task) r.task = null; active--; if (valid(r) && (r.state === 'loading' || r.result?.isPreview) && task.signal.aborted) { r.result = null; r.state = 'queued'; } schedule(); }
    }
    const observer = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => {
      for (const entry of entries) {
        const rowSet = rowRecords.get(entry.target);
        if (!rowSet) continue;
        for (const r of rowSet) {
          r.visible = entry.isIntersecting;
          if (!r.visible && r.task) { r.task.abort(); r.result = null; r.state = 'queued'; render(r); }
        }
      }
      schedule();
    }, { rootMargin: '112px 0px' }) : null;
    function sync(container, configs) {
      if (closed || !container) return;
      const desired = new Set(), pendingMounts = [];
      const genreConfigs = configs.filter(c => c.type === 'genre');
      const context = options.getContext();
      for (const row of container.querySelectorAll('.main-trackList-trackListRow, [role="row"]')) {
        if (row.querySelector('[role="columnheader"]')) continue;
        for (const config of genreConfigs) {
          const cell = row.querySelector(config.dataSelector); if (!cell || cell.closest('.main-trackList-trackListRow, [role="row"]') !== row) continue;
          const uri = options.getUri(row); if (!uri) continue;
          desired.add(cell);
          const track = options.getTrack(row), identityKey = service.identityFor(track).key;
          const previous = records.get(cell);
          if (previous && valid(previous) && previous.identityKey === identityKey && previous.cell.firstChild) {
            if (isExpired(previous)) expire(previous);
            continue;
          }
          pendingMounts.push({ cell, row, track, identityKey, uri, context });
        }
      }
      if (pendingMounts.length) {
        // Read layout geometry in a single batch before performing DOM mutations.
        const vh = win.innerHeight || 800;
        const visibility = pendingMounts.map(({ row }) => {
          const rect = row.getBoundingClientRect();
          return rect.height > 0 && rect.bottom > -112 && rect.top < vh + 112;
        });
        for (let i = 0; i < pendingMounts.length; i++) {
          const { cell, row, track, identityKey, uri, context: ctx } = pendingMounts[i];
          release(cell);
          const gridcell = cell.closest('[role="gridcell"]'); gridcell?.classList.add('g4a-genre-gridcell');
          const safeTrack = track?.uri === uri ? track : { uri };
          const r = { cell, row, track: safeTrack, identityKey, uri, context: ctx, revision: service.revision, state: 'queued', result: null, visible: visibility[i], gridcell, events: new AbortController() };
          records.set(cell, r);
          let rowSet = rowRecords.get(row);
          if (!rowSet) { rowSet = new Set(); rowRecords.set(row, rowSet); observer?.observe(row); }
          rowSet.add(r);
          for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu']) {
            const stop = e => e.stopPropagation(); cell.addEventListener(type, stop, { signal: r.events.signal });
          }
          cell.addEventListener('keyup', e => { if ([' ', 'Enter', 'Escape', 'ArrowDown'].includes(e.key)) e.stopPropagation(); }, { signal: r.events.signal });
          render(r);
        }
      }
      for (const r of records.values()) if (container.contains(r.cell) && !desired.has(r.cell)) release(r.cell);
      prune(); fallbackVisibility(); schedule();
    }
    const unsubscribe = service.onChange(() => {
      for (const r of [...records.values()]) {
        if (r.revision !== service.revision || isExpired(r)) {
          r.task?.abort(); clearTimeout(r.expiry); r.expiry = null; r.revision = service.revision; r.state = 'queued'; r.result = null;
        }
        render(r);
      }
      prune(); schedule();
    });
    function fallbackVisibility() {
      if (observer) return;
      const vh = win.innerHeight || 800;
      const entries = [...records.values()].map(r => [r, r.row.getBoundingClientRect()]);
      for (const [r, rect] of entries) r.visible = rect.height > 0 && rect.bottom > 0 && rect.top < vh;
      schedule();
    }
    doc.addEventListener('scroll', () => { closeFan(true); fallbackVisibility(); }, { capture: true, passive: true, signal: lifecycle.signal });
    win.addEventListener('resize', () => { closeFan(true); fallbackVisibility(); }, { signal: lifecycle.signal });
    function recheckExpiry() {
      if (doc.hidden || closed) return;
      let needsPump = false;
      for (const r of records.values()) {
        if (isExpired(r) || (r.state === 'error' && ['SPOTIFY_TIMEOUT', 'SPOTIFY_METADATA_FAILED', 'SPOTIFY_METADATA_UNAVAILABLE', 'DISCOGS_TIMEOUT', 'MUSICBRAINZ_TIMEOUT'].includes(r.result?.errorCode))) {
          clearTimeout(r.expiry); r.expiry = null; r.result = null; r.state = 'queued';
          render(r); needsPump = true;
        } else if (r.result) {
          render(r);
        }
      }
      prune();
      if (needsPump) schedule();
    }
    doc.addEventListener('visibilitychange', recheckExpiry, { signal: lifecycle.signal });
    win.addEventListener('focus', recheckExpiry, { signal: lifecycle.signal });
    function reset() { closeFan(true); for (const cell of [...records.keys()]) release(cell); }
    function close() { reset(); closed = true; unsubscribe(); observer?.disconnect(); lifecycle.abort(); if (frame !== null) win.cancelAnimationFrame(frame); style.remove(); }
    return { sync, prune, reset, release, close, stats: () => ({ cells: records.size, active, observers: observer && !closed ? 1 : 0 }) };
  }
  return { PALETTE, INK, LIGHT_INK, colorFor, textColorFor, sourceLink, trackFromRow, createController };
})();

/* Genre aliases, families and validation copied/adapted from Sort-Play-2, MIT. */
const Genre4allCatalog = (() => {
  const GENRE_ALIASES_RAW = {
    "r&b": ["r&b","rnb","r and b","r n b","rhythm and blues","rhythm & blues","r&b's","rnb's","r & b","r'n'b","r-n-b","rythm and blues","rythym and blues","rhythm n blues","randb"],
    "contemporary r&b": ["contemporary r&b","contemporary rnb","contemporary r and b","contemporary rhythm and blues","modern r&b","modern rnb","rnb contemporain"],
    "alternative r&b": ["alternative r&b","alternative rnb","alt r&b","alt rnb","alt-rnb","alternate rnb"],
    "indie r&b": ["indie r&b","indie rnb","indie r and b"],
    "bedroom r&b": ["bedroom r&b","bedroom rnb"],
    "dark r&b": ["dark r&b","dark rnb","dark-rnb","dark r and b","dark rb"],
    "chill r&b": ["chill r&b","chill rnb","chill-rnb"],
    "pop r&b": ["pop r&b","pop rnb","pop-rnb","rnb pop"],
    "uk r&b": ["uk r&b","uk rnb","uk contemporary r&b","uk contemporary rnb","british r&b","british rnb"],
    "french r&b": ["french r&b","french rnb","r&b francais","rnb francais","french r and b"],
    "canadian contemporary r&b": ["canadian contemporary r&b","canadian contemporary rnb","canadian contemporary r and b","canadian r&b","canadian rnb"],
    "afro r&b": ["afro r&b","afro rnb","afro r and b"],
    "kenyan r&b": ["kenyan r&b","kenyan rnb","kenyan r and b"],
    "chinese r&b": ["chinese r&b","chinese rnb","chinese r and b","c-r&b","c-rnb"],
    "neo r&b": ["neo r&b","neo rnb","neo-r&b","neo-rnb","neo r and b"],
    "experimental r&b": ["experimental r&b","experimental rnb","experimental r and b","post-r&b","post-rnb","post r&b","post rnb","prog r&b","prog rnb","prog-rnb","progressive r&b","progressive rnb","future r&b","future rnb"],
    "deep r&b": ["deep r&b","deep rnb","deep r and b"],
    "deep smooth r&b": ["deep smooth r&b","deep smooth rnb","deep smooth r and b"],
    "australian r&b": ["australian r&b","australian rnb","australian r and b","aussie r&b","aussie rnb"],
    "dutch r&b": ["dutch r&b","dutch rnb","dutch r and b"],
    "german r&b": ["german r&b","german rnb","german r and b"],
    "scandinavian r&b": ["scandinavian r&b","scandinavian rnb","scandinavian r and b"],
    "south african r&b": ["south african r&b","south african rnb","south african r and b"],
    "r&b en espanol": ["r&b en espanol","rnb en espanol","r&b en español","rnb en español","latin r&b","latin rnb"],
    "r&b argentino": ["r&b argentino","rnb argentino","argentine r&b","argentine rnb"],
    "gospel r&b": ["gospel r&b","gospel rnb","gospel r and b","christian r&b","christian rnb"],
    "indonesian r&b": ["indonesian r&b","indonesian rnb","indonesian r and b"],
    "r&b italiano": ["r&b italiano","rnb italiano","italian r&b","italian rnb"],
    "90s r&b": ["90s r&b","90s rnb","90s r and b"],
    "pinoy r&b": ["pinoy r&b","pinoy rnb","filipino r&b","filipino rnb"],
    "r&b brasileiro": ["r&b brasileiro","rnb brasileiro","brazilian r&b","brazilian rnb"],
    "bulgarian r&b": ["bulgarian r&b","bulgarian rnb","bulgarian r and b"],
    "cloud r&b": ["cloud r&b","cloud rnb","cloud r and b"],
    "russian r&b": ["russian r&b","russian rnb","russian r and b"],
    "spanish r&b": ["spanish r&b","spanish rnb","spanish r and b"],
    "romanian r&b": ["romanian r&b","romanian rnb","romanian r and b"],
    "vietnamese r&b": ["vietnamese r&b","vietnamese rnb","vietnamese r and b"],
    "hindi r&b": ["hindi r&b","hindi rnb","hindi r and b"],
    "neo soul": ["neo soul","neosoul","neo-soul","nu soul","nu-soul","nusoul"],
    "quiet storm": ["quiet storm","slow jams","slow jam"],
    "hip hop": ["hip hop","hip-hop","hiphop","hip-hop music","hip hop's","hip-hops","hip-hip","hip hop/rap","hip-hop/rap","genre: hip-hop"],
    "lo-fi": ["lo-fi","lofi","lo fi","low-fi","low fi"],
    "lo-fi hip hop": ["lo-fi hip hop","lo-fi hip-hop","lofi hip hop","lofi hip-hop","lo-fi hiphop","lofi hiphop","lofi-hiphop"],
    "chillhop": ["chillhop","chill-hop","chill hop"],
    "lo-fi beats": ["lo-fi beats","lofi beats","lo-fi beat","low-fi beats","laid-back lofi beats","laid-back lo-fi beats"],
    "lo-fi house": ["lo-fi house","lofi house","lo fi house"],
    "lo-fi indie": ["lo-fi indie","lofi indie","lo fi indie","lo-fi indie rock","lofi indie rock"],
    "lo-fi emo": ["lo-fi emo","lofi emo","lo fi emo"],
    "lo-fi rap": ["lo-fi rap","lofi rap","lo fi rap"],
    "lo-fi chill": ["lo-fi chill","lofi chill","lo fi chill"],
    "lo-fi study": ["lo-fi study","lofi study","lo fi study"],
    "lo-fi sleep": ["lo-fi sleep","lofi sleep","lo fi sleep"],
    "lo-fi cover": ["lo-fi cover","lofi cover","lo fi cover"],
    "lo-fi jazzhop": ["lo-fi jazzhop","lofi jazzhop","lo fi jazzhop"],
    "lo-fi vgm": ["lo-fi vgm","lofi vgm","lo fi vgm"],
    "sad lo-fi": ["sad lo-fi","sad lofi","sad lo fi"],
    "ambient lo-fi": ["ambient lo-fi","ambient lofi","ambient lo fi"],
    "christian lo-fi": ["christian lo-fi","christian lofi","christian lo fi"],
    "late night lo-fi": ["late night lo-fi","late night lofi","late night lo fi"],
    "indonesian lo-fi pop": ["indonesian lo-fi pop","indonesian lofi pop","indonesian lo fi pop"],
    "brazilian lo-fi rock": ["brazilian lo-fi rock","brazilian lofi rock","brazilian lo fi rock"],
    "alternative hip hop": ["alternative hip hop","alt hip hop","alternative hip-hop","alt hip-hop","alternative hiphop","alternative rap","alt rap","alt-rap"],
    "underground hip hop": ["underground hip hop","underground hip-hop","underground hiphop"],
    "old school hip hop": ["old school hip hop","old school hip-hop","old school hiphop","oldschool hip hop","oldschool hip-hop","oldschool hiphop","old school rap","oldschool rap","old skool hip hop","old skool rap"],
    "golden age hip hop": ["golden age hip hop","golden age hip-hop","golden age rap"],
    "boom bap": ["boom bap","boombap","boom-bap"],
    "cloud rap": ["cloud rap","cloudrap","cloud-rap"],
    "emo rap": ["emo rap","emorap","emo-rap","emo hip hop","emo hip-hop","emo hiphop"],
    "pop rap": ["pop rap","pop-rap"],
    "hardcore hip hop": ["hardcore hip hop","hardcore rap","hardcore hip-hop"],
    "conscious hip hop": ["conscious hip hop","conscious rap","conscious hip-hop"],
    "political hip hop": ["political hip hop","political rap","political hip-hop"],
    "instrumental hip hop": ["instrumental hip hop","instrumental hip-hop","instrumental hiphop"],
    "jazz rap": ["jazz rap","jazz hop","jazz-hop","jazzhop","jazzy hip-hop","jazzy hip hop","jazz hip-hop","jazz hip hop"],
    "nerdcore": ["nerdcore","nerdcore hip hop","nerdcore hip-hop","nerdcore hiphop","nerd rap"],
    "horrorcore": ["horrorcore","horrorcore rap","horrocore","horrorkore"],
    "crunkcore": ["crunkcore","crunk core","scrunk"],
    "chopped and screwed": ["chopped and screwed","chopped n screwed","screwed and chopped"],
    "turntablism": ["turntablism","turntablist"],
    "trap": ["trap","trap music","trap rap","trap-rap"],
    "pop": ["pop","pop music","pop's","popmusic","pops"],
    "dance pop": ["dance pop","dance-pop","dancepop"],
    "indie pop": ["indie pop","indiepop","indie-pop"],
    "synthpop": ["synthpop","synth pop","synth-pop","synthiepop","tecnopop","technopop"],
    "electropop": ["electropop","electro-pop","electro pop","electronic pop","eletropop","elettropop"],
    "hyperpop": ["hyperpop","hyper pop","hyper-pop"],
    "dream pop": ["dream pop","dreampop","dream-pop"],
    "art pop": ["art pop","art-pop","artpop"],
    "noise pop": ["noise pop","noisepop","noise-pop"],
    "power pop": ["power pop","powerpop","power-pop"],
    "k-pop": ["k-pop","kpop","k pop","korean pop","korean kpop"],
    "k-rap": ["k-rap","krap","k rap","korean hip hop","korean rap","k-hip hop","khiphop","k-hiphop","k-hip-hop","khip-hop","khh","k-hh","korean hiphop"],
    "k-rock": ["k-rock","krock","k rock","korean rock"],
    "k-indie": ["k-indie","korean indie"],
    "k-ballad": ["k-ballad","k-ballads","kballad","k-pop ballad","kpop ballad","korean ballad"],
    "korean r&b": ["korean r&b","k-r&b","krnb","k-rnb","korean rnb","k rnb"],
    "trot": ["trot","k-trot","ktrot","k-pop trot","kpop trot","트로트"],
    "korean folk": ["korean folk","korean traditional","korean traditional music","gugak","fusion gugak","creative gugak"],
    "j-pop": ["j-pop","jpop","j pop","japanese pop","japan pop"],
    "j-rock": ["j-rock","jrock","j rock","japanese rock","japan rock"],
    "j-rap": ["j-rap","jrap","j rap","japanese hip hop","japanese rap","j-hiphop","j-hip hop","j-hip-hop","japanese hiphop"],
    "j-metal": ["j-metal","jmetal","japanese metal"],
    "j-indie": ["j-indie","japanese indie"],
    "j-r&b": ["j-r&b","j-rnb","jrnb","japanese r&b","japanese rnb"],
    "city pop": ["city pop","citypop","japanese city pop"],
    "kayokyoku": ["kayokyoku","kayoukyoku","kayōkyoku"],
    "visual kei": ["visual kei","vkei","v-kei","visual-kei","visual key","v-rock"],
    "j-poprock": ["j-poprock","j-pop rock","jpop rock"],
    "vocarock": ["vocarock","vocaloid rock","vocalorock"],
    "vocaloid": ["vocaloid","vocaloidp","vocaloid-p"],
    "anison": ["anison","anisong","anime song","anime music"],
    "c-pop": ["c-pop","cpop","c pop","chinese pop","mainland chinese pop"],
    "mandopop": ["mandopop","mando pop","mandarin pop"],
    "cantopop": ["cantopop","canto pop"],
    "p-pop": ["p-pop","ppop","p pop","pinoy pop","filipino pop"],
    "opm": ["opm","original pilipino music","original pinoy music","filipino music"],
    "pinoy hip hop": ["pinoy hip hop","pinoy rap","filipino rap","tagalog rap"],
    "pinoy rock": ["pinoy rock","filipino rock","opm rock"],
    "v-pop": ["v-pop","vpop","v pop"],
    "vietnamese hip hop": ["vietnamese hip hop","vietnamese rap","rap viet","vietrap"],
    "vinahouse": ["vinahouse","vina house"],
    "t-pop": ["t-pop","tpop","t pop"],
    "indonesian pop": ["indonesian pop","indo pop","pop indonesia"],
    "rock and roll": ["rock & roll","rock n roll","rock and roll","rock'n'roll","rock-and-roll","rock 'n' roll","rock'n roll","rock 'n roll","rocknroll","rock&roll","rockandroll","rocanrol"],
    "alternative rock": ["alternative rock","alt rock","alt-rock","alt. rock","alt.rock","altrock","alternate rock","alternativerock"],
    "indie rock": ["indie rock","indierock","indie-rock"],
    "indie folk": ["indie folk","indiefolk","indie-folk"],
    "indietronica": ["indietronica","indietronic","indie electronic","indie electronica","indie-electro"],
    "hard rock": ["hard rock","hardrock","hard rock music","hard rock's","hard-rock","hardrockmusic","rock duro"],
    "soft rock": ["soft rock","softrock"],
    "aor": ["aor","album oriented rock"],
    "psychedelic rock": ["psychedelic rock","psych rock","psychodelic rock","psychadelic rock"],
    "psychedelic pop": ["psychedelic pop","psych pop","psych-pop","psychedelica"],
    "psychedelic folk": ["psychedelic folk","psych folk","psych-folk"],
    "garage rock": ["garage rock","garage-rock"],
    "proto-punk": ["proto-punk","protopunk","proto punk"],
    "pop punk": ["pop punk","poppunk","pop-punk","punk pop","punk-pop"],
    "post-punk": ["post-punk","postpunk","post punk"],
    "post-hardcore": ["post-hardcore","post hardcore","posthardcore"],
    "new wave": ["new wave","newwave"],
    "post-rock": ["post-rock","postrock","post rock"],
    "post-metal": ["post-metal","post metal"],
    "math rock": ["math rock","mathrock","math-rock"],
    "noise rock": ["noise rock","noiserock","noise-rock"],
    "shoegaze": ["shoegaze","shoe gaze","shoegazer","shoegazing","shogaze"],
    "nu gaze": ["nu gaze","nu-gaze","nugaze"],
    "blackgaze": ["blackgaze","black gaze"],
    "folk pop": ["folk pop","folk-pop","folkpop"],
    "anti-folk": ["anti-folk","anti folk"],
    "neo-psychedelia": ["neo-psychedelia","neo psychedelia","neopsychedelia","neo-psychedelic","neo psychedelic"],
    "post-grunge": ["post-grunge","post grunge","postgrunge"],
    "dance-punk": ["dance-punk","dance punk","dancepunk","disco punk","discopunk"],
    "midwest emo": ["midwest emo","midwestern emo"],
    "screamo": ["screamo","skramz","real screamo","scramz"],
    "emoviolence": ["emoviolence","emo violence","emo-violence"],
    "idm": ["idm","intelligent dance music"],
    "metal": ["metal","metal's","metalhead","metallic","metalmusic","metals"],
    "heavy metal": ["heavy metal","heavymetal","traditional heavy metal","trad metal"],
    "nwobhm": ["nwobhm","new wave of british heavy metal"],
    "death metal": ["death metal","deathmetal"],
    "melodic death metal": ["melodic death metal","melodeath","melo-death"],
    "technical death metal": ["technical death metal","tech death","tech-death"],
    "slam death metal": ["slam death metal","slamming brutal death metal","slamming death metal","slam brutal death metal","slamming brutal death","slam metal"],
    "death-doom": ["death-doom","death doom","death doom metal","death-doom metal","death/doom metal","doom death metal","doom-death metal","doom/death"],
    "death 'n' roll": ["death 'n' roll","death n roll","death'n'roll","death and roll"],
    "black metal": ["black metal","blackmetal"],
    "depressive suicidal black metal": ["depressive suicidal black metal","dsbm","suicidal black metal","depressive black metal"],
    "nsbm": ["nsbm","national socialist black metal"],
    "black 'n' roll": ["black 'n' roll","black n roll","black'n'roll"],
    "norwegian black metal": ["norwegian black metal","true norwegian black metal","tnbm"],
    "black thrash": ["black thrash","black-thrash","black/thrash","black thrash metal","black-thrash metal","black/thrash metal"],
    "deathrash": ["deathrash","death thrash","death-thrash","death/thrash","death thrash metal","death-thrash metal","death/thrash metal","thrash death metal"],
    "black death": ["black death","black death metal","black/death metal","black-death metal","death black metal"],
    "old school death metal": ["old school death metal","oldschool death metal","old-school death metal"],
    "old school thrash": ["old school thrash","old school thrash metal","oldschool thrash","oldschool thrash metal"],
    "metalcore": ["metalcore","metal core"],
    "deathcore": ["deathcore","death core"],
    "mathcore": ["mathcore","math core"],
    "grindcore": ["grindcore","grind core","grind"],
    "goregrind": ["goregrind","gore grind"],
    "pornogrind": ["pornogrind","porngrind","porno grind"],
    "mincecore": ["mincecore","mince","mincegore"],
    "nu metal": ["nu metal","numetal","nu-metal"],
    "alternative metal": ["alternative metal","alt metal","alt. metal","alt-metal","altmetal"],
    "power metal": ["power metal","powermetal"],
    "thrash metal": ["thrash metal","thrash","thrashmetal"],
    "crossover thrash": ["crossover thrash","crossover thrash metal","thrash crossover"],
    "doom metal": ["doom metal","doommetal"],
    "funeral doom": ["funeral doom","funeral doom metal"],
    "epic doom": ["epic doom","epic doom metal"],
    "drone metal": ["drone metal","drone doom","drone doom metal"],
    "stoner metal": ["stoner metal","stoner doom","stoner doom metal","stoner-doom"],
    "stoner rock": ["stoner rock","stoner"],
    "sludge metal": ["sludge metal","sludge"],
    "progressive metal": ["progressive metal","prog metal","prog-metal","progmetal","metal prog"],
    "progressive rock": ["progressive rock","prog rock","prog-rock","progrock","prog"],
    "symphonic prog": ["symphonic prog","symphonic progressive rock"],
    "rock progressivo italiano": ["rock progressivo italiano","italian prog","italian symphonic prog","italian progressive rock","rpi"],
    "krautrock": ["krautrock","kosmische","kosmische musik"],
    "electronic": ["electronic","electronic music","electronic's","electronico","electronics","electronik","eletronic","electronique","elektronik","eletronica","elettronica","electrónica","electonic"],
    "electronica": ["electronica","electronicas"],
    "edm": ["edm","electronic dance","electronic dance music","edm music","edm's","edmmusic"],
    "house": ["house","house music","house's","housemusic"],
    "deep house": ["deep house","deephouse"],
    "tech house": ["tech house","techhouse"],
    "progressive house": ["progressive house","prog house","progessive house"],
    "electro house": ["electro house","electrohouse"],
    "bass house": ["bass house","basshouse"],
    "slap house": ["slap house","slaphouse"],
    "big room": ["big room","big room house","bigroom","bigroom house"],
    "melbourne bounce": ["melbourne bounce","melbourne bounce international"],
    "french house": ["french house","french touch"],
    "electro swing": ["electro swing","electroswing","electro-swing"],
    "eurodance": ["eurodance","euro dance","euro-dance"],
    "italo disco": ["italo disco","italo-disco","italodisco"],
    "italo dance": ["italo dance","italo-dance","italodance"],
    "hi-nrg": ["hi-nrg","hi nrg","high energy"],
    "drum and bass": ["drum and bass","dnb","d&b","drum n bass","drum & bass","drumandbass","drum'n'bass","drumnbass","drum 'n' bass","drum n' bass","drum 'n bass","d'n'b","drum and base","drumnbase"],
    "liquid funk": ["liquid funk","liquid dnb","liquid drum and bass","liquid drum & bass","liquidfunk"],
    "atmospheric dnb": ["atmospheric dnb","atmospheric drum and bass","atmospheric drum & bass","atmospheric drum n bass","intelligent drum and bass","intelligent drum n bass","athmospheric dnb","athmospheric drum and bass","atmosphere drum and bass"],
    "soulful dnb": ["soulful dnb","soulful drum and bass","soulful drum & bass","soulful drum n bass"],
    "jungle dnb": ["jungle dnb","jungle drum and bass","jungle drum & bass"],
    "ragga jungle": ["ragga jungle","raggajungle"],
    "dancefloor dnb": ["dancefloor dnb","dancefloor drum and bass","dancefloor drum & bass","dancefloor drum n bass"],
    "deep dnb": ["deep dnb","deep drum and bass","deep drum & bass","deep drum n bass"],
    "minimal dnb": ["minimal dnb","minimal drum and bass","minimal drum & bass","minimal drum n bass"],
    "jazzy dnb": ["jazzy dnb","jazzy drum and bass","jazzy drum & bass","jazzy drum n bass","jazz dnb","jazz drum and bass"],
    "halftime dnb": ["halftime dnb","halftime drum and bass","halftime drum & bass"],
    "uk dnb": ["uk dnb","uk drum and bass","uk drum & bass","british drum and bass","british dnb"],
    "belgian dnb": ["belgian dnb","belgian drum and bass"],
    "dutch dnb": ["dutch dnb","dutch drum and bass"],
    "french dnb": ["french dnb","french drum and bass"],
    "german dnb": ["german dnb","german drum and bass"],
    "austrian dnb": ["austrian dnb","austrian drum and bass"],
    "russian dnb": ["russian dnb","russian drum and bass"],
    "nz dnb": ["nz dnb","nz drum and bass","new zealand dnb","new zealand drum and bass"],
    "south african dnb": ["south african dnb","south african drum and bass"],
    "brazilian dnb": ["brazilian dnb","brazilian drum and bass"],
    "stateside dnb": ["stateside dnb","stateside drum and bass","american dnb","american drum and bass","us dnb"],
    "ambient dnb": ["ambient dnb","ambient drum and bass","ambient drum & bass","ambient drum n bass"],
    "melodic dnb": ["melodic dnb","melodic drum and bass","melodic drum & bass"],
    "vocal drum and bass": ["vocal drum and bass","vocal dnb","vocal drum & bass"],
    "dark drum and bass": ["dark drum and bass","dark dnb","dark drum & bass"],
    "lo-fi dnb": ["lo-fi dnb","lofi dnb","lo-fi drum and bass","lofi drum and bass"],
    "futurepop": ["futurepop","future pop","future-pop"],
    "jackin' house": ["jackin' house","jackin house","jacking house"],
    "two-tone": ["two-tone","two tone","2-tone","2 tone","2tone"],
    "uk garage": ["uk garage","ukg","uk-garage","2-step garage"],
    "2-step": ["2-step","2step","two-step"],
    "uk drill": ["uk drill","british drill","drill uk"],
    "uk hip hop": ["uk hip hop","uk rap","british hip hop","british rap","ukhh"],
    "australian hip hop": ["australian hip hop","aussie hip hop","aussie hip-hop","australian rap","aussie rap","aus rap","oz hip hop","oz hip-hop"],
    "australian rock": ["australian rock","aussie rock","oz rock"],
    "canadian hip hop": ["canadian hip hop","canadian rap"],
    "psytrance": ["psytrance","psy trance","psy-trance","psychedelic trance"],
    "dark psytrance": ["dark psytrance","darkpsy","dark psy","darkpsytrance","dark psychedelic trance"],
    "goa trance": ["goa trance","goa","goatrance","goa psytrance"],
    "psybient": ["psybient","psy-ambient","psyambient","psychill","psy-chill"],
    "uplifting trance": ["uplifting trance","epic trance","euphoric trance"],
    "progressive trance": ["progressive trance","prog trance","progessive trance"],
    "hard trance": ["hard trance","hardtrance","hard-trance"],
    "hardstyle": ["hardstyle","harstyle","hardsytle"],
    "hard techno": ["hard techno","hardtechno","hard-techno"],
    "hardtek": ["hardtek","hard tek","hardtekno","hard tekno","tekno","tekkno","tekk"],
    "minimal techno": ["minimal techno","minimaltechno","mnml"],
    "dub techno": ["dub techno","dubtechno","dub-techno"],
    "acid techno": ["acid techno","acidtechno"],
    "ebm": ["ebm","electronic body music"],
    "neue deutsche harte": ["neue deutsche harte","neue deutsche härte","neue deutsche haerte","ndh"],
    "psychedelic": ["psychedelic","psych","psychedelia"],
    "synthwave": ["synthwave","synth wave","synth-wave","synthwave's","retrowave","new retro wave","new retrowave","outrun","futuresynth"],
    "darksynth": ["darksynth","dark synth","dark synthwave"],
    "vaporwave": ["vaporwave","vapor wave"],
    "chillwave": ["chillwave","chill wave","glo-fi"],
    "witch house": ["witch house","witchhouse","witch-house"],
    "chiptune": ["chiptune","chiptunes","chipmusic","8-bit","8bit","8 bit"],
    "vgm": ["vgm","video game music","videogame music","video game soundtrack","videogame soundtrack","video game ost","videogame ost","game music","game soundtrack","game ost","game score","video game","video games","videogame","videogames"],
    "latin": ["latin","latin music","latin's","latina","latinas","latinmusic","latino","latinos"],
    "urbano latino": ["urbano latino","latin urban","urbano","urban latin","musica urbana"],
    "latin trap": ["latin trap","trap latino"],
    "reggaeton": ["reggaeton","reggaetón","regueton","reggeaton","reggeton","raggaeton"],
    "regional mexican": ["regional mexican","regional mexicano","musica mexicana","música mexicana","regional mexicana"],
    "norteno": ["norteno","norteño","nortena","norteña","musica nortena"],
    "sierreno": ["sierreno","sierreño","sierrena","sierreña","sierre"],
    "corridos tumbados": ["corridos tumbados","corrido tumbado"],
    "corridos belicos": ["corridos belicos","corridos bélicos","corridos belico","corridos bélico"],
    "sierreno urbano": ["sierreno urbano","sierreño urbano","urban sierreno","urban sierreño"],
    "mariachi": ["mariachi","mariachis"],
    "ranchera": ["ranchera","rancheras","ranchero","pura ranchera","puro ranchero"],
    "bolero": ["bolero","boleros"],
    "vallenato": ["vallenato","vallenatos"],
    "cumbia": ["cumbia","cumbias"],
    "salsa": ["salsa","salsas","salsa music"],
    "bachata": ["bachata","bachatas"],
    "bossa nova": ["bossa nova","bossanova","bossa","bossa-nova"],
    "samba": ["samba","samba raiz","samba de raiz"],
    "mpb": ["mpb","musica popular brasileira","música popular brasileira","musica brasileira"],
    "funk carioca": ["funk carioca","baile funk","brazilian funk","funk brasileiro","brazil funk","favela funk","carioca funk","br funk","funk br","funk brasil","brasil funk"],
    "brega funk": ["brega funk","bregafunk"],
    "funk mandelao": ["funk mandelao","funk mandelão","mandelao","mandelão"],
    "funk ostentacao": ["funk ostentacao","funk ostentação"],
    "funk mtg": ["funk mtg","mtg funk","funk montagem","montagem funk"],
    "trap brasileiro": ["trap brasileiro","brazilian trap","trap nacional","trap br","brazil trap","trapbrazilian"],
    "phonk brasileiro": ["phonk brasileiro","brazilian phonk","brazil phonk","brazillian phonk"],
    "drill brasileiro": ["drill brasileiro","brazilian drill","drill br"],
    "brazilian hip hop": ["brazilian hip hop","rap nacional","hip hop nacional","rap brasileiro","hip hop brasileiro","brazilian rap","rap br"],
    "brazilian rock": ["brazilian rock","rock brasileiro","brock","rock brasil","rock nacional brasileiro"],
    "brazilian metal": ["brazilian metal","metal brasil","heavy metal brasil"],
    "pop nacional": ["pop nacional","brazilian pop","pop brasileiro"],
    "sertanejo": ["sertanejo","musica sertaneja","música sertaneja","sertaneja","brazilian country"],
    "funk paulista": ["funk paulista","funk sp"],
    "funk das antigas": ["funk das antigas","funk antigo"],
    "sertanejo universitario": ["sertanejo universitario","sertanejo universitário"],
    "forro": ["forro","forró"],
    "piseiro": ["piseiro","pisadinha"],
    "axé": ["axé","axe","axe music","brazilian axe"],
    "pagode": ["pagode"],
    "french hip hop": ["french hip hop","french rap","rap francais","rap français","hip hop francais","rapfr","rap fr","rap cefran","french hiphop"],
    "drill francais": ["drill francais","french drill","drill fr"],
    "french rock": ["french rock","rock francais","rock français"],
    "chanson": ["chanson","chanson francaise","chanson française","chansons"],
    "german hip hop": ["german hip hop","german rap","deutschrap","deutsch rap","german hiphop","deutscher hip hop","deutscher hiphop","deutscher rap","germanrap"],
    "german pop": ["german pop","deutschpop","deutsch pop"],
    "german rock": ["german rock","deutschrock","deutsch rock"],
    "german punk": ["german punk","deutschpunk","deutsch punk"],
    "neue deutsche welle": ["neue deutsche welle","ndw"],
    "schlager": ["schlager","german schlager","deutsche schlager","deutscher schlager"],
    "dutch hip hop": ["dutch hip hop","nederhop","dutch rap"],
    "dutch pop": ["dutch pop","nederpop"],
    "spanish hip hop": ["spanish hip hop","spanish rap","rap espanol","rap español"],
    "spanish pop": ["spanish pop","pop espanol","pop español"],
    "spanish rock": ["spanish rock","rock espanol","rock español"],
    "italian hip hop": ["italian hip hop","italian rap","rap italiano","hip hop italiano","italo rap"],
    "trap italiana": ["trap italiana","italian trap"],
    "drill italiana": ["drill italiana","drill italiano","italian drill"],
    "italian pop": ["italian pop","pop italiano","musica italiana","musica leggera"],
    "itpop": ["itpop","italian indie pop","indie italiano","italian indie"],
    "italian rock": ["italian rock","rock italiano"],
    "polish hip hop": ["polish hip hop","polish rap","polski rap","rap polski","polski hip hop","polski hip-hop"],
    "polish rock": ["polish rock","polski rock"],
    "polish punk": ["polish punk","polski punk"],
    "disco polo": ["disco polo","discopolo"],
    "sung poetry": ["sung poetry"],
    "poezja spiewana": ["poezja spiewana","poezja śpiewana"],
    "russian hip hop": ["russian hip hop","russian rap","russian hiphop","русский рэп"],
    "russian pop": ["russian pop"],
    "russian rock": ["russian rock","russkiy rok"],
    "russian chanson": ["russian chanson","blatnyak","shanson"],
    "russian bard": ["russian bard","avtorskaya pesnya","russian guitar song"],
    "hardbass": ["hardbass","hard bass"],
    "ukrainian pop": ["ukrainian pop"],
    "ukrainian hip hop": ["ukrainian hip hop","ukrainian rap","ukranian rap"],
    "romanian hip hop": ["romanian hip hop","romanian hip-hop","romanian hiphop","romanian rap"],
    "swedish hip hop": ["swedish hip hop","swedish hip-hop","swedish hiphop","swedish rap","svensk hip hop","svensk rap"],
    "norwegian hip hop": ["norwegian hip hop","norwegian hip-hop","norwegian hiphop","norwegian rap","norsk hip hop","norsk hiphop","norsk rap"],
    "danish hip hop": ["danish hip hop","danish hip-hop","danish hiphop","danish rap","dansk rap","dansk hip hop"],
    "finnish hip hop": ["finnish hip hop","finnish hip-hop","finnish hiphop","finnish rap"],
    "icelandic hip hop": ["icelandic hip hop","icelandic hip-hop","icelandic hiphop","icelandic rap"],
    "greek hip hop": ["greek hip hop","greek hip-hop","greek hiphop","greek rap"],
    "serbian hip hop": ["serbian hip hop","serbian hip-hop","serbian hiphop","serbian rap"],
    "croatian hip hop": ["croatian hip hop","croatian hip-hop","croatian hiphop","croatian rap"],
    "bulgarian hip hop": ["bulgarian hip hop","bulgarian hip-hop","bulgarian hiphop","bulgarian rap"],
    "albanian hip hop": ["albanian hip hop","albanian hip-hop","albanian hiphop","albanian rap"],
    "hungarian hip hop": ["hungarian hip hop","hungarian hip-hop","hungarian hiphop","hungarian rap","magyar rap","magyar hip hop"],
    "czech hip hop": ["czech hip hop","czech hip-hop","czech hiphop","czech rap","cesky rap"],
    "slovak hip hop": ["slovak hip hop","slovak hip-hop","slovak hiphop","slovak rap","slovensky rap"],
    "kazakh hip hop": ["kazakh hip hop","kazakh hip-hop","kazakh hiphop","kazakh rap"],
    "israeli hip hop": ["israeli hip hop","israeli hip-hop","israeli hiphop","israeli rap"],
    "pakistani hip hop": ["pakistani hip hop","pakistani hip-hop","pakistani hiphop","pakistani rap","urdu rap"],
    "tamil hip hop": ["tamil hip hop","tamil hip-hop","tamil hiphop","tamil rap"],
    "indonesian hip hop": ["indonesian hip hop","indonesian hip-hop","indonesian hiphop","indonesian rap"],
    "malaysian hip hop": ["malaysian hip hop","malaysian hip-hop","malaysian hiphop","malaysian rap","malay rap"],
    "thai hip hop": ["thai hip hop","thai hip-hop","thai hiphop","thai rap"],
    "chinese hip hop": ["chinese hip hop","chinese hip-hop","chinese hiphop","chinese rap","c-rap","mandarin rap"],
    "taiwan hip hop": ["taiwan hip hop","taiwanese hip hop","taiwanese rap","taiwan rap"],
    "hong kong hip hop": ["hong kong hip hop","hk hip hop","hk rap","cantonese rap"],
    "south african hip hop": ["south african hip hop","south african hip-hop","south african hiphop","south african rap"],
    "nigerian hip hop": ["nigerian hip hop","nigerian hip-hop","nigerian hiphop","nigerian rap","naija rap"],
    "ghanaian hip hop": ["ghanaian hip hop","ghanaian hip-hop","ghanaian hiphop","ghanaian rap"],
    "kenyan hip hop": ["kenyan hip hop","kenyan hip-hop","kenyan hiphop","kenyan rap"],
    "tanzanian hip hop": ["tanzanian hip hop","tanzanian hip-hop","tanzanian hiphop","tanzanian rap"],
    "egyptian hip hop": ["egyptian hip hop","egyptian hip-hop","egyptian hiphop","egyptian rap"],
    "romanian pop": ["romanian pop"],
    "balkan": ["balkan","balkan music","balkans"],
    "turbo-folk": ["turbo-folk","turbofolk","turbo folk"],
    "ex-yu rock": ["ex-yu rock","yugoslav rock","ex-yu","ex yu","novi val","yugo wave"],
    "turkish hip hop": ["turkish hip hop","turkish rap","turkce rap","türkçe rap","turkish hiphop","turkcerap","turkishrap"],
    "turkish pop": ["turkish pop","turkce pop","türkçe pop","turhish pop"],
    "turkish rock": ["turkish rock","turkce rock","türkçe rock","turk rock","turkcerock"],
    "anatolian rock": ["anatolian rock","anadolu rock"],
    "turkish folk": ["turkish folk","turk halk muzigi","türk halk müziği","halk muzigi","turkish folk music","turkce folk","türkü","turku"],
    "turkish classical": ["turkish classical","turk sanat muzigi","türk sanat müziği","turk sanat musikisi","turkish classical music","turkish art music","klasik turk muzigi"],
    "arabesk": ["arabesk","arabesque","turkish arabesque"],
    "arabic pop": ["arabic pop","arab pop"],
    "arabic hip hop": ["arabic hip hop","arabic rap","arab rap"],
    "khaleeji": ["khaleeji","khaliji","khaliji pop","khaleeji iraqi"],
    "rai": ["rai","raï"],
    "mahraganat": ["mahraganat","electro shaabi"],
    "moroccan rap": ["moroccan rap","rap maroc","rap marocain"],
    "persian pop": ["persian pop","farsi pop","iranian pop"],
    "persian hip hop": ["persian hip hop","persian rap","rap farsi","iranian hip hop","iranian rap"],
    "persian traditional": ["persian traditional","classical persian","iranian traditional","sonati","persian classical","persian classical music","iranian traditional music"],
    "bollywood pop": ["bollywood pop","bollywood","bollywood music","hindi film","indian film"],
    "desi hip hop": ["desi hip hop","desi rap","desi hiphop","indian hip hop","indian hip-hop","indian rap","hindi hip hop","hindi rap"],
    "punjabi hip hop": ["punjabi hip hop","punjabi rap"],
    "indian classical": ["indian classical","indian classical music"],
    "singer-songwriter": ["singer-songwriter","singer songwriter","singer/songwriter","singer-songwriters","singersongwriter"],
    "cantautori": ["cantautori","cantautore","italian songwriter","italian songwriters","cantautorato"],
    "nu disco": ["nu disco","nu-disco","nudisco"],
    "soundtrack": ["soundtrack","soundtracks","ost","original soundtrack","film score","movie soundtrack","movie score","film soundtrack"],
    "show tunes": ["show tunes","showtunes","show tune","musical theatre","musical theater","musicals"],
    "country": ["country","country music","country's","countrymusic"],
    "contemporary country": ["contemporary country","modern country"],
    "country pop": ["country pop","country-pop","pop country"],
    "traditional country": ["traditional country","old country"],
    "neo-traditional country": ["neo-traditional country","neo-traditionalist country","new traditionalist","new traditionalist country"],
    "alternative country": ["alternative country","alt-country","alt country","alt.country","altcountry"],
    "country rock": ["country rock","country-rock","countryrock"],
    "bluegrass": ["bluegrass","blue grass","blugrass","traditional bluegrass"],
    "old-time": ["old-time","old time","old-timey","old timey","old time music","old-time music"],
    "classical": ["classical","classical music","classical's"],
    "orchestral": ["orchestral","orchestral music","orchestras"],
    "contemporary classical": ["contemporary classical","modern classical","21st century classical"],
    "baroque": ["baroque","baroque's","baroque music","baroque era","baroque period"],
    "opera": ["opera","operatic","opera music"],
    "choral": ["choral","choir","choral music"],
    "world": ["world","world music","worldbeat","world beat"],
    "christian": ["christian","christian music","musica cristiana","musica crista","christelijk"],
    "christian pop": ["christian pop","ccm","contemporary christian","contemporary christian music"],
    "christian hip hop": ["christian hip hop","christian rap","gospel rap","holy hip hop","holy hip-hop","chh","rap cristiano","rap cristao"],
    "christian rock": ["christian rock","rock cristiano"],
    "worship": ["worship","praise and worship","praise & worship","contemporary worship","worship music","alabanza","adoracion","louvor","adoracao","lobpreis"],
    "christmas": ["christmas","christmas music","christmas songs","xmas","x-mas","holiday","holiday music"],
    "children's music": ["children's music","childrens music","children music","childrens","kids music"],
    "spoken word": ["spoken word","poetry","poesia","poésie","poesie"],
    "audiobook": ["audiobook","audiobooks","audio book","audio drama","radio drama"],
    "hoerspiel": ["hoerspiel","hörspiel","hoerbuch"],
    "stand-up comedy": ["stand-up comedy","stand-up","standup","standup comedy","comedian"],
    "rock": ["rock","rock music","rock's","rockmusic","rocks","rockin","rockin'"],
    "glam rock": ["glam rock","glamrock"],
    "glam metal": ["glam metal","hair metal","sleaze metal"],
    "blues rock": ["blues rock","blues-rock","bluesrock"],
    "folk rock": ["folk rock","folk-rock","folkrock"],
    "pop rock": ["pop rock","pop rock music","pop rock's","pop-rock","poprock","poprockmusic","rock pop","rock-pop","pop/rock"],
    "surf rock": ["surf rock","surf","instrumental surf rock"],
    "rockabilly": ["rockabilly","rock-a-billy"],
    "neo-rockabilly": ["neo-rockabilly","neo rockabilly"],
    "psychobilly": ["psychobilly","psycho-billy"],
    "gothabilly": ["gothabilly","hellbilly"],
    "gothic rock": ["gothic rock","goth rock","goth","gothrock"],
    "deathrock": ["deathrock","death rock","death-rock"],
    "dark wave": ["dark wave","darkwave","dark-wave"],
    "coldwave": ["coldwave","cold wave","french coldwave","french cold wave"],
    "neofolk": ["neofolk","neo-folk","neo folk"],
    "synth punk": ["synth punk","synthpunk","synth-punk","electropunk","electro-punk","electro punk","elektropunk"],
    "electroclash": ["electroclash","electro-clash","electro clash"],
    "indie": ["indie","indie's","indiemusic","indies","indie music"],
    "dance": ["dance","dance music","dance's","dances","dancey"],
    "jazz": ["jazz","jazz's","jazzier","jazziest","jazzmusic","jazzy"],
    "vocal jazz": ["vocal jazz","jazz vocal","jazzvocal","jazz singing"],
    "smooth jazz": ["smooth jazz"],
    "acid jazz": ["acid jazz","acidjazz"],
    "nu jazz": ["nu jazz","nujazz","nu-jazz","future jazz","jazztronica"],
    "jazz fusion": ["jazz fusion","jazz-fusion","jazzfusion"],
    "jazz rock": ["jazz rock","jazz-rock","jazzrock"],
    "jazz funk": ["jazz funk","jazz-funk","jazzfunk","funk jazz"],
    "gypsy jazz": ["gypsy jazz","jazz manouche","gipsy jazz"],
    "big band": ["big band","big band jazz","bigband","jazz orchestra"],
    "dixieland": ["dixieland","dixieland jazz","trad jazz","hot jazz"],
    "swing": ["swing","swing music"],
    "folk": ["folk","folk music","folk's","folkie","folkier","folklore","folkmusic","folksy"],
    "folk punk": ["folk punk","folkpunk","folk-punk"],
    "celtic": ["celtic","celtic music","celtic folk"],
    "irish folk": ["irish folk","traditional irish","irish traditional","irish folk music","irish traditional music"],
    "sea shanties": ["sea shanties","sea shanty","shanties","shanty"],
    "klezmer": ["klezmer","yiddish"],
    "fado": ["fado"],
    "flamenco": ["flamenco"],
    "nuevo flamenco": ["nuevo flamenco","new flamenco","flamenco nuevo","flamenco fusion"],
    "tango": ["tango","tango argentino","argentine tango"],
    "nuevo tango": ["nuevo tango","tango nuevo","neotango","neo-tango","electrotango","tango electronico"],
    "rap": ["rap","rap music","raps","rapper","rappers"],
    "gangster rap": ["gangster rap","gangsta rap","gangsta-rap","gangsta","gangsterrap","gangstarap"],
    "southern hip hop": ["southern hip hop","southern rap","dirty south","dirty south rap","south rap"],
    "memphis rap": ["memphis rap","memphis hip hop","memphisrap"],
    "east coast hip hop": ["east coast hip hop","east coast rap"],
    "west coast hip hop": ["west coast hip hop","west coast rap","westcoast rap","westcoast hip hop"],
    "g-funk": ["g-funk","g funk","gfunk","gangsta funk"],
    "p-funk": ["p-funk","p funk","pfunk"],
    "miami bass": ["miami bass"],
    "punk": ["punk","punk music","punk's","punkmusic","punks","punky","punk rock","punkrock","punk-rock"],
    "hardcore punk": ["hardcore punk","hardcore-punk","hardcorepunk","hc punk"],
    "crust punk": ["crust punk","crust","crustcore"],
    "d-beat": ["d-beat","dbeat","d beat"],
    "powerviolence": ["powerviolence","power violence"],
    "street punk": ["street punk","streetpunk"],
    "oi": ["oi","oi!","oi punk","oi-punk","oicore","skinhead oi"],
    "skate punk": ["skate punk","skatepunk","skate-punk"],
    "anarcho-punk": ["anarcho-punk","anarcho punk","anarchopunk","anarcopunk"],
    "riot grrrl": ["riot grrrl","riot grrl","riot girl"],
    "horror punk": ["horror punk","horrorpunk"],
    "ska": ["ska"],
    "ska punk": ["ska punk","skapunk","ska-punk"],
    "rocksteady": ["rocksteady","rock steady"],
    "soul": ["soul","soul music","soul's","soulmusic","souly"],
    "doo-wop": ["doo-wop","doo wop","doowop"],
    "new jack swing": ["new jack swing"],
    "blues": ["blues","blues music","blues'","bluesier","bluesiest","bluesmusic","bluesy"],
    "alternative": ["alt","alternative","alternative music","alternative's","alternativemusic","alternatives"],
    "instrumental": ["instrumental","instrumental's","instrumentalmusic","instrumentals","no vocals","intrumental","instumental"],
    "experimental": ["experiment","experimental","experimental's","experimentalmusic","experiments"],
    "avant-garde": ["avant-garde","avantgarde","avant garde"],
    "musique concrete": ["musique concrete","musique concrète","electroacoustic"],
    "acousmatic": ["acousmatic","acousmatique"],
    "field recording": ["field recording","field recordings"],
    "ambient": ["ambient","ambient's","ambients"],
    "dark ambient": ["dark ambient","darkambient"],
    "acoustic": ["acoustic","acoustic's","acousticmusic","acoustics","accoustic","acustico"],
    "reggae": ["reggae","reggae music","reggae's","reggaemusic","raggae","reagge","reggea"],
    "roots reggae": ["roots reggae","reggae roots","roots and culture"],
    "dancehall": ["dancehall","dance hall","jamaican dancehall","bashment","ragga","raggamuffin"],
    "dub": ["dub","reggae dub","dub reggae"],
    "techno": ["techno","techno music","techno's","technomusic"],
    "trance": ["trance","trance music","trance's","trancemusic","trancing"],
    "funk": ["funk","funk's","funkier","funkiest","funkmusic","funky"],
    "disco": ["disco","disco music","disco's","discomusic","discos"],
    "afrobeats": ["afrobeats","afro beats","afro-beats"],
    "afropop": ["afropop","afro-pop","afro pop"],
    "afrobeat": ["afrobeat","afro-beat","afro beat"],
    "amapiano": ["amapiano","afropiano","afro piano"],
    "soukous": ["soukous","congolese rumba"],
    "coupé-décalé": ["coupé-décalé","coupe-decale","coupe decale"],
    "drone": ["drone","drone's","dronemusic","drones"],
    "dubstep": ["dubstep","dub step","dub-step","dubstep's","dubstepmusic","dupstep"],
    "epic": ["epic","epic music","epic's","epicmusic"],
    "epiccore": ["epiccore","epic core","epic-core","epicore"],
    "future bass": ["future bass","future bass's","futurebass","futurebassmusic"],
    "jungle": ["jungle","jungle's","junglemusic","jungles"],
    "new age": ["new age","new age music","new-age","new-age music","newage","newagemusic"],
    "piano": ["piano","piano music","klavier","piyano"],
    "trip hop": ["trip hop","trip hop's","trip hops","triphop","triphopmusic","trip-hop"],
    "a cappella": ["a cappella","acappella","a capella","acapella"],
    "argentine rock": ["argentine rock","rock argentino","rock nacional argentino","rock argento","argentinian rock"],
    "argentine hip hop": ["argentine hip hop","rap argentino","argentine rap"],
    "chilean rock": ["chilean rock","rock chileno"],
    "chilean hip hop": ["chilean hip hop","rap chileno","hip hop chileno"],
    "mexican rock": ["mexican rock","rock mexicano"],
    "mexican hip hop": ["mexican hip hop","mexican rap","rap mexicano","hip hop mexicano"],
    "colombian hip hop": ["colombian hip hop","rap colombiano"],
    "venezuelan hip hop": ["venezuelan hip hop","rap venezolano"],
    "peruvian rock": ["peruvian rock","rock peruano"],
    "uruguayan rock": ["uruguayan rock","rock uruguayo"],
    "latin pop": ["latin pop","pop latino","pop en espanol","poplatino"],
    "rock en espanol": ["rock en espanol","latin rock","rock en español","rock urbano","rock latino","rock en tu idioma","rock en espa","rock latinoamericano"],
    "latin hip hop": ["latin hip hop","latin rap","rap latino"],
    "doujin": ["doujin","doujin ongaku"],
    "krushclub": ["krushclub","krush club","krushclub!","krush-club"],
    "jerk rap": ["jerk rap","jerk","new jerk"],
    "new jazz": ["new jazz","newjazz"],
    "sexy drill": ["sexy drill","slizzy drill","slizzy","sexy drill rap"],
    "pluggnb": ["pluggnb","plugg n b","plugg&b","plugg and b","plug&b","plugnb"],
    "sigilkore": ["sigilkore","sigilcore"],
    "dariacore": ["dariacore","daria core","hyperflip"],
    "stutter house": ["stutter house","flutter house","tremolo house","vocal chop house"],
    "3-step": ["3-step","three-step","3 step","3step"],
    "color bass": ["color bass","colour bass","melodic riddim","future riddim","colorbass"],
    "briddim": ["briddim","brostep riddim","briddim dubstep"],
    "trap metal": ["trap metal","trapmetal","trap-metal"],
    "rap rock": ["rap rock","rapcore","rap-rock","rock rap"],
    "rage rap": ["rage rap","rage","rage beat"],
    "ai music": ["ai music","ai","ai generated","ai-generated","ai slop","artificial intelligence","artificial intelligence music","ai artist"],
    "midtempo bass": ["midtempo bass","midtempo","mid-tempo","mid tempo"],
    "future beats": ["future beats","futurebeats","future beat"],
    "breakbeat hardcore": ["breakbeat hardcore","old skool rave","oldskool rave","old skool hardcore","oldskool hardcore","rave hardcore"],
    "old school hardcore": ["old school hardcore","oldschool hardcore","old-school hardcore"],
    "old school techno": ["old school techno","oldschool techno","old-school techno","oldskool techno"],
    "old school goth": ["old school goth","old school gothic rock","oldschool goth"],
    "power noise": ["power noise","powernoise","power-noise"],
    "bal-musette": ["bal-musette","bal musette","musette"],
    "zouklove": ["zouklove","zouk love","zouk-love"],
    "dream plugg": ["dream plugg","dreamplugg","dream-plugg"],
    "dark plugg": ["dark plugg","darkplugg","dark-plugg"],
    "emoplugg": ["emoplugg","emo plugg","emo-plugg"],
    "slowed and reverb": ["slowed and reverb","slowed & reverb","slowed reverb"],
    "video game metal": ["video game metal","videogame metal"],
    "narcocorridos": ["narcocorridos","narcocorrido","narco corridos","narco corrido"],
    "progressive folk": ["progressive folk","prog folk","prog-folk"],
    "melodic punk": ["melodic punk","melodic punk rock","melodic-punk"],
    "blackened sludge": ["blackened sludge","blackened sludge metal"],
    "blackened doom metal": ["blackened doom metal","black doom metal","black-doom metal","black/doom metal","blackened doom"],
    "freeform hardcore": ["freeform hardcore","freeform"],
    "hard house": ["hard house","hardhouse"],
    "ghetto house": ["ghetto house","ghettohouse"],
    "ghettotech": ["ghettotech","ghetto tech","ghetto-tech"],
    "bmore": ["bmore","b-more"],
    "new rave": ["new rave","nu rave","nu-rave"],
    "electronic rock": ["electronic rock","electro-rock","electrorock","electro rock"],
    "synth rock": ["synth rock","synth-rock","synthrock"],
    "avant-folk": ["avant-folk","avant folk"],
    "alternative folk": ["alternative folk","alt-folk","alt folk"],
    "lo-fi pop": ["lo-fi pop","lofi pop","lo fi pop"],
    "ringtone": ["ringtone","ringtones"],
    "melodic house and techno": ["melodic house and techno","melodic house & techno"],
    "future funk": ["future funk","futurefunk","future-funk"],
    "classical crossover": ["classical crossover","pop opera"],
    "pagan folk": ["pagan folk","pagan-folk"],
    "mittelalter": ["mittelalter","mittelalter folk"],
    "mittelalter rock": ["mittelalter rock","mittelalter-rock","mittelalterpunk"],
    "soundcloud rap": ["soundcloud rap","soundcloudrap"],
    "mumble rap": ["mumble rap"],
    "dungeon synth": ["dungeon synth","dungeonsynth"],
    "horror synth": ["horror synth","horrorsynth"],
    "keller synth": ["keller synth","kellersynth"],
    "trap soul": ["trap soul","trapsoul"],
    "chill trap": ["chill trap","chilltrap"],
    "dark trap": ["dark trap","darktrap"],
    "emo trap": ["emo trap","emotrap"],
    "vapor trap": ["vapor trap","vaportrap"],
    "future garage": ["future garage","futuregarage"],
    "neo-crust": ["neo-crust","neocrust","neo crust"],
    "neo-prog": ["neo-prog","neoprog","neo prog","neo-progressive","neo-progressive rock","neo progressive rock"],
    "neo-swing": ["neo-swing","neoswing","neo swing","nu swing"],
    "neoperreo": ["neoperreo","neo perreo","neo-perreo","neoperro"],
    "folktronica": ["folktronica","folktronic","electrofolk","electro-folk","electronic folk"],
    "electro-funk": ["electro-funk","electrofunk"],
    "euro disco": ["euro disco","eurodisco","euro-disco"],
    "euro house": ["euro house","eurohouse","euro-house"],
    "euro trance": ["euro trance","eurotrance","euro-trance"],
    "pop emo": ["pop emo","emo pop","emopop","emo-pop"],
    "indie emo": ["indie emo","indiemo","indie-emo"],
    "epunk": ["epunk","e-punk","incelcore","incel punk","zoomer epunk"],
    "crank wave": ["crank wave","post-brexit new wave"],
    "american primitive": ["american primitive","american primitivism","american primitive guitar"],
    "suomi rock": ["suomi rock","suomirock"],
    "suomirap": ["suomirap","suomi hip-hop","suomi hip hop","suomihoppi"],
    "detroit hip hop": ["detroit hip hop","detroit rap"],
    "atl hip hop": ["atl hip hop","atlanta hip hop","atlanta rap","atl rap"],
    "nyc rap": ["nyc rap","new york rap","new york hip hop","new york hip-hop","ny rap"],
    "cali rap": ["cali rap","california rap","la rap"],
    "midwest hip hop": ["midwest hip hop","midwest hip-hop","midwest rap"],
    "psychedelic hip hop": ["psychedelic hip hop","psychedelic rap","acid rap"],
    "country rap": ["country rap","hick hop","hick-hop"],
    "argentine reggae": ["argentine reggae","reggae argentino"],
    "brazilian reggae": ["brazilian reggae","reggae brasileiro","reggae brasil"],
    "italian reggae": ["italian reggae","reggae italiano"],
    "colombian reggae": ["colombian reggae","reggae colombia","reggae colombiano"],
    "dancehall reggae": ["dancehall reggae","reggae dancehall","ragga-reggae"],
    "latin reggae": ["latin reggae","reggae latino"],
    "french reggae": ["french reggae","reggae francais","reggae français"],
    "uk reggae": ["uk reggae","british reggae"],
    "nz reggae": ["nz reggae","new zealand reggae"],
    "reggae pop": ["reggae pop","reggae-pop","pop reggae"],
    "colombian rock": ["colombian rock","rock colombiano"],
    "venezuelan rock": ["venezuelan rock","rock venezolano"],
    "ecuadorian alternative rock": ["ecuadorian alternative rock","rock ecuatoriano","ecuadorian rock"],
    "paraguayan rock": ["paraguayan rock","rock paraguayo"],
    "bolivian rock": ["bolivian rock","rock boliviano"],
    "rock tico": ["rock tico","rock costarricense","costa rican rock"],
    "spanish punk": ["spanish punk","spanish punk rock","punk espanol","punk español"],
    "argentine punk": ["argentine punk","punk argentino","punk rock argentino"],
    "ska mexicano": ["ska mexicano","mexican ska"],
    "salsa colombiana": ["salsa colombiana","colombian salsa"],
    "cumbia peruana": ["cumbia peruana","peruvian cumbia"],
    "italian hardcore": ["italian hardcore","italian hardcore punk"],
    "argentine indie": ["argentine indie","indie argentino"],
    "chilean indie": ["chilean indie","indie chileno"],
    "mexican indie": ["mexican indie","indie mexicano","indie mexico"],
    "colombian indie": ["colombian indie","indie colombiano"],
    "peruvian indie": ["peruvian indie","indie peruano"],
    "argentine metal": ["argentine metal","metal argentino"],
    "mexican metal": ["mexican metal","metal mexicano"],
    "metal colombiano": ["metal colombiano","colombian metal"],
    "chilean metal": ["chilean metal","metal chileno"],
    "peruvian metal": ["peruvian metal","metal peruano"],
    "spanish metal": ["spanish metal","metal espanol","metal español"],
    "hardgroove": ["hardgroove","hardgroove techno","hard groove"],
    "pagodao": ["pagodao","pagodão"],
    "jazz worship": ["jazz worship","jazzworship"],
    "tecnocumbia": ["tecnocumbia","technocumbia"],
    "electrocumbia": ["electrocumbia","eletrocumbia","electro cumbia"],
    "piep kicks": ["piep kicks","piep kick"],
    "full-on": ["full-on","full on","full-on psytrance","full on psytrance"],
    "forest psy": ["forest psy","forest psytrance"],
    "rock demenziale": ["rock demenziale","demenziale","metal demenziale"],
    "belly dance": ["belly dance","bellydance"]
  };

  const GENRE_ALIAS_MAP = new Map();
  for (const [canonical, aliases] of Object.entries(GENRE_ALIASES_RAW)) {
      GENRE_ALIAS_MAP.set(canonical, canonical);
      aliases.forEach(alias => GENRE_ALIAS_MAP.set(alias, canonical));
  }

  function normalizeGenre(genre) {
      if (!genre) return "";
      let lower = genre.toLowerCase().trim();
      
      if (GENRE_ALIAS_MAP.has(lower)) {
          return GENRE_ALIAS_MAP.get(lower);
      }

      const cleaned = lower
          .replace(/-/g, ' ')
          .replace(/&/g, 'and')
          .replace(/\s+/g, ' ');

      return GENRE_ALIAS_MAP.get(cleaned) || cleaned;
  }

  const MOOD_DESCRIPTORS_SET = new Set([
      "chill", "relaxing", "calm", "love", "fast", "slow", "soothing", "peaceful", "tranquil",
      "mellow", "soft", "smooth", "quiet", "energetic", "sad", "upbeat", "pump up", "romantic",
      "moody", "melancholy", "nostalgia", "emotional", "cozy", "gentle", "happy", "rain", "children's music",
      "motivation", "angst", "aggressive", "atmospheric", "nature", "angry", "dark", "classy",
      "funny", "spooky", "epic", "sensual", "ethereal", "beats", "ibiza", "club", "gaming", "spiritual", "soulful"
  ]);

  const GENRE_MAPPINGS = {
    "a cappella": ["a cappella","barbershop","barbershop quartet","vocal group","vocal harmony group","close harmony","college a cappella","collegiate a cappella","christian a cappella","sda a cappella","jewish a capella"],
    "acid jazz": ["acid jazz"],
    "acoustic": ["acoustic","acoustic cover","acoustic guitar","acoustic guitar cover","acoustic chill","instrumental acoustic guitar","fingerstyle","fingerstyle guitar","fingerpicking","acoustic rock","cover acustico","ukulele","ukulele cover","chill guitar","japanese guitar","greek guitar","steel guitar","sacred steel","slack-key guitar"],
    "adult standards": ["adult standards","crooner","easy listening","lounge","standards","traditional pop","torch song","deep adult standards","vintage swoon","brill building pop","space age pop","exotica","light music","british dance band","salon music","tin pan alley","man's orchestra","vintage dutch pop","vintage swedish pop","vintage spanish pop","muzica usoara","audiophile vocal"],
    "afro house": ["afro house","gqom","kuduro","kuduro antigo","south african house","3-step","afro house angolano","bolobedu house","afro tech","batida","afrikaans gqom","african house","mzansi house"],
    "afro r&b": ["afro r&b","afro soul","afrofuturism","bongo flava","alte"],
    "afro-funk": ["afro-funk","afrobeat","classic afrobeat","afrobeat fusion","afrobeat brasileiro","west african jazz","afro-jazz","african jazz","zamrock","ethio-jazz","ethiopiques","desert blues","tuareg guitar","musique touareg","tishoumaren","wassoulou","mbalax","chimurenga","jit","sungura","benga","marrabenta","makossa","bikutsi","latin afrobeat","afro psych","cuban funk","zilizopendwa","mbaqanga","maskandi","taarab","ohangla","kadongo kamu","gumbe","mapouka","afrofunk","west african funk","african funk"],
    "afrobeats": ["afrobeats","afropop","afroswing","azonto","azontobeats","coupé-décalé","ghanaian pop","ghanaian hip hop","ghanaian alternative","hiplife","asakaa","nigerian pop","nigerian hip hop","naija old school","igbo pop","igbo rap","igbo trap","hausa pop","banku","viral afropop","afro drill","gengetone","kapuka","tanzanian pop","tanzanian hip hop","ugandan pop","ugandan hip hop","kenyan pop","kenyan r&b","kenyan hip hop","kenyan drill","kenyan alternative","rwandan pop","rwandan hip hop","zambian pop","zambian hip hop","zim urban groove","zim hip hop","cameroonian pop","cameroonian hip hop","zouglou","rap ivoire","beninese pop","togolese pop","guinean pop","rap guineen","gambian pop","gambian hip hop","sierra leonean pop","liberian pop","hipco","malagasy pop","rap gasy","musica angolana","rap angolano","musica mocambicana","rap mocambicana","musica cabo-verdiana","rap criolo","south african hip hop","mande pop","ethiopian pop","amharic pop","tigrigna pop","oromo pop","eritrean pop","somali pop","south sudanese pop","sepedi pop","venda pop","xitsonga pop","sesotho pop","swazi pop","botswana pop","namibian pop","malawian pop","burundian pop","gabonese pop","burkinabe pop","kikuyu pop","kamba pop","seychelles pop","reunion pop","musica santomense","musica guineense","musica ecuatoguineana"],
    "ai music": ["ai music"],
    "alternative": ["alternative"],
    "alternative hip hop": ["alternative hip hop","alt hip hop","indie hip hop","indie pop rap","experimental hip hop","experimental rap","hipster rap","industrial hip hop","industrial rap","psychedelic hip hop","abstract beats","chill abstract hip hop","drumless","drumless hip hop","art rap","escape room","nerdcore","lgbtq+ hip hop","hip-hop experimental","rap geek","rap anime","battle rap","spiritual hip hop","outer hip hop","czech alternative rap","nephop","chip hop","flick hop","proto-rap","bboy","indie rap","abstract rap","folk rap","chap hop","chill rap","bedroom rap"],
    "alternative metal": ["alternative metal","funk metal","nu metal","rap metal","modern metal","heavy alternative","hard alternative","rap metal espanol","aggro chileno","neo metal","comic metal","dub metal","metal alternativo","avant-garde metal","experimental metal","christian nu metal"],
    "alternative rock": ["alternative rock","britpop","britpop revival","post-britpop","modern alternative rock","modern rock","permanent wave","alternative pop rock","british alternative rock","australian alternative rock","australian rock","australian pub rock","canadian rock","scottish rock","irish rock","welsh rock","kiwi rock","nz alternative rock","finnish alternative rock","swedish alternative rock","danish alternative rock","norwegian alternative rock","dutch rock","belgian rock","swiss alternative rock","french rock","rock alternatif francais","italian alternative","italian rock","polish alternative rock","polish rock","czech rock","slovak rock","hungarian rock","romanian rock","bulgarian rock","croatian rock","serbian alternative rock","slovenian rock","greek rock","ukrainian rock","israeli rock","south african rock","south african alternative","pakistani rock","indian rock","baggy","madchester","grebo","alternative dance","dance rock","dark rock","action rock","detroit rock","boston rock","pittsburgh rock","austin rock","suomi rock","icelandic rock","danish rock","norwegian rock","varmland rock","deep swedish rock","rock quebecois","portuguese rock","swiss rock","belarusian rock","estonian rock","lithuanian rock","latvian rock","faroese rock","macedonian rock","african rock","cambodian rock","rock independant francais","polish alternative","magyar alternative","mongolian alternative","georgian alternative","azeri alternative","cuban alternative","electronic rock","future rock","geek rock","wrock","trash rock","punta rock","rhythm rock","deep active rock","synth rock","occult rock","fuzz rock","heavy rock","depressive rock"],
    "amapiano": ["amapiano","sgija","deep amapiano","private school amapiano","underground amapiano","gospel amapiano","bacardi"],
    "ambient": ["ambient","space ambient","warm drone","lowercase","ambient pop","compositional ambient","ambient guitar","ambient piano","ambient synth","ambient folk","ambient house","ambient trance","ambient worship","ambient lo-fi","ambient psychill","ambient fusion","organic ambient","experimental ambient","space music","soundscape","soundscapes","fourth world","kankyo ongaku","j-ambient","nordic ambient","argentine ambient","indian ambient","light ambient","deep ambient","pop ambient","australian ambient","polish ambient","future ambient","ambeat","weightless","noise ambient","fantasy ambient","tribal ambient","progressive ambient","power ambient"],
    "americana": ["americana","alternative country","country rock","roots rock","southern gothic","stomp and holler","roots americana","southern americana","midwest americana","new england americana","western americana","austin americana","nashville americana","canadian americana","uk americana","australian americana","swedish americana","norwegian americana","dutch americana","memphis americana","new orleans americana","deep new americana","alternative americana","black americana","alternative roots rock","countrygaze","cosmic american","gothic country","dark country","death country","deathgrass","new americana","new weird america","american primitive","scottish americana","kentucky roots","north carolina roots","wyoming roots","ny roots","montana roots","ambient country","murder ballad"],
    "arabic pop": ["arabic pop","classic arab pop","dabke","egyptian pop","egyptian hip hop","egyptian alternative","egyptian trap","mahraganat","shaabi","iraqi pop","iraqi hip hop","khaleeji","sheilat","lebanese pop","lebanese indie","syrian pop","syrian hip hop","palestinian pop","palestinian hip hop","palestinian alternative","palestinian traditional","jordanian pop","yemeni pop","maghreb pop","rai","rai algerien","deep rai","arabic hip hop","arab electronic","arab alternative","arab folk","arab groove","arab trap","arabic jazz","arabic instrumental","tarab","sudanese pop","sudanese hip hop","classic sudanese pop","libyan pop","libyan hip hop","tunisian pop","tunisian alternative","classic tunisian pop","rap tunisien","moroccan pop","classic moroccan pop","chaabi marocain","chaabi algerien","rap algerien","kabyle","kabyle moderne","tamazight","amazigh","rif","gnawa","mizrahi","jalsat","assyrian pop","sorani pop","kurdish remix","mezwed","maghreb","musique mariage algerien","musique mauritanienne","israeli mediterranean","belly dance"],
    "art pop": ["art pop","baroque pop","chamber pop","experimental pop","avant-pop","chamber psych","hypnagogic pop","outsider","outsider music","hauntology","zolo","collage pop","bow pop","classify","transpop","new weird finland","song poem"],
    "art rock": ["art rock","experimental rock","rock in opposition","zeuhl","avant-rock","experimental indie rock","early avant garde"],
    "australian hip hop": ["australian hip hop","australian underground hip hop","australian indigenous hip hop","west australian hip hop","melbourne hip hop","brisbane hip hop","perth hip hop","nz hip hop","nz gangsta rap","polynesian hip hop","australian trap"],
    "axé": ["axé","samba-reggae","swingueira","frevo","carnaval","bloco","maracatu","coco"],
    "bachata": ["bachata","bachata dominicana","bachata sensual"],
    "balkan": ["balkan","balkan brass","balkan beats","balkan trap","balkan hip hop","balkan drill","balkan post-punk","balkan punk","balkan folk","balkan pop","balkan rock","chalga","manele","neo-manele","muzica etno","muzica populara","muzica lautareasca","tallava","turbo-folk","ex-yu rock","sevdah","narodna muzika","starogradska","krajiska muzika","izvorna muzika","tamburica","kolo","horo","laiko","rebetiko","entehno","nisiotika","cretan folk","pontian folk","albanian pop","albanian hip hop","albanian rock","albanian folk","albanian alternative","kosovan pop","kosovan folk","bosnian pop","bosnian indie","serbian hip hop","serbian folk","serbian pop","serbian indie","croatian pop","croatian hip hop","croatian folk","croatian indie","slovenian pop","slovenian hip hop","slovenian indie","macedonian pop","macedonian hip hop","macedonian folk","macedonian indie","montenegrin pop","bulgarian pop","bulgarian hip hop","bulgarian folk","greek hip hop","romanian hip hop","klapa","popullore jugu","cifteli","kaba gaida","muzica moldoveneasca","greek folk","greek clarinet","neo kyma","greek underground rap","greek fem rap","bouzouki","gypsy"],
    "ballad": ["ballad","power ballad","piano ballad","pop ballad","sentimental","romantic ballad","romantic ballads","rock ballad","rock ballads","balada romantica","cancion melodica","grupero romantico","gruperas inmortales","pop romantico"],
    "bass house": ["bass house","brazilian bass","g-house","wobble house","uk bass","uk bassline","fidget","basshall","uk bass house","night bass","italian bass","bassline house"],
    "bebop": ["bebop","bop","post-bop","contemporary post-bop","straight-ahead jazz"],
    "big band": ["big band","modern big band"],
    "black metal": ["black metal","atmospheric black metal","blackgaze","cascadian black metal","melodic black metal","metal noir quebecois","pagan black metal","raw black metal","symphonic black metal","viking metal","viking black metal","norwegian black metal","depressive suicidal black metal","autonomous black metal","avant-garde black metal","black 'n' roll","blackthrash","black thrash","blackened thrash metal","blackened crust","blackened hardcore","blackened screamo","chaotic black metal","cosmic black metal","cryptic black metal","dark black metal","emotional black metal","epic black metal","experimental black metal","folk black metal","forest black metal","gothic black metal","industrial black metal","instrumental black metal","medieval black metal","nsbm","occult black metal","orthodox black metal","post-black metal","progressive black metal","rabm","red and anarchist black metal","technical black metal","true black metal","usbm","american black metal","appalachian black metal","austrian black metal","baltic black metal","belarusian black metal","belgian black metal","british black metal","canadian black metal","chilean black metal","chinese black metal","colombian black metal","czsk black metal","danish black metal","dutch black metal","finnish black metal","french black metal","german black metal","greek black metal","hellenic black metal","hungarian black metal","icelandic black metal","indonesian black metal","irish black metal","italian black metal","mexican black metal","native american black metal","polish black metal","portuguese black metal","romanian black metal","russian black metal","spanish black metal","swedish black metal","swiss black metal","turkish black metal","ukrainian black metal","war metal","bestial black metal","ambient black metal","deep symphonic black metal","australian black metal","black metal argentino","celtic black metal","psychedelic black metal","war black metal","religious black metal","christian black metal","satanic black metal","anarchist black metal","transcendental black metal","space black metal","iberian black metal","lusitanian black metal","old school black metal"],
    "bluegrass": ["bluegrass","jamgrass","old-time","progressive bluegrass","neo-traditional bluegrass","instrumental bluegrass","bluegrass gospel","bluegrass fiddle","newgrass","banjo","clawhammer banjo","old-time fiddle","mandolin","string band","modern old-time","vintage old-time","jug band","washboard"],
    "blues": ["blues","classic blues","jazz blues","modern blues","traditional blues","acoustic blues","delta blues","deep delta blues","chicago blues","texas blues","memphis blues","new orleans blues","piedmont blues","hill country blues","swamp blues","jump blues","boogie-woogie","piano blues","barrelhouse piano","harmonica blues","blues harmonica","pre-war blues","classic female blues","soul blues","rebel blues","garage punk blues","australian blues","canadian blues","dutch blues","finnish blues","german blues","italian blues","japanese blues","norwegian blues","polish blues","spanish blues","swedish blues","brazilian blues","blues mexicano","blues latinoamericano","malian blues","belgian blues","blues band","modern electric blues","whiskey blues","dirty blues","doom blues","folk blues","blues harp"],
    "blues rock": ["blues rock","british blues","electric blues","modern blues rock","power blues-rock","psychedelic blues-rock","blues-rock guitar","slide guitar","heavy blues","heavy blues rock"],
    "bolero": ["bolero","bolero cubano","bolero mexicano","mexican bolero","mexican boleros","trio cubano","trova","trova mexicana","nueva trova","nueva trova chilena","nueva cancion","nueva cancion chilena","canto popular uruguayo","cancion de autor"],
    "bollywood pop": ["bollywood pop","filmi","hindi pop","modern bollywood","classic bollywood","desi pop","kollywood","classic kollywood","mollywood","sandalwood","tollywood","classic tollywood","vintage tollywood","hindi indie","indian indie","indian indie pop","indian singer-songwriter","indian edm","indian electronic","bhojpuri pop","bhojpuri folk","haryanvi pop","haryanvi hip hop","gujarati pop","gujarati garba","marathi pop","marathi traditional","marathi remix","rajasthani pop","rajasthani folk","assamese pop","assamese hip hop","odia pop","bengali folk","rabindra sangeet","classic bangla pop","bangla pop","bangla rock","bangladeshi rock","bangladeshi indie","bangladeshi hip hop","tamil pop","tamil hip hop","tamil indie","telugu folk","telugu indie","telugu remix","telugu hip hop","malayalam pop","malayalam hip hop","malayalam indie","kannada pop","kannada hip hop","kannada indie","konkani pop","pahadi pop","garhwali pop","kumaoni pop","himachali pop","dogri pop","kashmiri pop","kashmiri hip hop","sambalpuri pop","nagpuri pop","khortha pop","santali pop","chhattisgarhi pop","maithili","manipuri pop","mizo pop","khasi pop","northeast indian indie","northeast indian hip hop","pakistani pop","classic pakistani pop","pakistani indie","pakistani electronic","pakistani hip hop","urdu hip hop","saraiki pop","pashto pop","balochi pop","sindhi","nepali pop","classic nepali pop","nepali indie","nepali rock","lok dohori","sinhala pop","classic sinhala pop","sinhala indie","sinhala rap","sinhala edm","baila","indian fusion","west bengali pop","malaysian tamil pop","malaysian tamil rap","mappila paattu","indian underground rap","koligeet","mewati pop","marwadi pop","malayalam madh","malayalam cover","rasiya","purulia pop","khandeshi pop","bodo pop","kannada bhava geethe","adivasi pop","kokborok pop","goa hip hop","meenawati","banjara pop","haryanvi ragni","marathi hip hop","karbi pop","bhutanese pop","gaddiyali pop","classic konkani pop","garo pop","bangla gojol","classic assamese pop","kinnauri pop","mising pop","ho munda","rongmei pop","ladakhi pop","chakma pop","zomi pop","maldivian pop","sirmauri pop","south asian metal"],
    "boogie": ["boogie","post-disco","brazilian boogie","post-disco soul","electro-funk","boogie funk"],
    "boom bap": ["boom bap","90s boom bap","classic boom bap","jazz boom bap","underground boom bap","boom bap espanol","german boom bap","japanese boom bap"],
    "bossa nova": ["bossa nova","bossa nova cover","bossa nova jazz","samba-jazz"],
    "brazilian hip hop": ["brazilian hip hop","boom bap brasileiro","rap nacional antigo","rap feminino nacional","rap baiano","rap mineiro","rap cearense","rap df","rap maromba","rap baixada fluminense","rap capixaba","rap paranaense","rap pernambucano","rap guarulhense","rap gaucho","rap abc paulista","rap alagoano","rap sergipano","rap nortista","rap potiguar","rap paraense","trap brasileiro","trap carioca","trap baiano","trap pesado","plug brasileiro","speed plug brasileiro","detroit trap brasileiro","drill brasileiro","grime brasileiro","nerdcore brasileiro","pop rap brasileiro","afrofuturismo brasileiro","rap catarinense","trap cristao"],
    "brazilian metal": ["brazilian metal","brazilian thrash metal","brazilian groove metal","brazilian power metal","brazilian progressive metal","brazilian death metal","brazilian black metal","brazilian doom metal","brazilian heavy metal","brazilian metalcore","brazilian grindcore","brazilian deathcore","metal mineiro","metal gaucho","metal paranaense","metal catarinense","metal cearense","metal baiano","metal nortista","metal pernambucano","metal piauiense","metal cristao"],
    "brazilian rock": ["brazilian rock","pop rock brasileiro","hard rock brasileiro","rock alternativo brasileiro","rock gaucho","rock brasiliense","rock mineiro","rock baiano","rock curitibano","rock piauiense","rock campineiro","rock cearense","rock paraibano","rock goiano","rock alagoano","rock pernambucano","rock catarinense","rock potiguar","rock sergipano","rock abc paulista","rock sul-mato-grossense","rock paraense","rock nacional feminino","novo rock gaucho","post-punk brasileiro","brazilian punk","brazilian punk rock","brazilian hardcore","brazilian emo","brazilian post-hardcore","shoegaze brasileiro","grunge brasileiro","psicodelia brasileira","neo-psicodelia brasileira","gotico brasileiro","brazilian lo-fi rock","brazilian stoner rock","brazilian post-rock","brazilian surf rock","brazilian rockabilly","brazilian indie","brazilian indie rock","indie brasileiro","indie nacional","manguebeat","mangue beat","musica gaucha","musica gaucha tradicionalista","musica juiz-forana","musica feirense","musica campista","musica blumenauense","musica campineira","musica rondoniense","musica londrinense","musica caririense","musica roraimense","musica ponta-grossense","musica mogiana","musica maringaense","indie paraense"],
    "breakbeat": ["breakbeat","big beat","breaks","funky breaks","nu skool breaks","nuskool breaks","nu-breaks","acid breaks","progressive breaks","psybreaks","hardcore breaks","florida breaks","electro breaks","booty breaks","rave","old school rave","broken beat","nu electro","classic breakbeat"],
    "breakcore": ["breakcore","lolicore","mashcore","chill breakcore","deep breakcore","raggacore","vocaloid breakcore","maidcore","splittercore","speedcore","extratone","flashcore","digital hardcore","depressive breakcore","atmospheric breakcore","intelligent breakcore"],
    "c-pop": ["c-pop","cantopop","hk-pop","classic cantopop","mandopop","classic mandopop","taiwan pop","taiwan singer-songwriter","taiwan indie","taiwanese indie","taiwan idol pop","taiwan campus folk","vintage taiwan pop","taiwanese pop","hong kong indie","singaporean mandopop","singaporean pop","singaporean singer-songwriter","malaysian mandopop","chinese viral pop","chinese singer-songwriter","chinese idol pop","chinese drama ost","chinese electropop","chinese r&b","chinese indie","chinese indie pop","chinese indie rock","chinese post-punk","chinese minyao","chinese manyao","zhongguo feng","gufeng","chinese hip hop","chinese melodic rap","taiwan hip hop","hong kong hip hop","sichuanese hip hop","chinese rock","taiwan rock","taiwan punk","hong kong rock","chinese metal","taiwan metal","xinyao","vintage chinese pop","vintage cantonese pop","c-pop girl group","chinese audiophile","taiwan instrumental","taiwan graduation song","macau pop","tibetan pop","tibetan hip hop","uyghur pop","hmong pop","southern china indie","northwest china indie","shanghai indie","wuhan indie"],
    "canadian hip hop": ["canadian hip hop","toronto rap","canadian trap","canadian underground hip hop","canadian old school hip hop","bc underground hip hop","ottawa rap","winnipeg hip hop","alberta hip hop","atlantic canada hip hop","canadian indigenous hip hop"],
    "celtic": ["celtic","celtic punk","celtic rock","irish folk","scottish folk","canadian celtic","japanese celtic","celtic harp","scottish gaelic folk","irish gaelic folk","scottish fiddle","irish fiddle","irish flute","irish banjo","irish accordion","uilleann pipes","bagpipe","bagpipes","scottish smallpipe","pibroch","pipe and drum","bagpipe marching band","ceilidh","bothy ballad","irish pub song","irish rebel song","irish ballad","irish neo-traditional","cornish folk","welsh folk","manx","breton folk","galician folk","musica folk asturiana","trikiti","balfolk","jig and reel","sean-nos singing","puirt-a-beul","traditional irish singing","northumbrian folk","cymraeg","metis fiddle"],
    "children's music": ["children's music","disney","kids","kindermusik","nursery rhymes","nursery","preschool children's music","british children's music","canadian children's music","australian children's music","nz children's music","children's folk","muziek voor kinderen","vlaamse kinderliedje","kinderliedjies","kinderlieder","kleine hoerspiel","chinderlieder","kinderchor","musique pour enfants","musique pour enfant quebecois","comptine","comptine africaine","histoire pour enfants","dessin anime","musica infantil","musica infantil catala","cancion infantil mexicana","cancion infantil latinoamericana","musica para ninos","musica para criancas","cancoes infantis","musica per bambini","cartoni animati","barnmusik","barnemusikk","bornesange","musiikkia lapsille","lastelaulud","barnalog","cocuk sarkilari","detskie pesni","dytyachi pisni","bajki","zespol dzieciecy","detske pisnicky","detske pesnicky","gyerekdalok","muzica copii","detski pesnichki","decije pesme","djecje pjesme","otroske pesmice","paidika tragoudia","muzika l'yeladim","aghani lil-atfal","nhac thieu nhi","musik anak-anak","er ge","kodomo no ongaku","dong-yo","bachchon ke geet","marathi balgeet","kids dance party","kids hip hop","cartoon","kindie rock","cristiana para ninos","eventyr","haur kantak","barnasogur","vaikiskos dainos","waiata mo tamariki","bernu dziesmas"],
    "chillwave": ["chillwave","vapor soul","chillsynth"],
    "chiptune": ["chiptune","bitpop","16-bit","c64","demoscene","fakebit","nintendo","gameboy"],
    "choral": ["choral","chamber choir","british choir","canadian choir","american choir","australian choir","swedish choir","norwegian choir","danish choir","finnish choir","icelandic choir","german choir","austrian choir","italian choir","polish choir","russian choir","ukrainian choir","baltic choir","hungarian choir","welsh choir","oxford choir","cambridge choir","cathedral choir","university choir","school choir","jugendchor","children's choir","women's choir","men's choir","gay chorus","contemporary choir","chamber ensemble","vocal ensemble","polyphony","polyphonies corses","georgian polyphony","albanian iso polyphony","orthodox chant","syro-aramaic chant","byzantine","south african choral","japanese choir","sda choir","duhovne pjesme","muzica bisericeasca","oratory","convent"],
    "christian hip hop": ["christian hip hop","christian trap","uk christian rap","christian lo-fi","gospel drill","christian afrobeat","rap chretien"],
    "christian metal": ["christian metal","christian death metal","christian metalcore","unblack metal","christian hard rock","christian post-hardcore","christian power metal","christian symphonic metal","christian thrash metal","christian doom metal","christian deathcore","christcore"],
    "christian pop": ["christian pop","christian","deep ccm","canadian ccm","german ccm","russian ccm","ukrainian ccm","brazilian ccm","alternative ccm","christian uplift","christian dance","lds","lds youth","classic praise","praise","piano worship","cedm","musica cristiana guatemalteca","musica bautista","afrikaans gospel","norwegian gospel","gospel papiamento","vintage gospel","dicsoites"],
    "christian rock": ["christian rock","christian alternative rock","christian indie","deep christian rock","christian punk","christian hardcore","jesus movement","rock gospel brasileiro","rock cristao fluminense"],
    "christmas": ["christmas","christmas pop","carols","christmas instrumental","christmas product","villancicos","koledy","noel quebecois"],
    "city pop": ["city pop","classic city pop","japanese funk","japanese soul","shibuya-kei","korean city pop","indonesian city pop","pinoy city pop"],
    "classic rock": ["classic rock","album rock","aor","melodic rock","soft rock","mellow gold","southern rock","modern southern rock","british invasion","merseybeat","bossbeat","classic canadian rock","swamp rock","heartland rock","jam band","yacht rock","beatlesque","bosstown sound","classic greek rock","classic finnish rock","classic hungarian rock","classic danish rock","deep soft rock","trop rock","flute rock","rock drums","rock keyboard"],
    "classical": ["classical","orchestra","orchestral","baroque","minimalism","symphonic","symphonies","symphony","early modern classical","classical era","galante era","early romantic era","late romantic era","post-romantic era","impressionism","serialism","totalism","neoclassicism","neo-classical","neoclassical","post-classical","cinematic classical","contemporary classical","american contemporary classical","american modern classical","american romanticism","british contemporary classical","british modern classical","canadian contemporary classical","australian classical","new zealand classical","french contemporary classical","french romanticism","french baroque","german contemporary classical","german romanticism","german baroque","austrian contemporary classical","austro-german modernism","swiss contemporary classical","italian contemporary classical","italian romanticism","italian baroque","spanish contemporary classical","spanish baroque","portuguese contemporary classical","portuguese classical","dutch contemporary classical","dutch baroque","belgian contemporary classical","nordic contemporary classical","swedish contemporary classical","swedish classical","norwegian classical","danish contemporary classical","danish classical","finnish contemporary classical","finnish classical","icelandic classical","baltic classical","polish contemporary classical","polish classical","czech contemporary classical","czech classical","hungarian contemporary classical","romanian contemporary classical","greek contemporary classical","russian contemporary classical","russian modern classical","russian romanticism","ukrainian contemporary classical","ukrainian classical","caucasian classical","israeli classical","japanese contemporary classical","japanese classical","korean contemporary classical","chinese classical","latin classical","brazilian contemporary classical","brazilian classical","mexican classical","african-american classical","orchestral performance","historic orchestral performance","british orchestra","american orchestra","german orchestra","french orchestra","italian orchestra","russian orchestra","nordic orchestra","japanese orchestra","chamber orchestra","string orchestra","symfonicky orchestr","orkiestra symfoniczna","pops orchestra","radio symphony","wind symphony","concert band","japanese concert band","brass ensemble","brass quintet","wind quintet","wind ensemble","clarinet ensemble","string quartet","modern string quartet","historic string quartet","quartetto d'archi","quatuor a cordes","streichquartett","classical string trio","string quintet","string duo","modern chamber music","chamber music","baroque ensemble","italian baroque ensemble","historically informed performance","classical performance","historic classical performance","chinese classical performance","taiwan classical performance","korean classical performance","japanese classical performance","hungarian classical performance","violin","baroque violin","italian violin","viola","viola da gamba","cello","classical cello","baroque cello","modern cello","cello ensemble","contrabass","classical bass","classical flute","classical oboe","classical clarinet","classical bassoon","classical horn","classical trumpet","classical trombone","classical tuba","euphonium","classical saxophone","classical saxophone quartet","baroque brass","baroque woodwind","classical harp","classical guitar","classical guitar duo","classical guitar quartet","italian classical guitar","guitarra clasica","violao classico","classical mandolin","italian mandolin","lute","harpsichord","historical keyboard","classical organ","pipe organ","classical accordion","classical percussion","canadian classical","spanish classical","irish classical","irish contemporary classical","american 21st century classical","oriental classical","andalusian classical","synthetic classical","english baroque","bohemian baroque","latin american baroque","barockinterpreten","austrian orchestra","fictitious orchestra","youth orchestra","musica sinfonica","art song","pastoral","ballet class","school ensemble","trombone ensemble","british brass band","brass band","marching band","college marching band","street band","military band","musique militaire","banda militar","musikkorps","staff band","police band","cornetas y tambores","fife and drum","fanfare","harp","sacred harp","handbells","bells","mallet","recorder","theremin","chapman stick","glass","modern performance"],
    "club": ["club","baltimore club","jersey club","philly club","deconstructed club","dark clubbing","ballroom","vogue","raptor house","guaracha","tribal guarachero","trival","ghettotech","bmore","atlanta bass","bounce","techengue","latincore","italo beats","new orleans bounce","tropical bass"],
    "comedy": ["comedy","comedy rock","parody","stand-up comedy","comedy rap","comedy metal","comedy punk","clean comedy","new comedy","deep comedy","black comedy","british comedy","canadian comedy","australian comedy","latino comedy","dansk comedy","humour francais","chanson humoristique","chanson paillarde","kabarett","dutch cabaret","vlaamse cabaret","magyar kabare","komedi","comedia","piada","music hall","vaudeville","novelty","meme","meme rap","soundclown","mashup","comedienne","comic","rakugo","geinin song","rock demenziale"],
    "conscious hip hop": ["conscious hip hop","political hip hop","rap conscient","underground hip hop","underground rap","rap conciencia","rap politico"],
    "contemporary jazz": ["contemporary jazz","jazz pop","jazz piano","modern jazz piano","jazz trio","modern jazz trio","jazz quartet","jazz saxophone","jazz trumpet","jazz trombone","jazz clarinet","jazz flute","jazz violin","jazz guitar","jazz guitar trio","jazz double bass","jazz organ","hammond organ","jazz vibraphone","jazz harp","jazz accordion","jazz drums","jazz brass","dinner jazz","jazz cover","british jazz","uk contemporary jazz","scottish jazz","irish modern jazz","french jazz","german jazz","austrian jazz","swiss jazz","italian jazz","italian contemporary jazz","spanish jazz","portuguese jazz","dutch jazz","belgian jazz","belgian modern jazz","norwegian jazz","norwegian contemporary jazz","swedish jazz","danish jazz","danish modern jazz","finnish jazz","finnish modern jazz","icelandic jazz","polish jazz","polish modern jazz","czech jazz","russian jazz","russian modern jazz","greek jazz","turkish jazz","turkish modern jazz","israeli jazz","indian jazz","japanese jazz","classic japanese jazz","korean jazz","chinese jazz","australian jazz","nz jazz","canadian modern jazz","south african jazz","south african modern jazz","brazilian jazz","brazilian modern jazz","argentine jazz","jazz mexicano","jazz chileno","jazz colombiano","jazz worship","vintage jazz","vintage finnish jazz","harmonica jazz","neo soul-jazz","jazzcore","jazz tuba","jazz composition","saxophone trio","swedish jazz orkester","jazz catala","trad jazz catala","galician jazz","lithuanian jazz","estonian jazz","faroese jazz","modern jazz","classic jazz","piano jazz","chamber jazz","ambient jazz","world jazz"],
    "contemporary r&b": ["contemporary r&b","canadian contemporary r&b","uk r&b","french r&b","indie r&b","bedroom r&b","chill r&b","dark r&b","pop r&b","neo r&b","experimental r&b","deep r&b","deep smooth r&b","australian r&b","dutch r&b","german r&b","scandinavian r&b","south african r&b","r&b en espanol","r&b argentino","quiet storm","bulgarian r&b","russian r&b","spanish r&b","romanian r&b","vietnamese r&b","hindi r&b","soul flow","future soul","cloud r&b"],
    "corridos tumbados": ["corridos tumbados","corridos alternativos","sierreno","classic sierreno","sad sierreno","corridos belicos","corridos adictivos","corridos progresivos","corridos clasicos","corridos cristianos"],
    "country": ["country","contemporary country","country & western music","country blues","country pop","modern country pop","classic country pop","modern country rock","country road","country dawn","country rap","country gospel","country boogie","truck-driving country","honky tonk","honky-tonk piano","neo honky tonk","outlaw country","traditional country","classic country","neo-traditional country","bakersfield sound","nashville sound","countrypolitan","western swing","western","cowboy","cowpunk","red dirt","texas country","oklahoma country","classic texas country","classic oklahoma country","arkansas country","alberta country","canadian country","canadian contemporary country","country quebecois","manitoba country","australian country","classic australian country","bush ballad","british country","irish country","swedish country","norwegian country","german country","swiss country","czech country","south african country","classic nz country","queer country","deep contemporary country","rez country","redneck","old west","vintage western","new country","country soul","christian country"],
    "cumbia": ["cumbia","cumbia 420","cumbia andina mexicana","cumbia andina","cumbia boliviana","cumbia chilena","cumbia del sureste","cumbia lagunera","cumbia peruana","cumbia pop","cumbia ranchera","cumbia salvadorena","cumbia santafesina","cumbia sonidera","cumbia uruguaya","cumbia villera","cumbia argentina","cumbia texana","cumbia romantica","cumbia punk","psychedelic cumbia","dark cumbia","digital cumbia","nu-cumbia","tecnocumbia","cumbia colombiana regia","cumbia ecuatoriana","cumbia paraguaya","cumbia surena","cumbia amazonica","cumbia sonorense","cumbia editada","cumbia cristiana","cumbia rebajada","electrocumbia","cumbiaton","chicha","porro","bullerengue","champeta","tropipop","cuarteto"],
    "dance": ["dance","pop dance","uk dance","australian dance","german dance","belgian dance","irish dance","south african pop dance","gregorian dance","magyar retro dance","haitian dance","electro bailando","klubowe","cantaditas","dakke dak"],
    "dancehall": ["dancehall","dancehall queen","uk dancehall","old school dancehall","swedish dancehall","dancehall chileno","dancehall colombiano","dancehall guyanaise","dancehall mauricien","zimdancehall","trinibad","shatta","deep ragga","traphall"],
    "dangdut": ["dangdut","dangdut koplo","koplo","javanese dangdut","dangdut remix","campursari","lagu tarling"],
    "dark ambient": ["dark ambient","ritual ambient","isolationism","new isolationism","drone ambient","ambient industrial","cryo chamber"],
    "dark cabaret": ["dark cabaret","cabaret","circus","circus rock","steampunk","punk cabaret"],
    "dark wave": ["dark wave","coldwave","gothic","gothic americana","neoclassical darkwave","modern darkwave","minimal wave","grave wave","ethereal gothic","neue deutsche todeskunst","sovietwave","solo wave","zimna fala","polish cold wave","italian darkwave","turkish darkwave"],
    "death metal": ["death metal","brutal death metal","cavernous death metal","death 'n' roll","deathgrind","florida death metal","gothenburg metal","melodic death metal","swedish melodeath","technical death metal","slam death metal","swedish death metal","old school death metal","death-doom","blackened death metal","american melodeath","finnish melodeath","german melodeath","technical melodic death metal","symphonic melodic death metal","symphonic death metal","progressive death metal","progressive technical death metal","dissonant death metal","cosmic death metal","grisly death metal","grim death metal","instrumental death metal","technical brutal death metal","charred death","black death","deathrash","new wave of osdm","osdm","british death metal","canadian death metal","quebec death metal","danish death metal","dutch death metal","finnish death metal","french death metal","german death metal","indonesian death metal","irish death metal","italian death metal","mexican death metal","norwegian death metal","peruvian death metal","polish death metal","portuguese death metal","russian death metal","spanish death metal","texas death metal","turkish death metal","colombian death metal","new york death metal","deep melodic death metal","australian death metal","belgian death metal","atmospheric death metal","guttural brutal death metal","slamming guttural brutal death metal","blasting brutal death metal","brutal technical death metal","brutal slamming death metal","progressive melodic death metal","melodic death-thrash metal","industrial death metal","modern melodic death metal","new wave of old school death metal","melodic black death metal"],
    "deathcore": ["deathcore","blackened deathcore","slam deathcore","slamming deathcore","technical deathcore","downtempo deathcore","beatdown","uk beatdown","symphonic deathcore","progressive deathcore","melodic deathcore","brutal deathcore","myspace deathcore","nu deathcore","indonesian deathcore","russian deathcore","ukrainian deathcore","beatdown deathcore","slamming beatdown","japanese deathcore","experimental deathcore","atmospheric deathcore"],
    "deep house": ["deep house","deep euro house","deep groove house","turkish deep house","deep disco house","south african deep house","deep deep house","deep soul house","south african soulful deep house","deep vocal house","lo-fi house","outsider house","float house","soulful house","chill house","melodic house","organic house","organic electronic","jazz house","saxophone house","lounge house","beach house","minimal deep house","deep funk house","vapor house","tulum"],
    "dembow": ["dembow","dembow dominicano","trap dominicano","drill dominicano"],
    "disco": ["disco","nu disco","italo disco","new italo disco","deep italo disco","euro disco","space disco","norwegian space disco","cosmic disco","mutant disco","dark disco","deep disco","disco funk","japanese disco"],
    "dixieland": ["dixieland","new orleans jazz","stride","ragtime"],
    "djent": ["djent","thall","progressive djent","math metal","instrumental djent","electronic djent"],
    "doo-wop": ["doo-wop","street corner harmony"],
    "doom metal": ["doom metal","drone metal","epic doom","funeral doom","psychedelic doom","traditional doom metal","atmospheric doom","atmospheric doom metal","finnish doom metal","italian doom metal","norwegian doom metal","swedish doom metal","uk doom metal","progressive doom","progressive doom metal","melodic doom","melodic doom metal","neo-trad doom metal","gothic doom","gothic doom metal","gaian doom","blackened doom metal","sludge doom","funeral doom ambient","melodic death doom metal"],
    "downtempo": ["downtempo","chillout","chill out","chill lounge","sunset lounge","deep sunset lounge","balearic","balearic beat","illbient","psydub","ambient dub","ambient dub techno","downtempo bass","downtempo fusion","deep downtempo fusion","organic downtempo","greek downtempo","coverchill","deep chill","deep chill-out","world chill","chill groove","modern downshift"],
    "dream pop": ["dream pop","ethereal","ethereal wave","modern dream pop","indie dream pop","chill dream pop","korean dream pop","japanese dream pop","dreamgaze","gauze pop","popgaze"],
    "drift phonk": ["drift phonk","wave phonk","raw phonk","russian phonk","house phonk","phonk house"],
    "drill": ["drill","aussie drill","australian drill","chicago drill","chicago bop","classical drill","drill chileno","drill espanol","spanish drill","drill tuga","florida drill","jacksonville drill","german drill","melodic drill","ny drill","new york drill","philly drill","st louis drill","rva drill","dmv drill","canadian drill","irish drill","scottish drill","dutch drill","swedish drill","finnish drill","polish drill","czech drill","russian drill","greek drill","turkce drill","persian drill","korean drill","japanese drill","chill drill","anime drill","drill beats"],
    "drone": ["drone","dronescape","drone folk","drone psych","drone rock"],
    "drum and bass": ["drum and bass","liquid funk","neurofunk","jump up","belgian jump up","ragga jungle","darkstep","sambass","drumfunk","atmospheric dnb","dancefloor dnb","halftime","halftime dnb","techstep","uk dnb","stateside dnb","belgian dnb","dutch dnb","french dnb","german dnb","austrian dnb","russian dnb","nz dnb","south african dnb","brazilian dnb","deep dnb","deep liquid","deep liquid bass","minimal dnb","jazzy dnb","neurostep","substep","clownstep","artcore","crossbreed","melodic dnb","ambient dnb","vocal drum and bass","dark drum and bass","lo-fi dnb","soulful dnb","jungle dnb","autonomic","microfunk","hardstep","jazzstep","electrostep","dubwise"],
    "dub": ["dub","dub poetry","uk dub","french dub","japanese dub","dub brasileiro","experimental dub","digital dub","steppa","roots dub","electro dub","minimal dub","dubsteppe","dub product"],
    "dubstep": ["dubstep","brostep","chillstep","drumstep","riddim","riddim dubstep","melodic dubstep","deathstep","tearout","post-dubstep","classic dubstep","deep dubstep","gaming dubstep","cinematic dubstep","experimental dubstep","minimal dubstep","filthstep","deep filthstep","purple sound","140 dubstep","heavy dubstep","dark dubstep","liquid dubstep","orchestral dubstep","color bass","briddim","experimental bass","ghoststep","dubstep product","melodic bass","lovestep","gorestep","metalstep","trapstep","neurohop","glitchstep","ambient dubstep","freeform bass","kawaii bass","bass trip","vomitstep","future dubstep"],
    "dungeon synth": ["dungeon synth","fantasy synth","keller synth","winter synth","comfy synth","forest synth","medieval ambient","tanzelcore"],
    "dutch hip hop": ["dutch hip hop","dutch rap pop","dutch trap","dutch underground hip hop","old school nederhop","antilliaanse rap","vlaamse rap","west-vlaamse hip hop","surinamese hip hop"],
    "east coast hip hop": ["east coast hip hop","hardcore hip hop","nyc rap","queens hip hop","brooklyn hip hop","bronx hip hop","harlem hip hop","upstate ny rap","buffalo hip hop","new jersey rap","new jersey underground rap","philly rap","pittsburgh rap","boston hip hop","rhode island rap","baltimore hip hop","dmv rap","virginia hip hop","deep east coast hip hop","wu fam","brockton hip hop","maine hip hop"],
    "edm": ["edm","dutch edm","belgian edm","brazilian edm","finnish edm","mexican edm","hungarian edm","lithuanian edm","ukrainian edm","japanese edm","deep big room"],
    "electro house": ["electro house","progressive electro house","dutch house","fidget house","bouncy house","speed house","complextro","big room","melbourne bounce","future bounce","future house","future rave","slap house","dirty dutch","bloghouse","gaming edm","midtempo bass","dirty electro","electro trash","tecktonik","jungle terror"],
    "electro swing": ["electro swing","swing house","swing revival","neo-swing"],
    "electronic": ["electronic","electro","electronica","detroit electro","canadian electronic","danish electronic","scottish electronic","lithuanian electronic","ukrainian electronic","icelandic electronic","belarusian electronic","slovenian electronic","romanian electronic","korean electronic","japanese electronic","spanish electronic","singaporean electronic","belgian electronic","south african electronic","taiwan electronic","estonian electronic","slovak electronic","czech electronic","bulgarian electronic","chinese electronic","georgian electronic","latvian electronic","bosnian electronic","macedonian electronic","finnish electronic","colombian electronic","cuban electronic","croatian electronic","mexican electronic","indonesian electronic","luxembourgian electronic","african electronic","nz electronic","irish electronic","swedish electronic","serbian electronic","boston electronic","uk experimental electronic","vintage french electronic","hamburg electronic","leipzig electronic","frankfurt electronic","munich electronic","dusseldorf electronic","cologne electronic","tijuana electronic","electronica argentina","electronica chilena","electronica venezuela","electronica peruana","musica eletronica brasileira","eletronica underground brasileira","polish electronica","italian electronica","german electronica","finnish electro","danish electro","berlin school","synthesizer","modular synth","moog","abstractro","ethnotronica","progressive electronic","minimal electronic","minimal electro","retro electro"],
    "electropop": ["electropop","canadian electropop","australian electropop","swedish electropop","danish electropop","spanish electropop","czsk electropop","indie electropop","electropowerpop","etherpop","shiver pop","vapor pop","dark pop","alt z","covertronica","pop electronico","electrofox","electra","hopebeat"],
    "emo": ["emo","emo rap","emocore","midwest emo","pop emo","emo rock","emo pop punk","real emo","acoustic emo","bedroom emo","twinkle emo","alternative emo","5th wave emo","fifth wave emo","diy emo","new england emo","north carolina emo","indie emo","indie emo rock","lo-fi emo","dreamo","japanese emo","russian emo","swedish emo","italian emo","french emo","emo mexicano","emo punk","mall emo","emo revival","twinkle daddies","orgcore","deep orgcore","deep pop emo","pixie","aussie emo","epunk","desi emo rap","czsk emo rap","post-emo","ukrainian emo","twinkly emo"],
    "enka": ["enka","japanese traditional","modern enka","ryukoka","min'yo","okinawan folk","okinawan pop","ryukyu ongaku","tsugaru shamisen","shamisen","koto","shakuhachi","gagaku","taiko","ainu folk"],
    "epic": ["epic","epic trailer music","trailer music"],
    "epiccore": ["epiccore"],
    "eurobeat": ["eurobeat","para para","super eurobeat","techno kayo"],
    "eurodance": ["eurodance","bubblegum dance","hands up","hi-nrg","euro hi-nrg","italo dance","swedish eurodance","deep eurodance","euro house","dancemania","disco polo","classic disco polo"],
    "eurovision": ["eurovision","eurovision song contest","melodifestivalen"],
    "experimental": ["experimental","avant-garde","acousmatic","experimental electronic","experimental vocal","experimental guitar","experimental synth","experimental percussion","experimental classical","experimental big band","experimental club","experimental house","experimental techno","experimental folk","experimental indie","experimental psych","experimental poetry","british experimental","canadian experimental","australian experimental","french experimental","french experimental rock","german experimental","italian experimental","spanish experimental","portuguese experimental","dutch experimental","dutch experimental electronic","belgian experimental","swiss experimental","danish experimental","norwegian experimental","swedish experimental","finnish experimental","icelandic experimental","polish experimental","polish experimental electronic","czech experimental","bulgarian experimental","russian experimental electronic","ukrainian experimental","japanese experimental","korean experimental","chinese experimental","taiwan experimental","indonesian experimental","brazilian experimental","mexican experimental","peruvian experimental","arab experimental","iranian experimental","turkish experimental","african experimental","tennessee experimental","new england experimental","irish experimental","irish experimental electronic","plunderphonics","sound collage","sound art","musique concrete","electroacoustic composition","electroacoustic improvisation","modern electroacoustic","british electroacoustic","free improvisation","microtonal","xenharmonic","tape music","prepared piano","wandelweiser","field recording"],
    "fado": ["fado","portuguese folk","fado de coimbra","fado de lisboa","fado antigo","novo fado","fado instrumental","guitarra portuguesa","musica portuguesa contemporanea","musica de intervencao","cante alentejano","musica acoriana","musica madeirense","folclore portugues","morna","coladeira"],
    "flamenco": ["flamenco","cante flamenco","flamenco guitar","flamenco pop","nuevo flamenco","rumba","rumba catalana","rumba flamenca","flamenco urbano","pop flamenco","rock andaluz","sevillanas","copla","pasodobles"],
    "folk": ["folk","contemporary folk","traditional folk","traditional british folk","traditional english folk","traditional scottish folk","yorkshire folk","orkney and shetland folk","traditional southern folk","early american folk","michigan folk","appalachian folk","kentucky mountain folk","canadian folk","cape breton folk","nz folk","nordic folk","swedish folk","swedish folk pop","swedish fiddle","nyckelharpa","norwegian folk","norwegian folk rock","hardingfele","trekkspill","norske viser","visor","danish folk","finnish folk","kantele","icelandic folk","icelandic traditional","faroese folk","dutch folk","flemish folk","swiss folk","appenzeller folk","italian folk","folk siciliana","tarantella","pizzica","canto a tenore","canti alpini","liscio","spanish folk","jota aragonesa","catalan folk","nova canco","basque folk","chant basque","folclore castilla y leon","folclore navarra","folclore extremeno","folk cantabria","russian folk","balalaika","ukrainian folk","ukrainian folk pop","bandura","rusyn folk","polish folk","goralski","czech folk","slovak folk","hungarian folk","romanian folk","muzica ardeleneasca","muzica banateana","muzica maramureseana","baltic folk","lithuanian folk","latvian folk","estonian folk","karelian folk","armenian folk","georgian folk","caucasian folk","circassian folk","kurdish folk","israeli folk","persian folk","central asian folk","kazakh traditional","dombra","kyrgyz traditional","uzbek traditional","mongolian folk","throat singing","tuvan folk","khoomei","morin khuur","siberian folk","tatar folk","tibetan traditional","tibetan folk pop","himalayan folk","indian folk","pakistani folk","balochi folk","japanese folk","korean folk","korean minyo","pansori","gayageum","chinese traditional","chinese folk","guzheng","erhu","pipa","dizi","guqin","huqin","thai folk","thai folk pop","thai traditional","folklore argentino","nuevo folklore argentino","folklore nuevo argentino","folclore salteno","folclore santiagueno","folclore tucumano","folclore jujeno","folklore cuyano","folklore surero","zamba","chacarera","chamame","chamame brasilero","guitarra argentina","folklore chileno","cueca chilena","musica mapuche","folklore uruguayo","murga","folklore paraguayo","polca paraguaya","arpa paraguaya","folklore boliviano","tinku","salay","folklore peruano","huayno","huayno peruano","huayno popular","tunantada","musica criolla","musica afroperuana","marinera","guitarra andina","folklore ecuatoriano","musica otavalena","folclor colombiano","folclor afrocolombiano","musica andina","musica andina chilena","musica andina colombiana","andean flute","charango","folklore venezolano","musica llanera","joropo","cuatro venezolano","gaita zuliana","gaita","folklore panameno","nuevo folklore mexicano","mexican traditional","mexican son","son jarocho","son huasteco","trio huasteco","protest folk","anti-folk","antifolk","freak folk","free folk","wyrd folk","acid folk","folk brasileiro","folklore quebecois","trad quebecois","musique acadienne","corsican folk","mountain dulcimer","hammered dulcimer","autoharp","concertina","hurdy-gurdy","jaw harp","boston folk","geek folk","nl folk","french folk","string folk","vintage country folk","cape verdean folk","algerian folk","malagasy folk","western saharan folk","bahamian folk","garifuna folk","malawian folk","moravian folk","uyghur folk","afrikaans folk","puerto rican folk","native american traditional","native american contemporary","native american spiritual","powwow","navajo","australian indigenous music","canadian indigenous music","taiwanese indigenous music","indonesian indigenous traditional","waiata maori","kapa haka","inuit traditional","inuit pop","sami","yoik","polynesian traditional","tahitian traditional","musique tahitienne","himene tarava","hula","vintage hawaiian","cook islands pop","chamorro pop","vanuatu music","papuan traditional","musica rapa nui","musica indigena latinoamericana","musica indigena brasileira","musica prehispanica","musica tradicional cubana","musica aragonesa","musica catalana","musica canaria","musica nicaraguense","musica sarda","musica ayacuchana","musique guadeloupe","gwoka","musica popular uruguaya","musica hondurena","musica jibara","cuatro puertorriqueno","musica lombarda","musica pitiusa","musica costarricense","musica occitana","musica calabrese","musica mallorquina","folklore veracruzano","musica pernambucana","musica valenciana","musica sammarinese","musica colombiana instrumental","musica menorquina","musica andorra","musica nublensina","musica piemonteisa","musica puntana","musica amapaense","musica timor-leste","euskal musica","carnaval cadiz","mestissatge","tuna","tuna universitaria","rondalla","orquestas de galicia","galego","folkmusik","skansk musik","gotlandsk musik","alandsk musik","finlandssvenska musik","rogaland musikk","trondersk musikk","nordnorsk musikk","hjemmesnekk","sunnlensk tonlist","streektaal","friese muziek","grunneger muziek","slaskie piosenki","moderne ludovky","cimbalova muzika","musiikkia lapista","zohioliin duu","lai hla","pinoy traditional","malaysian traditional","borneo traditional","cantonese traditional","yunnan traditional","tanci","chinese wind","indonesian bamboo","burmese traditional","cambodian traditional","khmer","lao traditional","azeri traditional","israeli traditional","middle eastern traditional","egyptian traditional","moroccan traditional","moorish traditional","nubian traditional","haitian traditional","twoubadou","musique comorienne","musique traditionnelle comorienne","musique mahoraise","senegalese traditional","malian traditional","musique mandingue","musique peule","musique soninke","griot","musique nigerienne","musique tchadienne","musique centrafricaine","igbo traditional","baoule","frafra","burkinabe traditional","ethiopian traditional","kenyan traditional","tanzanian traditional","ugandan traditional","rwandan traditional","burundian traditional","batswana traditional","lesotho traditional","swazi traditional","yemeni traditional","pygmy music","kora","ngoni","balafon","djembe","mbira","oud","ney","qanun","darbuka","didgeridoo","panpipe","marimba","marimba orquesta","marimba de guatemala","cimbalom","zither","alphorn","gong","akordeon","harmonikka","fisarmonica","organetto","zampogna","schwyzerorgeli","dragspel","bal-musette","skiffle","contra dance","musica etnica","ethnomusicology","christian folk"],
    "folk metal": ["folk metal","celtic metal","medieval metal","pagan metal","nordic folk metal","german pagan metal","polish folk metal","russian folk metal","slavic folk metal","spanish folk metal","italian folk metal","folk metal latinoamericano","deep folk metal","pirate metal","tolkien metal","balkan folk metal","celtic folk metal","viking folk metal","slavic pagan metal","symphonic folk metal","chinese folk metal"],
    "folk rock": ["folk rock","modern folk rock","british folk","folk rock italiano","spanish folk rock","czech folk rock","russian folk rock","ukrainian folk rock","thai folk rock","psychedelic folk rock","progressive folk","synth folk"],
    "forro": ["forro","baiao","forro de favela","forro tradicional","forro gospel","forro manauara","forro instrumental","forro eletrico","forro romantico","forro das antigas","forro de vaquejada","piseiro","xote","vaqueiro","arrocha","arrochadeira","bregadeira","batidao romantico","sanfona","forro eletronico","forro universitario","brega","brega romantico","brega paraense","brega saudade","brega pop","brega eletronico","tecnobrega","tecnomelody","lambada","lambadao","carimbo","guitarrada","musica popular paraense","seresta","vaquejada"],
    "french hip hop": ["french hip hop","french trap","pop urbaine","cloud rap francais","drill francais","old school rap francais","rap francais nouvelle vague","plugg francais","rap calme","rap marseille","rap lyonnais","rap belge","rap liegeois","rap montrealais","hip hop quebecois","rap inde","rap antillais","trap antillais","hip hop reunionnais"],
    "french house": ["french house","filter house","new french touch","french indietronica","french electro","ed banger","crydamoure"],
    "french pop": ["french pop","chanson","nouvelle chanson francaise","nouvelle scene francaise","variete francaise","french indie pop","french synthpop","yeye","ye ye","electro-pop francais","classic french pop","vintage chanson","chanson virale","chanson quebecois","pop quebecois","indie quebecois","auteur-compositeur-interprete quebecois","french folk pop","french movie tunes","comedie musicale","musique alsacienne"],
    "free jazz": ["free jazz","avant-garde jazz","modern free jazz","deep free jazz","polish free jazz","spiritual jazz","ecm-style jazz","dark jazz","experimental jazz","indie jazz","tzadik","doom jazz"],
    "funk": ["funk","p-funk","synth funk","modern funk","instrumental funk","deep funk","traditional funk","new orleans funk","rare groove","go-go","minneapolis sound","minneapolis funk","funk pop","funktronica","neapolitan funk","eastern bloc groove","indie funk","chill funk","nu funk"],
    "funk carioca": ["funk carioca","brega funk","funk 150 bpm","funk mandelao","funk ostentacao","funk paulista","funk viral","mega funk","rave funk","funk rj","funk bh","funk consciente","funk das antigas","funk melody","funk evangelico","funk capixaba","funk floripa","funk sc","funk mineiro","funk putaria","funk ousadia","trap funk","trapnejo","funknejo","cumbia funk","deep funk ostentacao","chill baile","fvnky rimex","funk bruxaria","beat bruxaria","bruxaria funk","funk automotivo","beat automotivo","som automotivo","mega funk automotivo","eletrofunk","eletro funk","electro funk brasil","arrocha funk","arrochafunk","funk arrocha","funk arrochado","funk mtg","deboxe","funk mexicano"],
    "funk rock": ["funk rock"],
    "future bass": ["future bass","kawaii future bass","kawaii edm","chill trap","wave","hardwave","vapor twitch","future beats","twerk","trap and bass"],
    "gangster rap": ["gangster rap","chicano rap","crunk","snap music","houston rap","southern hip hop","memphis rap","memphis horrorcore","atl hip hop","old school atlanta hip hop","chicago rap","detroit hip hop","detroit trap","flint hip hop","miami hip hop","florida rap","baton rouge rap","new orleans rap","dfw rap","texas latin rap","tennessee hip hop","kentucky hip hop","st louis rap","minnesota hip hop","midwest hip hop","ohio hip hop","indiana hip hop","north carolina hip hop","south carolina hip hop","alabama rap","mississippi hip hop","arkansas hip hop","dirty texas rap","scam rap","horrorcore","chopped and screwed","kansas city hip hop","cincinnati rap","austin hip hop","san antonio rap","milwaukee hip hop","iowa hip hop","kansas hip hop","denver rap","alaska hip hop","idaho hip hop","nashville hip hop","hawaiian hip hop"],
    "garage rock": ["garage rock","classic garage rock","freakbeat","garage psych","garage rock revival","proto-punk","punk blues","deep classic garage rock","canadian garage rock","french garage rock","swedish garage rock","garage rock mexicano","australian garage punk","garage pop","indie garage rock","garage punk","medway sound","mod revival","modern mod","pub rock","rautalanka","indorock","beat italiano"],
    "german hip hop": ["german hip hop","frauenrap","german alternative rap","german cloud rap","german underground rap","oldschool deutschrap","deep german hip hop","hamburg hip hop","cologne hip hop","bayerischer rap","german trap","german viral rap","german jazz rap","austrian hip hop","swiss hip hop","schweizer rap","christlicher rap"],
    "german pop": ["german pop","neue deutsche welle","neue neue deutsche welle","german pop rock","german singer-songwriter","german indie","german indie pop","german indie rock","german indie folk","deep german indie","hamburger schule","austropop","austrian pop","austrian indie","swiss pop","swiss indie","mundart","kleinkunst","antideutsche"],
    "german rock": ["german rock","ostrock","german alternative rock","german hard rock","german punk","german punk rock","deep german punk","german street punk","german oi","german post-punk","german post-hardcore","german post-rock","german prog"],
    "glam rock": ["glam rock","glam punk","hard glam","glam metal","pop metal","new wave of glam metal","sleaze rock"],
    "global christian": ["global christian","african gospel","clap and tap","celtic worship","latin christian","latin worship","adoracion pentecostal","musica instrumental cristiana","deep latin christian","electronica cristiana","mariachi cristiano","salsa cristiana","reggaeton cristiano","trap cristiano","pop cristiano","reggae cristao","louvores pentecostais","fogo pentecostal","louvor icm","hinos ccb","coral gospel","quarteto gospel","gospel antigas","mpb gospel","musica eletronica gospel","musica crista reformada","adventista","indie cristao","tagalog worship","pinoy praise","papuri","bisaya worship","world worship","world devotional","south african gospel","ghanaian gospel","yoruba worship","igbo worship","kikuyu gospel","ugandan gospel","rwandan gospel","zambian gospel","zim gospel","congolese gospel","swahili gospel","haitian gospel","kompa chretien","pacific islands gospel","indonesian worship","korean worship","japanese worship","chinese worship","cantonese worship","thai worship","myanmar gospel","mizo gospel","tamil worship","telugu worship","malayalam worship","hindi worship","french worship","louange","chant religieux","german worship","swiss worship","psalmen","kerkkoor","norsk lovsang","svensk lovsang","dansk lovsang","finnish worship","hengelliset laulut","uwielbienie","ceske chvaly","slovenske chvaly","muzica crestina","gospel italiano","uk worship","nz christian","messianic praise","apostolic worship","chasidic pop","jewish pop","chabad niggunim","jewish cantorial","islamic recitation","quran","nasheed","nasyid","naat","latmiya","ilahiler","sholawat","zikir","taraneem","coptic hymn","mezmur","bhajan","modern bhajan","jain bhajan","odia bhajan","kirtan","hare krishna","shabad","tamil devotional","telugu devotional","marathi devotional","tibetan mantra","mantra","nohay","japanese buddhist chant","fo jing","bahai","lldm","zcc","musicas espiritas"],
    "gospel": ["gospel","black gospel","brazilian gospel","gospel r&b","gospel soul","naija worship","southern gospel","spiritual","spirituals","contemporary gospel","traditional gospel","family gospel","baptist gospel","groove gospel","gospel singers","gospel blues","gospel reggae"],
    "gothic metal": ["gothic metal","metal gotico","italian gothic metal","love metal","dark metal","vampire metal","melodic gothic metal","progressive gothic metal","symphonic gothic metal","symphonic doom metal"],
    "gothic rock": ["gothic rock","dark post-punk","deathrock","gothabilly","modern goth","heavy gothic rock","gothic post-punk","deep gothic post-punk","gothic alternative","italian gothic","batcave","rock gotico","old school goth","goth punk"],
    "grime": ["grime","eskibeat","sublow","uk grime","instrumental grime","birmingham grime","grimewave","neo grime","russian grime","australian grime","brazilian grime"],
    "grindcore": ["grindcore","cybergrind","goregrind","pornogrind","american grindcore","british grindcore","german grindcore","swedish grindcore","polish grindcore","technical grindcore","mathgrind","mincecore","noisecore","gorenoise","animegrind","voidgrind","necrogrind","crustgrind","noisegrind","techgrind"],
    "groove metal": ["groove metal","progressive groove metal","melodic groove metal","technical groove metal","thrash-groove metal","southern metal"],
    "grunge": ["grunge","grungegaze","post-grunge","seattle sound","bubblegrunge","spacegrunge","grunge pop","grunge revival","underground grunge","grunge argentina"],
    "gypsy jazz": ["gypsy jazz","manouche"],
    "happy hardcore": ["happy hardcore","uk hardcore","makina","deep happy hardcore","freeform hardcore","j-core","raggatek","breakbeat hardcore","uk uptempo hardcore","donk","scouse house","uk bounce"],
    "hard bop": ["hard bop","soul jazz","modal jazz","cool jazz","west coast jazz"],
    "hard rock": ["hard rock","arena rock","australian hard rock","modern hard rock","melodic hard rock","deep melodic hard rock","nwocr","swedish hard rock","swedish melodic rock","finnish hard rock","hard rock mexicano","canadian hard rock"],
    "hardcore punk": ["hardcore punk","crust punk","neo-crust","crasher crust","melodic crust","blackened punk","grindviolence","d-beat","melodic hardcore","modern melodic hardcore","japanese melodic hardcore","fast melodic punk","nyhc","powerviolence","skate punk","straight edge","vegan straight edge","youth crew","beatdown hardcore","metallic hardcore","modern hardcore","deep hardcore","deep hardcore punk","chain punk","egg punk","boston hardcore","new england hardcore","new jersey hardcore","connecticut hardcore","pennsylvania hardcore","dc hardcore","virginia punk","florida hardcore","texas hardcore","chicago hardcore","minneapolis punk","ohio hardcore","colorado hardcore","slc hardcore","california hardcore","nardcore","canadian hardcore","quebec hardcore","ukhc","uk82","street punk","oi","american oi","russian oi","umea hardcore","swedish hardcore","norwegian hardcore","danish hardcore","finnish hardcore","german hardcore","belgian hardcore","h8000","lowlands hardcore","french hardcore","spanish hardcore","hardcore punk espanol","street punk espanol","italian hardcore","polish hardcore","czech hardcore","russian hardcore","irish hardcore","australian hardcore","nz hardcore","japanese hardcore","burning spirits","korean hardcore","indonesian hardcore","malaysian hardcore","lion city hardcore","mexican hardcore","argentine hardcore","chilean hardcore","colombian hardcore","thrashcore","fastcore","stenchcore","thrash core","alabama hardcore","portuguese hardcore","alternative hardcore","french oi","old school hardcore","straight edge hardcore","youth crew hardcore","poppy hardcore","new school hardcore","heavy hardcore","progressive hardcore"],
    "hardstyle": ["hardstyle","classic hardstyle","euphoric hardstyle","gabber","nu gabber","hard dance","hardcore","hardcore techno","jumpstyle","rawstyle","xtra raw","uptempo hardcore","mainstream hardcore","industrial hardcore","terrorcore","early hardcore","nederlandse hardstyle","gym hardstyle","frenchcore","hardtek","freetekno","hardtekk","jumptek","lento violento","hardbass","gymcore","hard motivation","dark hardcore","doomcore","ruta destroy","bakalao","raw hardstyle","melodic hardstyle","australian hardstyle","italian hardstyle","french tek","acid tekno","melodic tekno","tribecore","piep kicks","early hardstyle","industrial hardstyle","hypertechno"],
    "heavy metal": ["heavy metal","nwobhm","nwothm","us power metal","uspm","finnish metal","finnish heavy metal","swedish metal","swedish heavy metal","german metal","german heavy metal","italian heavy metal","russian heavy metal","argentine heavy metal","proto-metal","retro metal","neo-trad metal","canadian metal","birmingham metal","spanish metal","latin metal","danish metal","texas metal","dutch metal","welsh metal","french metal","virginia metal","russian metal","norwegian metal","atlanta metal","boston metal","italian metal","irish metal","scottish metal","polish metal","swiss metal","mexican metal","greek metal","australian metal","vancouver metal","buffalo ny metal","kentucky metal","alabama metal","lapland metal","czech metal","miami metal","louisiana metal","tennessee metal","hungarian metal","oulu metal","austin metal","austrian metal","north carolina metal","sci-fi metal","cleveland metal","belgian metal","portland metal","slavic metal","argentine metal","pittsburgh metal","minneapolis metal","denver metal","portuguese metal","nz metal","metal colombiano","ukrainian metal","new england metal","seattle metal","nyc metal","metal catala","indian metal","chilean metal","icelandic metal","malaysian metal","israeli metal","native american metal","slovenian metal","lovecraftian metal","south carolina metal","metal ecuatoriano","peruvian metal","south african metal","romanian metal","euskal metal","singaporean metal","croatian metal","arkansas metal","wisconsin metal","guatemalan metal","utah metal","metal tico","belarusian metal","mainland se asia metal","bolivian metal","western ny metal","minnesota metal","estonian metal","metal salvadoreno","bulgarian metal","edinburgh metal","quebec metal","african metal","serbian metal","slovak metal","lithuanian metal","saxony metal","luxembourgian metal","metal galego","belfast metal","latvian metal","metal paraguayo","metal uruguayo","metal balear","central american metal","venezuelan metal","maltese metal","montana metal","cypriot metal","puerto rican metal","caribbean metal","macedonian metal","west virginia metal","arab metal","melodic metal","oriental metal","metal cover","metal guitar","shred","epic heavy metal","blackened heavy metal","spanish heavy metal","french heavy metal","us metal","uk metal","horror metal","theatrical metal"],
    "highlife": ["highlife","burger highlife","igbo highlife","old school highlife","ghanaian traditional","palm wine guitar","juju","fuji","apala","afro-cuban percussion","african percussion","indian percussion","brazilian percussion"],
    "hip hop": ["hip hop","deep underground hip hop","belgian hip hop","hip hop tuga","rap tuga underground","rap portuense","asian american hip hop","jamaican hip hop","central asian hip hop","kyrgyz hip hop","uzbek hip hop","turkmen hip hop","belarusian hip hop","estonian hip hop","latvian hip hop","lithuanian hip hop","middle east hip hop","gulf hip hop","afghan rap","armenian hip hop","georgian hip hop","azeri rap","meyxana","jewish hip hop","israelite hip hop","cypriot hip hop","rap moldovenesc","maltese hip hop","luxembourgian hip hop","mongolian hip hop","myanmar hip hop","khmer hip hop","lao hip hop","singaporean hip hop","hip hop timur","afrikaans hip hop","kasi rap","venda rap","sesotho hip hop","xhosa hip hop","swazi hip hop","malawian hip hop","botswana hip hop","ethiopian hip hop","rap congolais","hip hop galsen","rap ecuatoguineano","rap malien","rap gabonais","rap burkinabe","hip hop mauritanien","rap kreyol","native american hip hop","lapland hip hop","gothenburg hip hop","irish underground rap","hungarian underground rap","south african underground rap","military rap","maga rap","scratch","beatboxing","chipmunk soul","new school hip hop"],
    "house": ["house","uk house","classic house","detroit house","german house","australian house","canadian house","swedish house","nordic house","norwegian house","swiss house","greek house","romanian house","brazilian house","latin house","house argentino","japanese house","hard house","uk hard house","ghetto house","pumping house","minimal house","disco house","acid house","chicago house","piano house","vocal house","funky house","italo house","hip house","diva house","microhouse","rally house","circuit"],
    "hyperpop": ["hyperpop","digicore","glitchcore","dariacore","proto-hyperpop","hyperpop francais","french hyperpop","german hyperpop","hyperpop en espanol","hyperpop italiano","russian hyperpop","japanese hyperpop","korean hyperpop","indonesian hyperpop","czsk hyperpop","glitchbreak","hypertrance","webcore","weirdcore","crunkcore","drain","psychokore","robloxcore"],
    "idm": ["idm","ambient idm","braindance","drill and bass","fluxwork","glitch","glitch hop","wonky","deep idm","abstract idm","acid idm","japanese idm","glitch pop","glitch beats","microsound","algorave","skweee","folktronica","tape club","solipsynthm"],
    "indie": ["indie"],
    "indie folk": ["indie folk","chamber folk","folk pop","indie anthem-folk","modern indie folk","canadian indie folk","australian indie folk","scottish indie folk","swedish indie folk","french indie folk","spanish indie folk","indie folk italiano","japanese indie folk","indie folk argentino","stomp and flutter","stomp and whittle","ectofolk","indiecoustica","swiss indie folk","modern psychedelic folk","avant-folk","alternative folk","dream folk"],
    "indie pop": ["indie pop","alt pop","alternative pop","modern alternative pop","bedroom pop","indie poptimism","shimmer pop","twee pop","twee indie pop","pov: indie","modern indie pop","uk alternative pop","canadian indie","australian indie","australian alternative pop","nz indie","dunedin sound","scottish indie","glasgow indie","edinburgh indie","irish indie","dublin indie","welsh indie","cardiff indie","brighton indie","oxford indie","bristol indie","manchester indie","liverpool indie","leeds indie","sheffield indie","nottingham indie","birmingham indie","leicester indie","cambridgeshire indie","swedish indie pop","gothenburg indie","stockholm indie","norwegian indie","oslo indie","bergen indie","danish indie pop","danish indie","finnish indie","icelandic indie","dutch indie","belgian indie","polish indie","czech indie","slovak indie","hungarian indie","romanian indie","bulgarian indie","greek indie","russian indie","ukrainian indie","belarusian indie","lithuanian indie","latvian indie","estonian indie","israeli indie","turkish indie","japanese indie pop","j-pixie","thai indie pop","singaporean indie","malaysian indie","argentine indie","indie platense","indie cordoba","rosario indie","chilean indie","concepcion indie","peruvian indie","colombian indie","venezuelan indie","ecuadorian indie","uruguayan indie","mexican indie","cdmx indie","monterrey indie","guadalajara indie","indie triste","la indie","brooklyn indie","bay area indie","oakland indie","seattle indie","portland indie","austindie","chicago indie","boston indie","philly indie","atlanta indie","nashville indie","minneapolis indie","denver indie","phoenix indie","san diego indie","vancouver indie","toronto indie","montreal indie","jangle pop","modern jangle pop","jangle rock","c86","paisley underground","indie surf","surf pop","sophisti-pop","sunshine pop","indie soul","bedroom soul","small room","spanish indie pop","deep indie pop","japanese bedroom pop","tontipop","stomp pop","melodipop","soda pop","elephant 6","el paso indie","edmonton indie","sacramento indie","kentucky indie","new jersey indie","baltimore indie","athens indie","eau claire indie","newcastle nsw indie","morelos indie","veracruz indie","vegas indie","saskatchewan indie","quebec indie","cdo indie","ann arbor indie","northern irish indie","washington indie","auckland indie","chihuahua indie","murcia indie","cologne indie","slc indie","rochester mn indie","victoria bc indie","brisbane indie","north east england indie","albuquerque indie","alabama indie","asbury park indie","san marcos tx indie","reading indie","indie catala","perth indie","indie extremena","jacksonville indie","michigan indie","pittsburgh indie","grand rapids indie","tempe indie","nantes indie","south carolina indie","springfield mo indie","alaska indie","ontario indie","oc indie","kingston on indie","hokkaido indie","fremantle indie","olympia wa indie","new delhi indie","melbourne indie","north carolina indie","channel islands indie","orebro indie","cape town indie","louisville indie","london indie","orlando indie","asheville indie","socal indie","manso indie","gainesville indie","dayton indie","christchurch indie","sydney indie","okc indie","kc indie","munich indie","arunachal indie","omaha indie","kyushu indie","tulsa indie","dalarna indie","miami indie","granada indie","duluth indie","bath indie","eugene indie","rennes indie","manitoba indie","denton tx indie","indy indie","charlotte nc indie","connecticut indie","kolkata indie","tampa indie","rhode island indie","indie valenciana","vermont indie","cincinnati indie","kent indie","new orleans indie","nice indie","vienna indie","fort worth indie","hamburg indie","ohio indie","portuguese indie","charlottesville indie","kazakh indie","utah indie","western mass indie","dunedin indie","lexington ky indie","windsor on indie","hamilton on indie","maine indie","ghent indie","dallas indie","tamaulipas indie","ok indie","newfoundland indie","rochester ny indie","york indie","idaho indie","oaxaca indie","dc indie","sinaloa indie","southampton indie","devon indie","puerto rican indie","dominican indie","mumbai indie","newcastle indie","tassie indie","graz indie","warrington indie","rva indie","buffalo ny indie","lafayette indie","rogaland indie","uppsala indie","mississippi indie","sonora indie","kansai indie","derby indie","worcester ma indie","lancaster pa indie","memphis indie","tucson indie","euskal indie","leipzig indie","kelowna bc indie","halifax indie","lancashire indie","columbus ohio indie","oth indie","aarhus indie","limerick indie","zurich indie","kansas indie","arkansas indie","west virginia indie","stl indie","lund indie","wyoming indie","detroit indie","east anglia indie","norrbotten indie","little rock indie","north dakota indie","chattanooga indie","pei indie","myanmar indie","ottawa indie","montana indie","luxembourgian indie","caracas indie","essex indie","wisconsin indie","adelaide indie","calgary indie","albany ny indie","cleveland indie","tijuana indie","isle of wight indie","cork indie","kalmar indie","canberra indie","faroese indie","indie tico","indie campechano","virginia indie","pune indie","knoxville indie","bangalore indie","cornwall indie","london on indie","dresden indie","stuttgart indie","malmo indie","milwaukee indie","sevilla indie","south dakota indie","baja indie","lawrence ks indie","hull indie","norman ok indie","dundee indie","hampton roads indie","indie salvadoreno","west yorkshire indie","indie michoacano","chennai indie","coventry indie","iowa indie","north alabama indie","uae indie","indie cantabria","guam indie","swansea indie","wellington indie","panamanian indie","pittsburgh indie rock","poznan indie","triangle indie","indie canario","dusseldorf indie","merida indie","hawaiian indie","new hampshire indie","indiana indie","basel indie","rotterdam indie","salzburg indie","frankfurt indie","leon gto indie","derry indie","galician indie","dortmund indie","brno indie","portsmouth indie","fort wayne indie","indie poblano","trondheim indie","isle of man indie","oulu indie","missouri indie","indie boliviano","bern indie","san antonio indie","galway indie","indie sudcaliforniano","houston indie","svensk indie","paraguayan indie","armenian indie","prague indie","baton rouge indie","new brunswick indie","indie hidalguense","nagaland indie","indie trujillano","indie hidrocalido","st petersburg fl indie","indie arequipeno","aberdeen indie","kosovan indie","cape breton indie","umea indie","northamptonshire indie","guatemalan indie","delaware indie","sardinia indie","indie asturiana","indie queretano","indie nica","normal indie","lincoln ne indie","bohol indie","bury st edmunds indie","indie catracho","indie tucumano","belfast indie","indie nordeste argentino","santa fe indie","indie tabasqueno","twin cities indie","bruneian indie"],
    "indie rock": ["indie rock","british indie rock","english indie rock","scottish indie rock","irish indie rock","australian indie rock","swedish indie rock","dutch indie rock","belgian indie rock","spanish indie rock","portuguese indie rock","polish indie rock","russian indie rock","ukrainian alternative rock","greek indie rock","japanese indie rock","thai indie rock","argentine indie rock","indie rock mexicano","indie rock colombiano","indie rock peruano","indie rockism","indie punk","indie shoegaze","indie fuzzpop","lo-fi indie","slacker rock","gbvfi","american post-punk","uk post-punk revival","dance-punk","crank wave","windmill scene","deep indie rock"],
    "indietronica": ["indietronica","indie psych-pop","metropopolis","indietronica italiana","aussietronica","latintronica","jamtronica","livetronica","new rave","indie dance","indie sleaze"],
    "indonesian pop": ["indonesian pop","classic indo pop","indonesian indie","pop minang","indonesian pop rock","indonesian singer-songwriter","indonesian jazz","indonesian folk","indonesian folk pop","indonesian alternative rock","indonesian rock","classic indonesian rock","indonesian idol pop","indonesian lo-fi pop","indonesian viral pop","indonesian r&b","indonesian indie pop","indonesian indie rock","indonesian emo","indonesian emo rap","indonesian punk","indonesian pop punk","indonesian post-hardcore","indonesian ska","indonesian reggae","indonesian hip hop","indonesian underground hip hop","indonesian trap","indonesian edm","indonesian blues","indonesian psychedelia","indonesian neo-psychedelia","indonesian shoegaze","indonesian metal","indonesian thrash metal","malaysian hip hop","keroncong","gamelan","javanese gamelan","balinese traditional","sundanese traditional","lagu jawa","lagu sunda","lagu bali","lagu timur","lagu melayu","lagu aceh","lagu bugis","batak","trio batak","lagu karo","lagu manado","lagu maluku","maluku pop","lagu sasak","lagu sabahan","lagu iban","lagu betawi","bandung indie","yogyakarta indie","semarang indie","surabaya indie","malang indie","bogor indie","bali indie","lampung indie","rock kapak","dikir barat","sulawesi indie","lombok indie","pontianak indie","south borneo indie","balikpapan indie","lagu jambi","lagu lampung","lagu madura"],
    "industrial": ["industrial","aggrotech","ebm","old school ebm","electro-industrial","dark electro-industrial","dark electro","industrial rock","industrial metal","martial industrial","death industrial","power noise","rhythmic noise","industrial pop","post-industrial","cyber metal","neue deutsche harte","british industrial","industrial noise","new beat","swedish ebm","italian industrial","neo-industrial rock","harsh ebm","terror ebm","anhalt ebm","old school industrial"],
    "instrumental": ["instrumental","background piano","background music","background jazz","background jazz product","calming instrumental","instrumental worship","musica evangelica instrumental","lds instrumental","korean instrumental","japanese instrumental","chinese instrumental","thai instrumental","viet instrumental","turkish instrumental","latin instrumental","musica de fondo","japanese piano","indian violin","electric bass","double drumming"],
    "italian hip hop": ["italian hip hop","italian underground hip hop","rap italiano old school","rap genovese","rap napoletano","rap siciliano","rap sardegna","rap toscana","trap italiana","drill italiana","emo rap italiano","emo trap italiana","trap metal italiana"],
    "italian pop": ["italian pop","classic italian pop","italian adult pop","itpop","italian pop rock","pop virale italiano","indie rock italiano","milan indie","rome indie","turin indie","bergamo indie","puglia indie","firenze indie","indie liguria","indie veneto","indie napoletano","indie siciliano","canzone napoletana","neomelodici","canzone genovese","canzone siciliane","classic italian folk pop","vintage italian pop","r&b italiano","italian lounge","sanremo"],
    "j-metal": ["j-metal","japanese heavy metal","japanese power metal","japanese metalcore","japanese death metal","japanese black metal","japanese thrash metal","vocaloid metal","touhou metal"],
    "j-pop": ["j-pop","classic j-pop","anime","j-division","j-idol","j-pop boy group","j-pop girl group","japanese teen pop","kayokyoku","idol kayo","vocaloid","vocarock","cevio","synthv","utau","japanese electropop","japanese singer-songwriter","japanese viral pop","japanese dance pop","japanese alternative pop","j-acoustic","j-reggae","j-r&b","anison","anime rock","anime rap","anime piano","anime cv","denpa-kei","denpa","akiba-pop","seiyu","seiyuu","dansei seiyu","utaite","youtaite","vtuber","japanese vtuber","touhou","bemani","doujin","j-indie","classic anime","48g","alt-idol","idol","men chika","idol game","shonen","shojo","seinen","mecha","yaoi","yuri","neru"],
    "j-rap": ["j-rap","japanese chill rap","japanese pop rap","japanese old school hip hop","japanese underground rap","japanese trap","josei rap","samurai trap","japanese beats"],
    "j-rock": ["j-rock","classic j-rock","modern j-rock","j-poprock","japanese alternative rock","japanese post-hardcore","japanese post-punk","japanese punk rock","japanese melodic punk","japanese girl punk","japanese pop punk","japanese screamo","japanese garage rock","japanese rockabilly","japanese psychedelic","japanese psychedelic rock","japanese prog","j-punk"],
    "jazz": ["jazz"],
    "jazz fusion": ["jazz fusion","jazz rock","fusion","jazz funk","electric jazz","progressive jazz fusion","psychedelic jazz fusion","classical jazz fusion","deep jazz fusion","japanese jazz fusion","italian jazz fusion","jazz metal","gypsy fusion","world fusion"],
    "jazz rap": ["jazz rap","abstract hip hop","instrumental hip hop","turntablism"],
    "jerk rap": ["jerk rap","hoodtrap","kashtrap","mylancore","vampjerk","edm jerk","jerknb"],
    "jungle": ["jungle","modern jungle","old school jungle","footwork","juke","ambient jungle","atmospheric jungle","lo-fi jungle","footwork jungle","old skool jungle","junglecore","intelligent jungle"],
    "k-ballad": ["k-ballad","korean ost","k-drama ost"],
    "k-pop": ["k-pop","classic k-pop","classic korean pop","k-pop boy group","k-pop girl group","k-pop reality show","korean singer-songwriter","korean r&b","korean electropop","korean superband","korean talent show","joseon pop"],
    "k-rap": ["k-rap","korean old school hip hop","korean underground rap","korean trap"],
    "k-rock": ["k-rock","k-indie","korean indie rock","korean indie pop","korean indie folk","korean shoegaze","korean punk","korean metal"],
    "karaoke": ["karaoke","backing track","tribute","cover band","ringtone","8d"],
    "kawaii metal": ["kawaii metal","idol metal","cute metal","idol rock"],
    "kizomba": ["kizomba","ghetto zouk","semba","tarraxinha","zouk","kizomba antigas","kizomba cabo-verdiana","urban kiz","kompa","kompa gouyad","zouk riddim","zouklove","funana","ritmo kombina","antilliaanse folklore"],
    "klezmer": ["klezmer","yiddish folk","sefardi","judaica","kol isha"],
    "krushclub": ["krushclub","scenecore","krushfunk"],
    "latin": ["latin"],
    "latin hip hop": ["latin hip hop","argentine hip hop","rap underground argentino","chilean hip hop","rap sureno chileno","rap norteno chileno","rap feminino chileno","colombian hip hop","rap underground colombiano","venezuelan hip hop","peruvian hip hop","mexican hip hop","rap underground mexicano","rap regio","tamaulipas rap","rap femenino mexicano","hip hop cubano","rap boricua","rap dominicano","hip hop boliviano","rap uruguayo","rap paraguayo","rap ecuatoriano","rap salvadoreno","rap tico","rap nica","latin viral rap","narco rap","bases de freestyle","rap romantico","anime latino"],
    "latin jazz": ["latin jazz","afro-cuban jazz","jazz cubano","jazz puertorriqueno","jazz venezolano","danzon","descarga","deep latin jazz","jazz dominicano","jazz tico","jazz caraibes","jazz boliviano"],
    "latin pop": ["latin pop","mexican pop","latin ballad","balada","latin arena pop","latin viral pop","puerto rican pop","colombian pop","classic colombian pop","musica popular colombiana","pop argentino","argentine telepop","pop chileno","pop venezolano","classic venezuelan pop","pop peruano","classic peruvian pop","ecuadorian pop","panamanian pop","dominican pop","pop costarricense","pop boliviano","pop paraguayo","guatemalan pop","pop catracho","romantico","tropical","tropical alternativo","canadian latin","nueva ola chilena","nueva ola peruana","musica costena","musica tropical guatemalteca","tropical tecladista","combos nacionales","banda peruana","banda de viento","pop alternativo"],
    "latin trap": ["latin trap","trap argentino","trap boricua","trap chileno","trap colombiano","trap mexicano","trap venezolano","trap triste","urbano chileno","urbano mexicano","trap peruano","trap boliviano","rap latina","trap kreyol"],
    "lofi": ["lofi","chill beats","lo-fi hip hop","chillhop","lo-fi beats","lo-fi chill","lo-fi cover","lo-fi jazzhop","lo-fi sleep","lo-fi study","sad lo-fi","lo-fi product","lo-fi vgm","lo-fi rap","lo-fi pop","lo-fi latino","lo-fi brasileiro","punjabi lo-fi","indian lo-fi","viet lo-fi","anime lo-fi","study beats","focus beats","japanese chillhop"],
    "lullaby": ["lullaby","baby sleep","music box","instrumental lullaby"],
    "math rock": ["math rock","math pop","midwest math rock","japanese math rock","british math rock","instrumental math rock","math rock latinoamericano"],
    "medieval": ["medieval","early music","gregorian chant","renaissance","medieval rock","medieval folk","medieval ensemble","early music ensemble","early music choir","american early music","polish early music","portuguese early music","musique ancienne","musica antigua","franco-flemish school","english renaissance","french renaissance","german renaissance","italian renaissance","spanish renaissance","ars subtilior","trecento","troubadour","trouvere","minnesang","madrigal","bardcore","tavern","rune folk","bard","ancient mediterranean","mittelalter","mittelalter rock","medieval synth"],
    "merengue": ["merengue","mambo","merengue tipico","dominican merengue","merengue clasico","merengue hip hop","merenhouse","merengueton","tecno-merengue","mambo chileno","bomba","plena","bomba y plena","musica tradicional dominicana","tipico","punta","plena uruguaya","candombe"],
    "metal": ["metal"],
    "metalcore": ["metalcore","chaotic hardcore","chaotic metalcore","symphonic metalcore","electronicore","mathcore","melodic metalcore","progressive metalcore","post-metalcore","american metalcore","australian metalcore","canadian metalcore","uk metalcore","german metalcore","finnish metalcore","swedish metalcore","italian metalcore","polish metalcore","russian metalcore","ukrainian metalcore","chinese metalcore","metalcore espanol","nu-metalcore","alternative metalcore","deep metalcore","deep melodic metalcore","rap metalcore","trancecore","technical metalcore","old school metalcore","crabcore"],
    "moombahton": ["moombahton","moombahcore","dutch moombahton"],
    "moroccan rap": ["moroccan rap","trap maroc","north moroccan rap"],
    "mpb": ["mpb","jovem guarda","nova mpb","pop folk","tropicalia","velha guarda","violao","nova musica pernambucana","nova musica carioca","nova musica paulista","nova musica maranhense","nova musica amazonense","musica popular mineira","clube da esquina","musica baiana","musica alagoana","musica maranhense","musica paraibana","musica potiguar","musica cearense","musica sergipana","musica piauiense","musica capixaba","musica paranaense","musica catarinense","musica brasiliense","musica goiana","musica sul-mato-grossense","musica mato-grossense","musica popular amazonense","piano mpb","choro","choro contemporaneo","chorinho","bandolim","brass band brasileiro","trombone brasileiro","bandinhas"],
    "neofolk": ["neofolk","dark folk","apocalyptic folk","deep neofolk","neo-pagan","viking folk","pagan folk","combat folk","folk noir","murderfolk"],
    "new age": ["new age","new age piano","meditation","guided meditation","world meditation","healing","healing hz","432hz","528hz","solfeggio product","binaural","brain waves","chakra","reiki","kundalini","singing bowl","handpan","spa","massage","yoga","zen","relaxative","nu age","native american flute","shamanic"],
    "new jack swing": ["new jack swing","new jack smooth","90s r&b","freestyle","deep freestyle","popping","latin freestyle"],
    "new jazz": ["new jazz","new jazz rap","new jazz trap"],
    "new wave": ["new wave","new romantic","new wave pop","scottish new wave","spanish new wave","la movida","movida","italian new wave","belgian new wave","finnish new wave","japanese new wave","yugoslav new wave","deep new wave","minimal synth"],
    "nightcore": ["nightcore","sped up","speed up","speed up turkce","slowed and reverb","slowed","daycore"],
    "noise": ["noise","harsh noise","harsh noise wall","hnw","japanoise","noise rock","power electronics","noise pop","spanish noise pop","uk noise rock","polish noise rock","rock noise","noise punk","black noise","no wave"],
    "nu jazz": ["nu jazz","japanese jazztronica","electro jazz"],
    "old school hip hop": ["old school hip hop","golden age hip hop","old school uk hip hop","miami bass","booty bass","edo old school","britcore"],
    "oldies": ["oldies","golden oldies","classic oldies","beach music","harlem renaissance"],
    "opera": ["opera","arias","libretto","operatic pop","popera","classical crossover","classical tenor","italian tenor","classical soprano","italian soprano","boy soprano","classical mezzo-soprano","italian mezzo-soprano","classical contralto","classical baritone","italian baritone","classical countertenor","castrato","baroque singing","vintage classical singing","wagnerian singing","italian opera","french opera","german opera","opera chorus","operetta","zarzuela","cantonese opera","chinese opera","beijing opera","trallalero","marcha funebre"],
    "opm": ["opm","classic opm","pinoy indie","pinoy indie rock","p-pop","pinoy rock","pinoy alternative rock","vispop","acoustic opm","pinoy singer-songwriter","pinoy idol pop","pinoy r&b","pinoy hip hop","pinoy trap","pinoy drill","pinoy alternative rap","pinoy pop punk","pinoy shoegaze","pinoy metal","pinoy reggae","pinoy edm","kundiman","manila sound","bisaya rap","bisaya indie","bisrock","ilocano pop"],
    "pagode": ["pagode","pagode baiano","pagode novo","pagode romantico","pagodao"],
    "persian pop": ["persian pop","classic persian pop","persian electronic","persian alternative","persian hip hop","persian underground hip hop","persian melodic rap","persian sad rap","persian trap"],
    "persian rock": ["persian rock","iranian rock","iranian metal","persian metal"],
    "persian traditional": ["persian traditional","persian neo-traditional","persian poetry","tar","santur","kamancheh","duduk","mazandarani folk","afghan pop","afghan traditional","hazaragi pop","tajik pop","tajik traditional","musiqi-ye zanan","dambora"],
    "phonk": ["phonk","aggressive phonk","cowbell","gym phonk","memphis phonk","chill phonk","anime phonk","phonk brasileiro","ukrainian phonk","montagem phonk","funk phonk","trillwave","russian pixel","cloud phonk","rage phonk","melodic phonk","trill phonk","dungeon phonk","death phonk","g-phonk","phonkwave","deep phonk","rare phonk","blast phonk","military phonk","turkish phonk","phonk argentino"],
    "piano": ["piano","classical piano","piano cover","piano covers","solo piano","pianissimo","contemporary classical piano","british classical piano","american classical piano","canadian classical piano","australian classical piano","french classical piano","german classical piano","austrian classical piano","swiss classical piano","italian classical piano","spanish classical piano","dutch classical piano","belgian classical piano","nordic classical piano","polish classical piano","czech classical piano","hungarian classical piano","romanian classical piano","balkan classical piano","baltic classical piano","russian classical piano","ukrainian classical piano","caucasian classical piano","israeli classical piano","japanese classical piano","korean classical piano","chinese classical piano","latin american classical piano","brazilian classical piano","historic piano performance","classical piano trio","classical piano quartet","classical piano duo"],
    "pluggnb": ["pluggnb","dream plugg","dark plugg","emoplugg","plugg en espanol","russian plugg","ambient plugg","terror plugg","vampplugg","holy plugg","evil plugg"],
    "polish hip hop": ["polish hip hop","polish trap","polish viral rap","polish alternative rap","polish underground rap","polish old school hip hop","rap uliczny","rap motywacja","smutny rap"],
    "polka": ["polka","slovenian folk","polka nortena","oberkrainer","blasmusik","blaskapelle","volkstumliche musik","dechovka","narodnozabavna","heligonka","accordion","accordeon","accordion band","schrammelmusik","tanzlmusi","guggenmusik","marsmuziek","dweilorkest","tanzorchester","stubenmusik","karntner volksmusik","landler","boeremusiek","draaiorgel","band organ"],
    "pop": ["pop","bubblegum pop","dance pop","uk pop","classic uk pop","canadian pop","australian pop","nz pop","classic nz pop","irish pop","dutch pop","classic dutch pop","belgian pop","classic belgian pop","portuguese pop","classic portuguese pop","spanish pop","israeli pop","classic israeli pop","south african pop","polish pop","classic polish pop","czech pop","classic czech pop","slovak pop","hungarian pop","classic hungarian pop","romanian pop","classic romanian pop","classic bulgarian pop","greek pop","classic greek pop","cypriot pop","maltese pop","estonian pop","latvian pop","classic latvian pop","lithuanian pop","belarusian pop","ukrainian pop","classic ukrainian pop","ukrainian viral pop","moldovan pop","georgian pop","armenian pop","azeri pop","classic azeri pop","kazakh pop","uzbek pop","kyrgyz pop","turkmen pop","mongolian pop","malaysian pop","classic malaysian pop","bruneian pop","cambodian pop","lao pop","burmese pop","fijian pop","samoan pop","tongan pop","solomon islands pop","png pop","pacific islands pop","barbadian pop","post-teen pop","viral pop","social media pop","antiviral pop","talent show","deep talent show","boy band","girl group","classic girl group","boy pop","candy pop","channel pop","singer-songwriter pop","pop soul","pop edm","deep pop edm","pop house","deep dance pop","la pop","nyc pop","polish viral pop","czsk viral pop","dutch idol pop","chill pop","pop violin","brass band pop","luxembourgian pop","tatar pop","yakut pop","karen pop","melanesian pop","bahamian pop","guyanese pop","surinamese pop","turkce remix","classic pop","progressive pop","piano pop","retro pop","guitar pop"],
    "pop nacional": ["pop nacional","pop nacional antigas","pop teen brasileiro","pop lgbtq+ brasileira","viral pop brasileiro","speed up brasileiro","hyperpop brasileiro","r&b brasileiro","indie curitibano","belo horizonte indie","rio grande do sul indie","brasilia indie","musica triste brasileira","talentos brasileiros","novos talentos brasileiros","deep brazilian pop"],
    "pop punk": ["pop punk","anthem emo","easycore","neon pop punk","socal pop punk","canadian pop punk","uk pop punk","mexican pop punk","italian pop punk","swedish pop punk","finnish pop punk","russian pop punk","texas pop punk","chicago pop punk","diy pop punk","pop punk revival","ramonescore"],
    "pop rap": ["pop rap","hip pop","commercial rap","mainstream rap","melodic rap","radio rap","rap pop","uk melodic rap","aesthetic rap","viral trap","czech hip hop","slovak hip hop","hungarian hip hop","israeli hip hop","czsk hip hop"],
    "pop rock": ["pop rock","spanish pop rock","danish pop rock","czech pop rock","indie pop rock","piano rock"],
    "post-hardcore": ["post-hardcore","swancore","progressive post-hardcore","canadian post-hardcore","uk post-hardcore","australian post-hardcore","swedish post-hardcore","italian post-hardcore","post-post-hardcore","post-screamo","sasscore","modern post-hardcore","atmospheric post-hardcore"],
    "post-metal": ["post-metal","atmospheric post-metal","uk post-metal","post-doom metal","atmospheric sludge"],
    "post-punk": ["post-punk","uk post-punk","irish post-punk","danish post-punk","swedish post-punk","finnish post-punk","icelandic post-punk","french post-punk","spanish post-punk","italian post-punk","polish post-punk","baltic post-punk","russian post-punk","ukrainian post-punk","turkish post-punk","australian post-punk","canadian post-punk","post-punk latinoamericano","post-punk mexicano","post-punk argentina","post-punk colombiano","brazilian post-punk"],
    "post-rock": ["post-rock","instrumental post-rock","american post-rock","louisville underground","british post-rock","canadian post-rock","australian post-rock","nordic post-rock","french post-rock","belgian post-rock","spanish post-rock","portuguese post-rock","italian post-rock","polish post-rock","russian post-rock","japanese post-rock","chinese post-rock","taiwan post-rock","thai post-rock","southeast asian post-rock","mexican post-rock","post-rock latinoamericano","cinematic post-rock","ambient post-rock","atmospheric post-rock","cosmic post-rock","malaysian post-rock","indian instrumental rock"],
    "power metal": ["power metal","epic metal","fantasy metal","melodic power metal","swedish power metal","finnish power metal","german power metal","british power metal","italian power metal","russian power metal","mexican power metal","progressive power metal","neo classical metal","neoclassical metal","opera metal","extreme power metal","epic power metal","folk power metal"],
    "power pop": ["power pop","modern power pop","underground power pop","power-pop punk","deep power-pop punk"],
    "progressive house": ["progressive house","classic progressive house","dark progressive house","deep progressive house","japanese progressive house","minimal melodic techno","melodic techno","anjunadeep","anjunabeats","melodic house and techno","melodic progressive house","festival progressive house"],
    "progressive metal": ["progressive metal","instrumental metal","swedish progressive metal","finnish progressive metal","italian progressive metal","instrumental progressive metal","melodic progressive metal","progressive alternative","extreme progressive metal","progressive math metal"],
    "progressive rock": ["progressive rock","canterbury scene","crossover prog","krautrock","neo-prog","neo-trad prog","synth prog","symphonic prog","symphonic rock","rock opera","theatrical rock","avant-prog","modern progressive rock","deep progressive rock","rock progressivo italiano","italian modern prog","french progressive rock","rock progressif francais","rock progressif","dutch prog","spanish prog","spanish progressive rock","polish prog","swedish prog","svensk progg","norwegian prog","finnish progressive rock","prog quebec","rock progresivo mexicano","neo-kraut","eclectic prog","heavy prog","british progressive rock","canadian progressive rock"],
    "psychedelic": ["psychedelic","psychedelic pop","psychedelic folk","polish psychedelia","thai psychedelic","czech psychedelic","vintage french psychedelic","italian occult psychedelia","psicodelia mexicana","psicodelia chilena","norwegian psychedelic","french psychedelic","turkish psychedelic"],
    "psychedelic rock": ["psychedelic rock","classic psychedelic rock","acid rock","neo-psychedelia","raga rock","space rock","psychedelic space rock","deep space rock","australian psych","canadian psychedelic","canadian psychedelic rock","swedish psychedelic rock","finnish psychedelic rock","spanish psychedelic rock","greek psychedelic rock","indie psychedelic rock","psychedelic punk","heavy psych","latin american heavy psych","palm desert scene","cascadia psych","shimmer psych","psych gaze"],
    "psytrance": ["psytrance","goa trance","dark psytrance","deep darkpsy","forest psy","progressive psytrance","full-on","full on groove","deep full on","twilight psy","hi-tech","zenonesque","psytech","suomisaundi","nitzhonot","deep psytrance","south african psytrance","psybient","psybass","psycore","psyprog","progressive goa","vocal psytrance","minimal psytrance"],
    "punjabi pop": ["punjabi pop","bhangra","classic bhangra","classic punjabi pop","desi hip hop","punjabi hip hop","punjabi folk","uk bhangra","uk desi rap"],
    "punk": ["punk","early us punk","deep punk rock","punk 'n' roll","canadian punk","vancouver punk","quebec punk","new jersey punk","chicago punk","texas punk","arizona punk","portland punk","uk diy punk","northern irish punk","dutch punk","dutch punk rock","belgian punk","austrian punk","swiss punk","french punk","early french punk","spanish punk","punk urbano","punk catala","punk euskera","punk galego","punk tuga","italian punk","punk rock italiano","polish punk","czech punk","slovak punk","hungarian punk","romanian punk","greek punk","turkish punk","israeli punk","russian punk","russian punk rock","belarusian punk","swedish punk","trallpunk","danspunk","norwegian punk","norwegian punk rock","danish punk","finnish punk","icelandic punk","brisbane punk","melbourne punk","adelaide punk","nz punk","south african punk","chinese punk","singaporean punk","malaysian punk","malang punk","punk mexicano","punk rock mexicano","argentine punk","punk chileno","punk melodico chileno","peruvian punk","punk colombiano","punk ecuatoriano","punk tico","folk punk","surf punk","beach punk","horror punk","horror punk brasileiro","synth punk","art punk","anarcho-punk","boston punk","atlanta punk","kentucky punk","long island punk","irish punk","hawaiian punk","chicano punk","acoustic punk","black punk","dub punk","slash punk","punk ska","nordnorsk ponk","punk cover","peace punk","political punk","melodic punk","british punk","japanese punk","siberian punk","77 punk","pirate punk","old school punk"],
    "r&b": ["r&b","alternative r&b","trap soul"],
    "rap": ["rap"],
    "rap rock": ["rap rock","punk rap","rap punk"],
    "reggae": ["reggae","roots reggae","roots rock reggae","modern reggae","traditional reggae","early reggae","vintage reggae","lovers rock","lovers reggae","rocksteady","mento","nyahbinghi","uk reggae","french reggae","german reggae","italian reggae","spanish reggae","reggae catala","euskal reggae","reggae tuga","nederreggae","swiss reggae","polish reggae","czsk reggae","swedish reggae","finnish reggae","russian reggae","turkish reggae","chinese reggae","japanese reggae","korean reggae","israeli reggae","bulgarian reggae","serbian reggae","australian reggae fusion","nz reggae","jawaiian","hawaiian","hawaiian reggae","california reggae","west coast reggae","east coast reggae","african reggae","reggae maghreb","seggae","sega","sega mauricien","maloya","kaneka","brazilian reggae","reggae do maranhao","reggae gaucho","argentine reggae","reggae cuyano","reggae uruguayo","reggae peruano","reggae boliviano","reggae mexicano","reggae tico","reggae puerto rico","colombian reggae","reggae en espanol","trinidadian reggae","virgin islands reggae","reggae cover","kaseko","baithak gana","skinhead reggae","dancehall reggae","reggae pop","latin reggae","christian reggae","salegy","tsapiky"],
    "reggaeton": ["reggaeton","neoperreo","perreo","pop reggaeton","reggaeton chileno","reggaeton colombiano","reggaeton flow","reggaeton mexicano","urbano latino","electro latino","cubaton","reparto","salsaton","rkt","turreo","malianteo","bellakeo","previa"],
    "regional mexican": ["regional mexican","banda","banda sinaloense","banda jalisciense","banda carnavalera","banda guanajuatense","tamborazo","tecnobanda","duranguense","musica duranguense","tierra caliente","corrido","corridos","grupera","mariachi","norteno","deep norteno","norteno-sax","ranchera","tejano","new tejano","tex-mex","chicano","chicago mexican","regional mexicano femenil","guitarra mexicana","marimba mexicana","arpa grande","huapango","pirekua","musica purepecha","musica wixarika","musica indigena mexicana","musica chihuahuense","musica sonorense","musica bajacaliforniana","musica sudcaliforniana","musica sinaloense","musica tamaulipeca","musica neoleonesa","musica coahuilense","musica potosina","musica jalisciense","musica michoacana","musica guerrerense","musica oaxaquena","musica istmena","musica chiapaneca","musica tabasquena","musica campechana","musica yucateca","musica quintanarroense","musica poblana","musica tlaxcalteca","musica morelense","musica mexiquense","musica queretana","musica aguascalentense","musica nayarita","musica colimense","musica mixteca","musica nortena chilena","new mexico music","chilena","tololoche","musica urbana oaxaquena","narcocorridos"],
    "riot grrrl": ["riot grrrl","women's music"],
    "rock": ["rock"],
    "rock and roll": ["rock and roll","mexican rock-and-roll","swedish rock-and-roll","french rock-and-roll","rhythm and boogie","twist","yu-mex"],
    "rock en espanol": ["rock en espanol","latin alternative","latinx alternative","deep latin alternative","argentine rock","rock nacional","argentine alternative rock","chilean rock","mexican rock","rock nacional mexicano","mexican classic rock","rock urbano mexicano","colombian rock","peruvian rock","venezuelan rock","uruguayan rock","ecuadorian alternative rock","paraguayan rock","bolivian rock","puerto rican rock","panamanian rock","rock dominicano","rock tico","rock chapin","rock catracho","rock nica","spanish rock","spanish modern rock","rock alternativo espanol","spanish invasion","rock catala","euskal rock","galician rock","rock en asturiano","rock canario","rock of gibraltar","rock alternativo","rock barrial","rock radical vasco","rock transgresivo"],
    "rockabilly": ["rockabilly","neo-rockabilly","traditional rockabilly","psychobilly","deep psychobilly","uk rockabilly","canadian rockabilly","australian rockabilly","german rockabilly","french rockabilly","spanish rockabilly","italian rockabilly","swedish rockabilly","finnish rockabilly","rockabilly en espanol","vintage rockabilly"],
    "russian pop": ["russian pop","classic russian pop","russian dance","russian hip hop","ukrainian hip hop","kazakh hip hop","russian alt pop","russian viral pop","russian dance pop","russian synthpop","soviet synthpop","russian edm","russian trance","russian rave","russian electronic","russian witch house","russian drain","zxc","russian trap","russian gangster rap","russian underground rap","russian viral rap","russian old school hip hop","russian emo rap","zhenskiy rep","russian chanson","russian romance","russian bard","estrada","soviet estrada","kavkaz","chechen pop","lezginka"],
    "russian rock": ["russian rock","classic russian rock","new wave of russian rock","russian alternative rock","russian nu metal"],
    "salsa": ["salsa","boogaloo","pachanga","modern salsa","salsa choke","salsa colombiana","salsa cubana","salsa puertorriquena","salsa urbana","salsa venezolana","salsa peruana","salsa international","salsa dura","salsa romantica","salsa sensual","salsa guajira","salsa brava","salsa erotica","timba","son cubano","son cubano clasico","son montuno","guajira","charanga","orquesta cubana","orquesta tropical","cha-cha-cha","cuban rumba","guaguanco","afro-cuban traditional","fania","salsa boricua","dominican salsa","new york salsa"],
    "samba": ["samba","samba paulista","samba-enredo","samba-rock","samba moderno","samba de roda","roda de samba","samba gospel","partido alto","samba-canção","samba cancao","samba de breque","marchinha","marchinha de carnaval","batucada","candomble","umbanda","capoeira"],
    "scandinavian hip hop": ["scandinavian hip hop","swedish hip hop","swedish gangsta rap","swedish trap","swedish trap pop","swedish pop rap","swedish underground rap","norwegian hip hop","norwegian trap","norwegian pop rap","norrlandsk hip hop","nordnorsk rap","danish hip hop","finnish hip hop","suomirap","finnish trap","icelandic hip hop"],
    "scandinavian pop": ["scandinavian pop","classic swedish pop","danish pop","classic danish pop","dansband","danseband","dansktop","finnish pop","classic finnish pop","finnish dance pop","finnish idol pop","iskelma","classic iskelma","suomipop","norwegian pop","classic norwegian pop","vintage norwegian pop","scandipop","swedish pop","swedish idol pop","swedish synth","swedish soul","icelandic pop","classic icelandic pop","faroese pop","greenlandic pop","epa dunk","russemusikk","russelater","hakkapop","drikkelek","finnish soul"],
    "schlager": ["schlager","classic schlager","discofox","deep discofox","partyschlager","volksmusik","neue volksmusik","volkspop","vintage schlager","ostschlager","alpine yodeling","yodeling","naturjodel","zillertal","alpenpanorama","oktoberfest","karneval","kolsche karneval","ballermann","apres ski","levenslied","piratenmuziek","carnaval limburg","oeteldonk","smartlap","finnish tango","humppa","kermis","magyar mulatos","raspe","sotalaulut"],
    "screamo": ["screamo","emoviolence","screamocore","italian screamo","russian screamo","french screamo","spanish screamo","mexican screamo","midwest screamo","bedroom screamo","bedroom skramz","twinkle skramz","twinkle screamo","lofi skramz","mall screamo","chaotic screamo"],
    "sea shanties": ["sea shanties","pirate","pirate folk","maritime","seemannslieder","szanty","shantykoren"],
    "sertanejo": ["sertanejo","agronejo","sertanejo pop","sertanejo tradicional","sertanejo universitario","sertanejo gospel","viola caipira","rock caipira","emo caipira","moda de viola","caipira"],
    "sexy drill": ["sexy drill","sample drill","bronx drill","brooklyn drill","jersey drill"],
    "shoegaze": ["shoegaze","nu gaze","chillgaze","american shoegaze","canadian shoegaze","australian shoegaze","nordic shoegaze","german shoegaze","french shoegaze","japanese shoegaze","j-shoegaze","sinogaze","asiagaze","thai shoegaze","russian shoegaze","latin shoegaze","shoegaze chileno","italogaze","bleakgaze","voidgaze","heavy shoegaze","heavygaze","mikgaze","j-gaze","tweegaze","emogaze","breakgaze","zoomergaze","newgaze","stonegaze","dronegaze","shitgaze","deathgaze","grindgaze"],
    "show tunes": ["show tunes","broadway","hollywood","theatre","west end","movie tunes","vintage broadway","vintage hollywood","german show tunes","magyar musicalek","korean musicals","musical advocacy","glee club","dutch musical"],
    "sierreno urbano": ["sierreno urbano"],
    "sigilkore": ["sigilkore","hexd","jewelxxet","yabujincore"],
    "singer-songwriter": ["singer-songwriter","acoustic pop","cantautor","cantautori","canzone d'autore","gen z singer-songwriter","liedermacher","lilith","neo mellow","british singer-songwriter","irish singer-songwriter","scottish singer-songwriter","canadian singer-songwriter","australian singer-songwriter","nz singer-songwriter","nashville singer-songwriter","austin singer-songwriter","swedish singer-songwriter","norwegian singer-songwriter","danish singer-songwriter","icelandic singer-songwriter","laulaja-lauluntekija","dutch singer-songwriter","belgian singer-songwriter","swiss singer-songwriter","cantautor catala","cantautora mexicana","cantautora argentina","czech singer-songwriter","israeli singer-songwriter","vietnamese singer-songwriter","neo-singer-songwriter","indie singer-songwriter","deep indie singer-songwriter","deep acoustic pop","scottish hush","one-person band"],
    "ska": ["ska","traditional ska","ska punk","two-tone","3rd wave ska","third wave ska","skacore","ska-core","ska core","jamaican ska","ska revival","modern ska punk","ska jazz","latin ska","ska espanol","ska catala","ska mexicano","ska argentino","ska chileno","brazilian ska","german ska","italian ska","japanese ska","australian ska","euroska","crack rock steady","bluebeat","russian ska","ska rock","j-ska","turkish ska","christian ska","patchanka","mestizaje"],
    "sleep": ["sleep","white noise","pink noise","color noise","rain","water","ocean","environmental","sound","nature sounds","birdsong","whale song","asmr","pet calming","subliminal product"],
    "slowcore": ["slowcore","sadcore"],
    "sludge metal": ["sludge metal","sludgecore","atmospheric sludge metal","progressive sludge","black sludge","blackened sludge"],
    "smooth jazz": ["smooth jazz","smooth saxophone","deep smooth jazz"],
    "soca": ["soca","calypso","chutney","power soca","groovy soca","bajan soca","vincy soca","grenada soca","bouyon","dennery segment","raboday","steelpan"],
    "soukous": ["soukous","rumba congolaise","ndombolo","musique urbaine kinshasa","musique urbaine brazzaville","musique traditionnelle congolaise","sebene"],
    "soul": ["soul","classic soul","motown","deep motown","soul funk","retro soul","souldies","british soul","brazilian soul","traditional soul","smooth soul","instrumental soul","southern soul","deep southern soul","southern soul blues","northern soul","deep northern soul","philly soul","chicago soul","memphis soul","new orleans soul","psychedelic soul","blue-eyed soul","neo soul","latin soul","uk soul","french soul","scandinavian soul","acoustic soul","chicano soul"],
    "soundtrack": ["soundtrack","classic soundtrack","film music","movie music","original motion picture soundtrack","original score","score","theme music","tv music","tv themes","theme","bgm","british soundtrack","canadian soundtrack","french soundtrack","german soundtrack","italian soundtrack","vintage italian soundtrack","nordic soundtrack","turkish soundtrack","japanese soundtrack","korean soundtrack","chinese soundtrack","chinese bgm","thai ost","thai bl ost","korean bl ost","latin soundtrack","oceania soundtrack","deep soundtrack","library music","italian library music","spytrack","sound team","middle earth","fantasy","hong kong tv drama"],
    "spanish hip hop": ["spanish hip hop","rap underground espanol","rap canario","rap catala","trap catala","rap galego","rap euskera","urbano espanol","spanish trap"],
    "speed metal": ["speed metal","black speed metal","new wave of speed metal","melodic speed metal","technical speed metal","blackened speed metal"],
    "spoken word": ["spoken word","sung poetry","poezja spiewana","dainuojamoji poezija","slam poetry","beat poetry","audiobook","hoerspiel","children's story","barnsagor","bornehistorier","lasten satuja","cocuk masallari","detskie rasskazy","pohadky","rozpravky","hangoskonyvek","cuento infantile","mluvene slovo","lesen","reading","german literature","vintage radio show"],
    "stoner metal": ["stoner metal","doomgaze"],
    "stoner rock": ["stoner rock","desert rock","instrumental stoner rock","uk stoner rock","swedish stoner rock","german stoner rock","dutch stoner rock","belgian stoner rock","french stoner rock","spanish stoner rock","italian stoner rock","austrian stoner rock","canadian stoner rock","hard stoner rock"],
    "stutter house": ["stutter house"],
    "sufi music": ["sufi music","ghazal","indian instrumental","qawwali","sufi","sufi chant","mevlevi sufi","indian classical","hindustani classical","hindustani vocal","hindustani instrumental","carnatic","carnatic vocal","carnatic instrumental","khayal","dhrupad","sitar","sarod","tabla","bansuri","santoor","sarangi","shehnai","veena","nadaswaram"],
    "surf rock": ["surf rock","surf music","instrumental surf","australian surf rock","latin surf rock","deep surf music","horror surf"],
    "swing": ["swing","modern swing","vintage swing","swing italiano","czech swing","greek swing","jive","lindy hop"],
    "symphonic metal": ["symphonic metal","female fronted metal","gothic symphonic metal","symphonic power metal","trance metal","flamenco metal","cello metal","cello rock"],
    "synthpop": ["synthpop","neo-synthpop","early synthpop","dark synthpop","swedish synthpop","spanish synthpop","polish synthpop","futurepop","electroclash","deep neo-synthpop","popwave"],
    "synthwave": ["synthwave","darksynth","spacewave","synthwave brasileiro","dreamwave","cyberpunk","nightrun","spacesynth","space synth","witch house","horror synth"],
    "tango": ["tango","vintage tango","nuevo tango","tango cancion","orquesta tipica","bandoneon","milonga"],
    "tech house": ["tech house","minimal tech house","uk tech house","french tech house","dutch tech house","deep tech house","italian tech house","funky tech house","latin tech house","german tech house","brazilian tech house","mexican tech house","deep deep tech house","tribal house","jackin' house"],
    "techno": ["techno","minimal techno","acid techno","hard acid techno","detroit techno","dub techno","hard techno","industrial techno","dark industrial techno","berlin minimal techno","berlin techno","schranz","peak time techno","dark techno","german techno","german dark minimal techno","dark minimal techno","deep minimal techno","high-tech minimal","rominimal","belgian techno","french techno","italian techno","spanish techno","portuguese techno","swiss techno","austrian techno","polish techno","hungarian techno","romanian techno","greek techno","swedish techno","norwegian techno","finnish techno","scottish techno","irish techno","russian techno","australian techno","south african techno","indian techno","japanese techno","brazilian techno","mexican techno","chilean techno","techno argentina","raw techno","hypnotic techno","modular techno","techno rave","hard industrial techno","hardgroove","groovy techno","deep hardtechno","destroy techno","somatik techno","bleep techno","proto-techno","acidcore","danish techno","israeli techno","hard minimal techno","re:techno","big room techno","warehouse techno","old school techno","fast techno","rave techno","tribal techno","uk techno","underground techno","future techno"],
    "thai pop": ["thai pop","t-pop","luk thung","classic luk thung","mor lam","molam","phleng phuea chiwit","thai indie","thai rock","thai teen pop","thai viral pop","thai pop rap","thai hip hop","thai trap","thai metal","classic thai pop","t-pop girl group"],
    "thrash metal": ["thrash metal","crossover thrash","thrash punk","punk metal","metal punk","teutonic thrash metal","trash metal","bay area thrash","teutonic thrash","old school thrash","german thrash metal","swedish thrash metal","polish thrash metal","russian thrash metal","australian thrash metal","mexican thrash metal","colombian thrash metal","technical thrash","technical thrash metal","progressive thrash","progressive thrash metal","melodic thrash","new wave of thrash metal","power thrash","british thrash metal","speed thrash metal","spanish thrash metal","turkish thrash metal","ukrainian thrash metal","brutal thrash metal","modern thrash metal","italian thrash metal","symphonic thrash metal","melodic thrash metal","canadian thrash metal"],
    "trance": ["trance","progressive trance","uplifting trance","vocal trance","hard trance","old school hard trance","tech trance","euro trance","dream trance","classic trance","melodic trance","german trance","dutch trance","italian trance","trance brasileiro","trance mexicano","progressive uplifting trance","progressive trance house","deep uplifting trance","deep progressive trance","cosmic uplifting trance","acid trance","balearic trance","bubble trance","chill-out trance","focus trance","glitter trance","covertrance","pure trance","dark trance","deep trance","cybertrance","neotrance","emotional trance","minimal trance"],
    "trap": ["trap","atl trap","cloud rap","dark trap","desi trap","emo trap","emo trap en espanol","plugg","rage rap","sad rap","trap queen","viral rap","southern trap","deep southern trap","melodic trap","tread","electronic trap","edm trap","festival trap","future trap","liquid trap","wave trap","instrumental trap","bass trap","hybrid trap","ambient trap","traprun","trap beats","south african trap","vietnamese trap","trap tuga","trap angolano","ua trap","israeli trap","greek trap","bulgarian trap","romanian trap","magyar trap","slovak trap","lithuanian trap","detroit trap en espanol","swiss trap","irish trap","indian trap","arabic trap","texas trap","florida trap","dungeon rap","futuristic swag","soundcloud rap","mumble rap","trill","hard trap","supertrap","witch trap"],
    "trap metal": ["trap metal","scream rap","necrotrap","turkce trap metal","russian trap metal","death rap","ragecore"],
    "trip hop": ["trip hop","bristol electronic"],
    "tropical house": ["tropical house","sax house","deep tropical house","swedish tropical house"],
    "trot": ["trot","korean old pop"],
    "turkish folk": ["turkish folk","karadeniz turkuleri","rumeli turkuleri","bozlak","oyun havasi","baglama","cerkes muzikleri","kurdish pop","kurdish hip hop","kurdish rock","alevi","ulkucu sarkilar"],
    "turkish hip hop": ["turkish hip hop","new school turkce rap","turkish trap","turkish trap pop","turkce kadin rap","turkish underground rap"],
    "turkish pop": ["turkish pop","classic turkish pop","arabesk","taverna muzigi","deep turkish pop","turkish alt pop","turkce slow sarkilar","huzunlu sarkilar","karadeniz pop","turkish singer-songwriter","turkish edm","turkish electronic","turkish classical","turkish classical performance","fantezi","damar","ozgun muzik"],
    "turkish rock": ["turkish rock","anatolian rock","anadolu pop","turkish alternative","turkish alternative rock","turkish psych","turkish metal","turkish hardcore"],
    "uk drill": ["uk drill"],
    "uk garage": ["uk garage","2-step","bassline","old school bassline","future garage","garage","speed garage","ukg revival","uk funky","bassline garage","dark garage"],
    "uk hip hop": ["uk hip hop","london rap","uk alternative hip hop","scouse rap","manchester hip hop","birmingham hip hop","nottingham hip hop","scottish hip hop","welsh hip hop","irish hip hop","road rap"],
    "vallenato": ["vallenato","vallenato moderno","vallenato romantico"],
    "vaporwave": ["vaporwave","broken transmission","future funk","mallsoft","slushwave","utopian virtual","vapor trap","dreampunk","hardvapour","eccojams","signalwave","late night lo-fi","barber beats","seapunk","frutiger aero"],
    "vgm": ["vgm","anime game","anime score","anime ost","anime soundtrack","gamecore","indie game soundtrack","japanese vgm","nintendocore","otacore","rhythm game","scorecore","vgm remix","vgm instrumental","game mood","pixel","speedrun","video game metal","video game rock","video game remixes"],
    "vietnamese pop": ["vietnamese pop","v-pop","vietnamese hip hop","vinahouse","vietnamese idol pop","vietnamese bolero","vietnamese traditional","nhac vang","tan co","indie viet","rock viet","viet chill rap","vietnamese melodic rap","viet remix","viet edm","vietnamese electronic"],
    "visual kei": ["visual kei","angura kei","eroguro","oshare kei","nagoya kei","kote kei","tanbi kei","menhera kei","jirai kei"],
    "vocal jazz": ["vocal jazz","contemporary vocal jazz","deep vocal jazz","japanese vocal jazz"],
    "west coast hip hop": ["west coast hip hop","g-funk","deep g funk","cali rap","oakland hip hop","bay area hip hop","sacramento hip hop","san diego rap","oc rap","seattle hip hop","portland hip hop","hyphy","jerkin","westcoast flow","west coast trap"],
    "worship": ["worship","worship pop","pop worship","anthem worship","devotional","roots worship","modern uplift"],
    "zydeco": ["zydeco","cajun","louisiana blues","swamp pop","second line"]
  };

  const COUNTRY_MAPPINGS = {
    "united states": ["usa", "us", "united states", "united states of america", "america", "american", "u.s.a.", "murica"],
    "canada": ["canada", "canadian", "canadien", "ca", "canuck", "great white north", "quebec", "quebecois"],
    "mexico": ["mexico", "mexican", "mexicano", "mexicana", "méxico", "mx", "mex", "aztec"],
    "united kingdom": ["uk", "united kingdom", "britain", "british", "great britain", "england", "english", "scotland", "scottish", "wales", "welsh", "northern ireland", "northern irish", "gb", "gbr", "brit", "albion", "blighty"],
    "ireland": ["ireland", "irish", "eire", "ie", "hibernia", "emerald isle"],
    "france": ["france", "french", "français", "francais", "francaise", "francophone", "fr", "hexagon", "gallia"],
    "germany": ["germany", "german", "deutschland", "deutsch", "deutsche", "deutscher", "de", "brd", "allemagne", "aleman"],
    "netherlands": ["netherlands", "the netherlands", "dutch", "holland", "flemish", "nl", "nld", "low countries", "nederland", "nederlands", "nederlandstalig"],
    "belgium": ["belgium", "belgian", "be", "belgique", "belgie", "vlaams"],
    "luxembourg": ["luxembourg", "luxembourgish", "luxembourgian"],
    "switzerland": ["switzerland", "swiss", "ch", "suisse", "schweiz", "svizzera", "helvetia"],
    "austria": ["austria", "austrian", "at", "osterreich", "österreich"],
    "sweden": ["sweden", "swedish", "sverige", "svensk", "svenska", "svenskt", "se", "swe"],
    "norway": ["norway", "norwegian", "norge", "norsk", "no", "nor"],
    "denmark": ["denmark", "danish", "danmark", "dansk", "dk", "dnk"],
    "finland": ["finland", "finnish", "suomi", "fi", "fin"],
    "iceland": ["iceland", "icelandic", "island", "islenskt", "is", "ice"],
    "faroe islands": ["faroe islands", "faroese"],
    "greenland": ["greenland", "greenlandic"],
    "spain": ["spain", "spanish", "españa", "espana", "espanol", "español", "castellano", "es", "iberia", "catalan", "catala", "catalunya", "basque", "euskara", "euskal herria", "galicia", "galician", "galiza", "andalusia", "andalucia"],
    "andorra": ["andorra", "andorran"],
    "portugal": ["portugal", "portuguese", "portugues", "luso", "pt", "lusitania"],
    "italy": ["italy", "italian", "italia", "italiano", "italiana", "italiani", "it", "azzurri"],
    "malta": ["malta", "maltese"],
    "greece": ["greece", "greek", "ellada", "hellenic", "ellinika", "gr", "hellas"],
    "cyprus": ["cyprus", "cypriot"],
    "russia": ["russia", "russian", "rossiya", "russkij", "rus", "ru", "soviet", "ussr", "soviet union", "rusia"],
    "ukraine": ["ukraine", "ukrainian", "ukranian", "ucrania", "ukraina", "ua", "ukr", "ukrayina"],
    "belarus": ["belarus", "belarusian", "belarussian", "belorussian", "bialorus"],
    "moldova": ["moldova", "moldovan", "moldovian", "moldavia"],
    "poland": ["poland", "polish", "polska", "polski", "polskie", "pl", "pol"],
    "czech republic": ["czech republic", "czech", "czechia", "cz", "bohemia"],
    "slovakia": ["slovakia", "slovak", "slovakian"],
    "hungary": ["hungary", "hungarian", "magyar", "hu", "hun"],
    "romania": ["romania", "romanian", "ro", "rom"],
    "bulgaria": ["bulgaria", "bulgarian", "bg"],
    "serbia": ["serbia", "serbian", "rs", "srbija", "srpsko"],
    "croatia": ["croatia", "croatian", "hr", "hrvatska", "hrvatsko"],
    "bosnia": ["bosnia", "herzegovina", "bosnian", "bosnia and herzegovina", "bosnia-herzegovina", "bosansko", "ba", "bih"],
    "slovenia": ["slovenia", "slovenian", "slovenija"],
    "north macedonia": ["north macedonia", "macedonia", "macedonian", "makedonija"],
    "montenegro": ["montenegro", "montenegrin"],
    "kosovo": ["kosovo", "kosovan", "kosovar"],
    "albania": ["albania", "albanian", "al", "shqiperia", "shqip"],
    "estonia": ["estonia", "estonian", "eesti", "ee"],
    "latvia": ["latvia", "latvian", "lv", "latvija"],
    "lithuania": ["lithuania", "lithuanian", "lt", "lietuva"],
    "turkey": ["turkey", "turkish", "türkiye", "turkiye", "turkce", "turk", "türk", "turkisch", "tr", "anatolian", "ottoman"],
    "armenia": ["armenia", "armenian", "hayastan"],
    "georgia": ["georgia", "georgian", "sakartvelo"],
    "azerbaijan": ["azerbaijan", "azerbaijani", "azeri", "azerbaycan"],
    "kazakhstan": ["kazakhstan", "kazakh", "qazaq"],
    "uzbekistan": ["uzbekistan", "uzbek"],
    "kyrgyzstan": ["kyrgyzstan", "kyrgyz"],
    "turkmenistan": ["turkmenistan", "turkmen"],
    "tajikistan": ["tajikistan", "tajik"],
    "mongolia": ["mongolia", "mongolian", "mongol"],
    "japan": ["japan", "japanese", "nihon", "nippon", "jp", "jpn", "yamato"],
    "south korea": ["south korea", "korea", "korean", "south korean", "hanguk", "kr", "kor", "rok", "joseon"],
    "china": ["china", "chinese", "mandarin", "cantonese", "cn", "chn", "prc", "zhongguo", "mainland china", "hk", "hong kong", "taiwan", "taiwanese", "roc"],
    "india": ["india", "indian", "in", "ind", "hindi", "bharat", "desi", "tamil", "telugu", "bhojpuri", "bengali", "malayalam", "punjabi", "punjab", "kannada", "marathi", "gujarati", "assamese", "odia", "haryanvi", "kashmiri", "konkani"],
    "pakistan": ["pakistan", "pakistani", "pk", "pak", "urdu"],
    "bangladesh": ["bangladesh", "bengali", "bangladeshi", "bd", "bangla"],
    "nepal": ["nepal", "nepali", "nepalese"],
    "sri lanka": ["sri lanka", "sri lankan", "sinhala", "sinhalese"],
    "afghanistan": ["afghanistan", "afghan"],
    "bhutan": ["bhutan", "bhutanese"],
    "maldives": ["maldives", "maldivian"],
    "myanmar": ["myanmar", "burma", "burmese"],
    "philippines": ["philippines", "filipino", "pinoy", "tagalog", "ph", "phi", "pinas"],
    "indonesia": ["indonesia", "indonesian", "indo", "id", "idn", "nusantara", "javanese"],
    "vietnam": ["vietnam", "vietnamese", "vn", "vnm", "kinh"],
    "thailand": ["thailand", "thai", "th", "tha", "siam"],
    "malaysia": ["malaysia", "malaysian", "my", "mas", "malay"],
    "singapore": ["singapore", "singaporean", "sg", "sgp", "lion city"],
    "cambodia": ["cambodia", "cambodian"],
    "laos": ["laos", "laotian", "lao"],
    "brunei": ["brunei", "bruneian"],
    "brazil": ["brazil", "brazilian", "brasil", "brasileiro", "brasileira", "br", "bra"],
    "argentina": ["argentina", "argentinian", "argentine", "argentino", "ar", "arg", "gaucho"],
    "colombia": ["colombia", "colombian", "colombiano", "colombiana", "co", "col", "cafetero"],
    "chile": ["chile", "chilean", "chileno", "cl", "chl"],
    "peru": ["peru", "peruvian", "peruano", "pe", "per", "inca"],
    "venezuela": ["venezuela", "venezuelan", "venezolano", "venezolana", "ve", "ven"],
    "uruguay": ["uruguay", "uruguayan", "uruguayo", "uy", "ury", "charrúa"],
    "ecuador": ["ecuador", "ecuadorian", "ecuatoriano", "ecuatoriana"],
    "bolivia": ["bolivia", "bolivian", "boliviano"],
    "paraguay": ["paraguay", "paraguayan", "paraguayo"],
    "costa rica": ["costa rica", "costa rican", "costarricense", "tico"],
    "panama": ["panama", "panamanian", "panameno"],
    "guatemala": ["guatemala", "guatemalan", "chapin"],
    "honduras": ["honduras", "honduran", "catracho"],
    "el salvador": ["el salvador", "salvadoran", "salvadoreno"],
    "nicaragua": ["nicaragua", "nicaraguan", "nicaraguense"],
    "puerto rico": ["puerto rico", "puerto rican", "boricua", "pr", "pri", "borinquen"],
    "cuba": ["cuba", "cuban", "cubano", "cu", "cub"],
    "dominican republic": ["dominican republic", "dominican", "dominicano", "republica dominicana", "dr", "do", "dom", "quisqueya", "quisqueyano"],
    "haiti": ["haiti", "haitian", "haitiano"],
    "jamaica": ["jamaica", "jamaican", "jm", "jam", "yardie", "yard"],
    "trinidad and tobago": ["trinidad and tobago", "trinidad", "tobago", "trinidadian", "trini"],
    "barbados": ["barbados", "barbadian", "bajan"],
    "bahamas": ["bahamas", "bahamian"],
    "guyana": ["guyana", "guyanese"],
    "suriname": ["suriname", "surinamese"],
    "australia": ["australia", "australian", "aussie", "au", "aus", "oz", "straya", "down under"],
    "new zealand": ["new zealand", "nz", "kiwi", "aotearoa", "zealand", "new zealander"],
    "israel": ["israel", "israeli", "hebrew", "il", "isr", "zion"],
    "palestine": ["palestine", "palestinian"],
    "lebanon": ["lebanon", "lebanese"],
    "syria": ["syria", "syrian"],
    "jordan": ["jordan", "jordanian"],
    "iraq": ["iraq", "iraqi"],
    "saudi arabia": ["saudi arabia", "saudi", "saudi arabian"],
    "united arab emirates": ["united arab emirates", "uae", "emirati"],
    "kuwait": ["kuwait", "kuwaiti"],
    "qatar": ["qatar", "qatari"],
    "bahrain": ["bahrain", "bahraini"],
    "oman": ["oman", "omani"],
    "yemen": ["yemen", "yemeni"],
    "kurdistan": ["kurdistan", "kurdish", "kurd", "kurdi", "kurtce"],
    "egypt": ["egypt", "egyptian", "eg", "egy", "misr"],
    "iran": ["iran", "iranian", "persian", "farsi", "ir", "irn", "iranis", "irani"],
    "morocco": ["morocco", "moroccan", "ma", "mar", "maroc"],
    "algeria": ["algeria", "algerian", "dz", "dza", "algerie"],
    "tunisia": ["tunisia", "tunisian"],
    "libya": ["libya", "libyan"],
    "sudan": ["sudan", "sudanese"],
    "nigeria": ["nigeria", "nigerian", "ng", "nga", "naija", "9ja"],
    "south africa": ["south africa", "south african", "za", "zaf", "rsa", "mzansi"],
    "ghana": ["ghana", "ghanaian", "gh", "gha", "gold coast"],
    "kenya": ["kenya", "kenyan", "ke", "ken", "254", "swahili"],
    "senegal": ["senegal", "senegalese", "sn", "sen", "wolof"],
    "ethiopia": ["ethiopia", "ethiopian"],
    "eritrea": ["eritrea", "eritrean"],
    "somalia": ["somalia", "somali", "somalian"],
    "tanzania": ["tanzania", "tanzanian"],
    "uganda": ["uganda", "ugandan"],
    "rwanda": ["rwanda", "rwandan"],
    "burundi": ["burundi", "burundian"],
    "zimbabwe": ["zimbabwe", "zimbabwean"],
    "zambia": ["zambia", "zambian"],
    "malawi": ["malawi", "malawian"],
    "mozambique": ["mozambique", "mozambican"],
    "angola": ["angola", "angolan", "angolano"],
    "namibia": ["namibia", "namibian"],
    "botswana": ["botswana", "batswana"],
    "madagascar": ["madagascar", "malagasy"],
    "mauritius": ["mauritius", "mauritian"],
    "congo": ["congo", "dr congo", "congolese", "drc"],
    "cameroon": ["cameroon", "cameroonian", "cameroun"],
    "ivory coast": ["ivory coast", "cote d'ivoire", "cote divoire", "ivorian", "ivoirien"],
    "mali": ["mali", "malian"],
    "guinea": ["guinea", "guinean"],
    "benin": ["benin", "beninese"],
    "togo": ["togo", "togolese"],
    "burkina faso": ["burkina faso", "burkinabe"],
    "cape verde": ["cape verde", "cabo verde", "cape verdean"]
  };

  const mainGenres = Object.keys(GENRE_MAPPINGS);

  const VARIANT_TO_MAIN_GENRE_MAP = {};
  const VARIANT_TO_MAIN_COUNTRY_MAP = {};
  function getNormalizedGenreKey(genre) {
    return genre
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[\s-]+/g, '');
  }

  Object.entries(GENRE_MAPPINGS).forEach(([mainGenre, variants]) => {
    const canonicalMainGenre = mainGenre;
    variants.forEach(variant => {
      const normalizedKey = getNormalizedGenreKey(variant);
      if (!VARIANT_TO_MAIN_GENRE_MAP[normalizedKey]) {
        VARIANT_TO_MAIN_GENRE_MAP[normalizedKey] = [];
      }
      if (!VARIANT_TO_MAIN_GENRE_MAP[normalizedKey].includes(canonicalMainGenre)) {
          VARIANT_TO_MAIN_GENRE_MAP[normalizedKey].push(canonicalMainGenre);
      }
    });
    const normalizedMainKey = getNormalizedGenreKey(mainGenre);
    if (!VARIANT_TO_MAIN_GENRE_MAP[normalizedMainKey]) {
        VARIANT_TO_MAIN_GENRE_MAP[normalizedMainKey] = [canonicalMainGenre];
    }
  });

  if (typeof GENRE_ALIASES_RAW !== "undefined") {
    for (const [canonical, aliases] of Object.entries(GENRE_ALIASES_RAW)) {
      const canonicalKey = getNormalizedGenreKey(canonical);
      const targetMains = VARIANT_TO_MAIN_GENRE_MAP[canonicalKey] || (GENRE_MAPPINGS[canonical] ? [canonical] : null);
      if (targetMains && targetMains.length > 0) {
        aliases.forEach(alias => {
          const aliasKey = getNormalizedGenreKey(alias);
          if (!VARIANT_TO_MAIN_GENRE_MAP[aliasKey]) {
            VARIANT_TO_MAIN_GENRE_MAP[aliasKey] = [];
          }
          targetMains.forEach(mainGenre => {
            if (!VARIANT_TO_MAIN_GENRE_MAP[aliasKey].includes(mainGenre)) {
              VARIANT_TO_MAIN_GENRE_MAP[aliasKey].push(mainGenre);
            }
          });
        });
      }
    }
  }
  
  Object.entries(COUNTRY_MAPPINGS).forEach(([mainCountry, variants]) => {
    variants.forEach(variant => {
      const normalizedKey = getNormalizedGenreKey(variant);
      if (!VARIANT_TO_MAIN_COUNTRY_MAP[normalizedKey]) {
        VARIANT_TO_MAIN_COUNTRY_MAP[normalizedKey] = mainCountry;
      }
    });
    const normalizedMainKey = getNormalizedGenreKey(mainCountry);
    if (!VARIANT_TO_MAIN_COUNTRY_MAP[normalizedMainKey]) {
        VARIANT_TO_MAIN_COUNTRY_MAP[normalizedMainKey] = mainCountry;
    }
  });

  const BLACKLIST_UMBRELLA_MAP = {
    "afrobeats": ["afropop","amapiano","afro house","afro r&b","afro-funk","afrobeat","alte","bongo flava","gengetone","highlife","juju","fuji","coupe-decale","makossa","gqom","kwaito","singeli","kizomba","semba","soukous","ndombolo","asakaa","hiplife","zouglou"],
    "alternative": ["alternative rock","indie rock","alternative pop","alternative r&b","alternative hip hop","alternative metal","alternative country","grunge","post-grunge","britpop","shoegaze","dream pop","emo","post-punk","new wave","indie pop"],
    "alternative rock": ["indie rock","grunge","post-grunge","britpop","shoegaze","dream pop","math rock","post-rock","midwest emo","noise rock","jangle pop","chamber pop","lo-fi rock","college rock","slacker rock","madchester","baggy"],
    "amapiano": ["private school amapiano","bacardi","barcadi","deep amapiano","underground amapiano","gospel amapiano","sgija"],
    "ambient": ["dark ambient","space ambient","ambient techno","drone","chillout","lowercase","new age","illbient","warm drone","sleep","psybient"],
    "black metal": ["atmospheric black metal","depressive suicidal black metal","symphonic black metal","blackgaze","pagan black metal","viking metal","war metal","melodic black metal","norwegian black metal","raw black metal","post-black metal","black 'n' roll","black thrash","nsbm","dungeon synth"],
    "blues": ["delta blues","chicago blues","texas blues","electric blues","acoustic blues","country blues","blues rock","soul blues","jump blues","boogie-woogie","piedmont blues","swamp blues","hill country blues","harmonica blues","classic blues","memphis blues","new orleans blues","piano blues"],
    "bossa nova": ["samba-jazz","mpb"],
    "brazilian funk": ["funk carioca","baile funk","brazilian funk","funk brasileiro","brega funk","funk 150 bpm","funk mandelao","funk mtg","mtg funk","funk ostentacao","funk paulista","funk viral","mega funk","rave funk","funk rj","funk bh","funk consciente","funk das antigas","funk melody","funk evangelico","funk capixaba","trap funk","cumbia funk","chill baile","deep funk ostentacao","funk bruxaria","funk automotivo","eletrofunk","arrocha funk","deboxe"],
    "c-pop": ["chinese pop","mandopop","cantopop","chinese indie","hokkien pop","taiwan pop","hk-pop","singaporean mandopop","chinese hip hop","chinese rock","zhongguo feng"],
    "christian": ["christian pop","christian rock","christian metal","christian hip hop","worship","gospel","global christian"],
    "classic rock": ["hard rock","album rock","blues rock","psychedelic rock","glam rock","southern rock","arena rock","yacht rock","soft rock","rock and roll","rockabilly","surf rock","prog rock","art rock","heartland rock","british invasion","merseybeat","jam band"],
    "classical": ["orchestra","orchestral","early music","medieval","renaissance","baroque","classical period","romantic classical","modern classical","contemporary classical","neoclassical","minimalism","post-minimalism","avant-garde classical","opera","choral","symphony","chamber music","string quartet","piano"],
    "cloud rap": ["plugg","pluggnb","rage rap","vapor rap","sad rap","emoplugg","dark plugg","dream plugg"],
    "country": ["classic country","outlaw country","bakersfield sound","nashville sound","country rock","alt-country","americana","bluegrass","progressive bluegrass","traditional country","contemporary country","country pop","bro-country","red dirt","texas country","oklahoma country","western swing","honky-tonk","rockabilly","cowboy western","canadian country","australian country"],
    "cumbia": ["cumbia sonidera","cumbia villera","cumbia pop","cumbia colombiana","chicha","cumbia santafesina","electro cumbia","cumbia 420","tecnocumbia","porro","champeta"],
    "dance": ["dance pop","pop dance","edm","house","eurodance","disco","nu disco","italo dance","club","tech house","deep house","electro house","tropical house","slap house","uk garage","afro house","amapiano","bass house","progressive house"],
    "dancehall": ["ragga","dancehall queen","soca","bouyon","shatta","trinibad","zimdancehall"],
    "death metal": ["melodic death metal","technical death metal","brutal death metal","slam death metal","swedish death metal","florida death metal","deathcore","death-doom","blackened death metal","goregrind","progressive death metal","symphonic death metal","death 'n' roll","deathrash"],
    "deathcore": ["blackened deathcore","slam deathcore","slamming deathcore","technical deathcore","beatdown","symphonic deathcore","progressive deathcore","melodic deathcore","brutal deathcore","downtempo deathcore"],
    "deep house": ["lo-fi house","soulful house","deep groove house","deep tropical house","south african deep house","float house","deep soul house","outsider house","chill house","melodic house","organic house","jazz house"],
    "disco": ["nu disco","italo disco","euro disco","post-disco","space disco","cosmic disco","hi-nrg","boogie","mutant disco","dark disco"],
    "doom metal": ["stoner metal","sludge metal","funeral doom","drone metal","epic doom","death-doom","traditional doom metal","atmospheric doom","progressive doom","gothic doom"],
    "drill": ["uk drill","chicago drill","brooklyn drill","bronx drill","sample drill","sexy drill","new york drill","drill francais","drill brasileiro","drill italiana","australian drill","canadian drill","irish drill","dutch drill","swedish drill","german drill","spanish drill","polish drill","russian drill","greek drill","turkce drill","ghanaian drill","afro drill"],
    "drum and bass": ["jungle","liquid funk","neurofunk","jump up","ragga jungle","darkstep","sambass","breakcore","drumfunk","atmospheric dnb","halftime","halftime dnb","techstep","dancefloor dnb","minimal dnb","deep dnb"],
    "dubstep": ["brostep","riddim","riddim dubstep","melodic dubstep","deathstep","tearout","chillstep","post-dubstep","color bass","briddim","deep dubstep","filthstep","drumstep"],
    "edm": ["electro house","progressive house","future house","bass house","slap house","tropical house","tech house","deep house","house","trance","psytrance","dubstep","future bass","hardstyle","drum and bass","eurodance","big room","melbourne bounce","electronic"],
    "electro house": ["progressive electro house","dutch house","fidget house","bouncy house","speed house","complextro","big room","melbourne bounce","future bounce","future house","slap house"],
    "electronic": ["edm","house","techno","trance","psytrance","dubstep","drum and bass","jungle","uk garage","bass music","bass house","deep house","tech house","progressive house","electro house","tropical house","afro house","breakbeat","breakcore","hardstyle","happy hardcore","hardcore techno","gabber","ambient","dark ambient","idm","downtempo","trip hop","synthwave","vaporwave","chillwave","electro","electropop","synthpop","future bass","chiptune","glitch","eurodance","eurobeat","ebm","industrial","deconstructed club","club","hyperpop","disco","nu disco","krushclub","nightcore","moombahton","electro swing","french house"],
    "emo": ["screamo","midwest emo","emo pop","emoviolence","post-hardcore","emo rap","5th wave emo","diy emo","orgcore"],
    "eurodance": ["euro-techno","bubblegum dance","hands up","italo dance","vocal trance","jumpstyle","hi-nrg","eurobeat"],
    "experimental": ["noise","harsh noise","drone","sound art","musique concrete","field recording","lowercase","dark ambient","glitch","deconstructed club","avant-garde","plunderphonics","free improvisation","microtonal","hauntology"],
    "folk": ["contemporary folk","traditional folk","indie folk","folk rock","freak folk","anti-folk","neofolk","celtic","celtic folk","irish folk","scottish folk","american folk revival","singer-songwriter","appalachian folk","sea shanties","bluegrass","folk punk","americana","klezmer","fado","balkan","turkish folk","persian traditional","polka","flamenco","zydeco"],
    "funk": ["p-funk","g-funk","funk rock","jazz funk","boogie","synth funk","deep funk","new orleans funk","brit funk","latin funk","afro-funk","afrobeat","modern funk","traditional funk","minneapolis sound","go-go","rare groove"],
    "funk carioca": ["baile funk","brazilian funk","funk brasileiro","brega funk","funk 150 bpm","funk mandelao","funk mtg","mtg funk","funk ostentacao","funk paulista","funk viral","mega funk","rave funk","funk rj","funk bh","funk consciente","funk das antigas","funk melody","funk evangelico","funk capixaba","trap funk","cumbia funk","chill baile","deep funk ostentacao","funk bruxaria","funk automotivo","eletrofunk","arrocha funk","deboxe"],
    "garage rock": ["garage punk","proto-punk","freakbeat","garage rock revival","pub rock","mod revival","rautalanka"],
    "gospel": ["christian pop","worship","global christian","christian hip hop"],
    "grindcore": ["goregrind","pornogrind","electrogrind","deathgrind","cybergrind","mathgrind","mincecore","noisecore","gorenoise","powerviolence"],
    "hard rock": ["glam metal","arena rock","sleaze rock","pub rock","shock rock","nwocr","melodic hard rock"],
    "hardcore punk": ["crust punk","d-beat","melodic hardcore","youth crew","beatdown hardcore","powerviolence","metallic hardcore","street punk","oi","skate punk","thrashcore","fastcore","chain punk","egg punk"],
    "hardstyle": ["rawstyle","xtra raw","euphoric hardstyle","frenchcore","gabber","nu gabber","happy hardcore","hardcore techno","speedcore","extratone","terrorcore","makina","jumpstyle","uptempo hardcore","mainstream hardcore","industrial hardcore","hardtek","lento violento","hardbass"],
    "heavy metal": ["nwobhm","nwothm","traditional metal","speed metal","us power metal","glam metal","power metal","doom metal","thrash metal"],
    "hip hop": ["rap","trap","drill","uk drill","sexy drill","boom bap","gangster rap","conscious hip hop","cloud rap","phonk","drift phonk","crunk","grime","pop rap","hardcore hip hop","jazz rap","old school hip hop","alternative hip hop","east coast hip hop","west coast hip hop","southern hip hop","memphis rap","uk hip hop","canadian hip hop","australian hip hop","french hip hop","german hip hop","dutch hip hop","spanish hip hop","italian hip hop","polish hip hop","russian hip hop","scandinavian hip hop","turkish hip hop","arabic hip hop","persian hip hop","desi hip hop","punjabi hip hop","latin hip hop","latin trap","brazilian hip hop","moroccan rap","j-rap","k-rap","c-rap","pinoy hip hop","vietnamese hip hop","thai hip hop","indonesian hip hop","christian hip hop","horrorcore","chopped and screwed","turntablism","plugg","pluggnb","rage rap","jerk rap","new jazz","sigilkore","trap metal","rap rock","emo rap","lofi","lo-fi hip hop","nerdcore","miami bass","hyphy","g-funk"],
    "house": ["deep house","tech house","electro house","progressive house","bass house","afro house","tropical house","future house","slap house","acid house","disco house","chicago house","microhouse","lo-fi house","hard house","witch house","g-house","tribal house","funky house","garage house","french house","italo house","soulful house","fidget house","speed house","jackin house","piano house","vocal house","organic house","chill house","melodic house","big room","melbourne bounce","amapiano","gqom","kwaito","stutter house","3-step","deep amapiano","hip house","diva house"],
    "hyperpop": ["glitchcore","digicore","bubblegum bass","deconstructed club","pc music","dariacore","krushclub","scenecore","sigilkore","glitchbreak"],
    "idm": ["glitch","breakcore","glitch hop","microhouse","electronica","deconstructed club","braindance","algorave","skweee","folktronica"],
    "indie": ["indie rock","indie pop","indie folk","indie r&b","indietronica","bedroom pop","dream pop","shoegaze","lo-fi indie","jangle pop","twee pop","chamber pop","math rock","midwest emo","post-punk revival","slowcore","freak folk","slacker rock","j-indie","k-indie","australian indie","indonesian indie","thai indie","icelandic indie","canadian indie","uk alternative pop","itpop"],
    "indie pop": ["dream pop","twee pop","chamber pop","bedroom pop","jangle pop","lo-fi pop","sophisti-pop","shimmer pop","indie surf","c86"],
    "indie rock": ["indie pop","bedroom pop","jangle pop","lo-fi indie","post-punk revival","garage rock revival","slowcore","sadcore","slacker rock","math rock","noise pop","shoegaze","crank wave","windmill scene"],
    "industrial": ["ebm","aggrotech","electro-industrial","dark electro","industrial metal","industrial rock","martial industrial","power noise","neue deutsche harte","industrial techno","industrial hardcore","industrial hip hop","ambient industrial"],
    "j-pop": ["japanese pop","city pop","shibuya-kei","anime","anison","j-indie","enka","kayokyoku","vocaloid","utaite","vtuber","denpa-kei","idol kayo","j-r&b"],
    "jazz": ["bebop","hard bop","cool jazz","modal jazz","free jazz","avant-garde jazz","jazz fusion","latin jazz","afro-cuban jazz","bossa nova","smooth jazz","vocal jazz","gypsy jazz","swing","big band","dixieland","new orleans jazz","nu jazz","acid jazz","contemporary jazz","jazz rap","jazz funk","ethio-jazz","trad jazz","spiritual jazz","ecm-style jazz","dark jazz","stride","ragtime","jazz pop","jazz piano","modern jazz piano","jazz trio","modern jazz trio","jazz quartet","jazz saxophone","jazz trumpet","jazz trombone","jazz clarinet","jazz flute","jazz violin","jazz guitar","jazz guitar trio","jazz double bass","jazz organ","hammond organ","jazz vibraphone","jazz harp","jazz accordion","jazz drums","jazz brass","modern big band","modern free jazz","deep free jazz","dinner jazz","jazz cover","indie jazz","experimental jazz","british jazz","uk contemporary jazz","scottish jazz","irish modern jazz","french jazz","german jazz","austrian jazz","swiss jazz","italian jazz","italian contemporary jazz","spanish jazz","portuguese jazz","dutch jazz","belgian jazz","belgian modern jazz","norwegian jazz","norwegian contemporary jazz","swedish jazz","danish jazz","danish modern jazz","finnish jazz","finnish modern jazz","icelandic jazz","polish jazz","polish modern jazz","polish free jazz","czech jazz","russian jazz","russian modern jazz","greek jazz","turkish jazz","turkish modern jazz","israeli jazz","indian jazz","japanese jazz","classic japanese jazz","korean jazz","chinese jazz","australian jazz","nz jazz","canadian modern jazz","south african jazz","south african modern jazz","brazilian jazz","brazilian modern jazz","argentine jazz","jazz mexicano","jazz chileno","jazz colombiano","jazzworship","jazz worship"],
    "k-pop": ["korean pop","korean r&b","k-ballad","k-indie","trot","k-rap","k-rock","korean ost"],
    "latin": ["urbano latino","reggaeton","latin trap","trap latino","bachata","salsa","cumbia","tango","merengue","bolero","vallenato","dembow","latin pop","rock en espanol","latin rock","latin hip hop","latin jazz","regional mexican","musica mexicana","corridos","corridos tumbados","corridos belicos","norteno","banda","ranchera","mariachi","sierreno","sierreno urbano","tejano","samba","pagode","bossa nova","forro","piseiro","sertanejo","mpb","axé","funk carioca","baile funk","latin alternative","trova","nueva trova","huayno","joropo","champeta"],
    "latin pop": ["pop en espanol","tropipop","latin ballad","balada","latin arena pop","latin viral pop","cancion melodica","romantico"],
    "lo-fi": ["lofi","lo-fi beats","lo-fi hip hop","chillhop","lo-fi house","lo-fi indie","lo-fi emo","ambient lo-fi","christian lo-fi","late night lo-fi","indonesian lo-fi pop","brazilian lo-fi rock","lo-fi dnb"],
    "metal": ["heavy metal","death metal","black metal","thrash metal","power metal","doom metal","speed metal","groove metal","sludge metal","metalcore","deathcore","grindcore","mathcore","djent","nu metal","alternative metal","industrial metal","symphonic metal","gothic metal","folk metal","viking metal","post-metal","progressive metal","drone metal","stoner metal","glam metal","kawaii metal","neoclassical metal","pagan metal","blackgaze","slam death metal","melodic death metal","technical death metal","goregrind","pornogrind","thall","crust punk","trap metal","rap metal","j-metal","brazilian metal","christian metal","balkan folk metal"],
    "metalcore": ["melodic metalcore","mathcore","deathcore","progressive metalcore","electronicore","post-metalcore","easycore","nu-metalcore","trancecore","metallic hardcore"],
    "musica mexicana": ["regional mexican","corridos","corridos tumbados","corridos belicos","norteno","banda","sierreno","sierreno urbano","sad sierreno","ranchera","mariachi","tejano","tex-mex","grupera","duranguense","tierra caliente","huapango","son jarocho","son huasteco","bolero mexicano"],
    "nu metal": ["rap metal","alternative metal","post-grunge","rap rock","nu-metalcore"],
    "phonk": ["drift phonk","phonk brasileiro","wave phonk","raw phonk","montagem phonk","funk phonk","house phonk","gym phonk","memphis phonk","ukrainian phonk","russian phonk"],
    "pop": ["dance pop","pop dance","electropop","synthpop","synth pop","teen pop","post-teen pop","bubblegum pop","adult contemporary","indie pop","art pop","dream pop","k-pop","j-pop","c-pop","mandopop","cantopop","opm","p-pop","v-pop","vietnamese pop","t-pop","thai pop","indonesian pop","bollywood pop","punjabi pop","latin pop","pop nacional","french pop","german pop","italian pop","itpop","dutch pop","scandinavian pop","swedish pop","russian pop","turkish pop","arabic pop","persian pop","city pop","bedroom pop","hyperpop","europop","eurodance","power pop","baroque pop","chamber pop","sunshine pop","sophisti-pop","schlager","disco polo","christian pop","pop rock","pop rap","pop punk","pop r&b"],
    "pop punk": ["easycore","neon pop punk","skate punk","midwest emo","emo pop","power-pop punk","ramonescore"],
    "post-hardcore": ["screamo","easycore","swancore","mathcore","melodic hardcore","emo","emoviolence","sasscore"],
    "post-punk": ["gothic rock","dark wave","coldwave","deathrock","no wave","post-punk revival","sovietwave","minimal wave","grave wave","crank wave","dance-punk"],
    "post-rock": ["math rock","instrumental rock","cinematic post-rock","ambient post-rock","post-metal","shoegaze"],
    "power metal": ["symphonic power metal","neoclassical metal","euro-power metal","us power metal","progressive power metal","speed metal","heavy metal"],
    "progressive house": ["classic progressive house","dark progressive house","deep progressive house","japanese progressive house","melodic house","melodic techno","minimal melodic techno"],
    "progressive metal": ["djent","thall","progressive metalcore","math metal","technical metal","progressive death metal","progressive black metal","progressive power metal","progressive groove metal","progressive sludge","progressive doom"],
    "progressive rock": ["prog rock","krautrock","canterbury scene","symphonic prog","symphonic rock","neo-prog","neo-progressive","space rock","art rock","avant-prog","zeuhl","rock progressivo italiano","math rock","post-rock"],
    "psychedelic": ["psychedelic rock","psychedelic pop","psychedelic folk","psychedelic soul","psychedelic trance","psytrance","psych rock","neo-psychedelia","acid rock","space rock","desert rock","heavy psych","psybient","dream pop","shoegaze"],
    "psychedelic rock": ["psych rock","acid rock","space rock","neo-psychedelia","krautrock","desert rock","stoner rock","psychedelic pop","psychedelic folk","heavy psych","palm desert scene","zamrock","freakbeat"],
    "psytrance": ["goa trance","progressive psytrance","dark psytrance","full-on","forest psy","hi-tech","goa","twilight psy","zenonesque","suomisaundi","nitzhonot","psybient","psydub","psybass"],
    "punk": ["hardcore punk","post-punk","pop punk","skate punk","crust punk","d-beat","street punk","oi","riot grrrl","anarcho-punk","melodic hardcore","emo","screamo","post-hardcore","gothic rock","deathrock","no wave","skacore","ska punk","queercore","garage punk","horror punk","folk punk","celtic punk","gypsy punk","cowpunk","surf punk","synth punk","art punk","noise punk","egg punk","chain punk","proto-punk","psychobilly"],
    "r&b": ["contemporary r&b","quiet storm","new jack swing","neo soul","alternative r&b","indie r&b","bedroom r&b","chill r&b","dark r&b","pop r&b","urban contemporary","trap soul","afro r&b","korean r&b","j-r&b","uk r&b","french r&b","soul","funk","motown","doo-wop"],
    "rap": ["hip hop","trap","drill","uk drill","sexy drill","boom bap","gangster rap","conscious hip hop","cloud rap","phonk","drift phonk","crunk","grime","pop rap","hardcore hip hop","jazz rap","old school hip hop","alternative hip hop","east coast hip hop","west coast hip hop","southern hip hop","memphis rap","uk hip hop","canadian hip hop","australian hip hop","french hip hop","german hip hop","dutch hip hop","spanish hip hop","italian hip hop","polish hip hop","russian hip hop","scandinavian hip hop","turkish hip hop","arabic hip hop","persian hip hop","desi hip hop","punjabi hip hop","latin hip hop","latin trap","brazilian hip hop","moroccan rap","j-rap","k-rap","pinoy hip hop","vietnamese hip hop","thai hip hop","indonesian hip hop","christian hip hop","plugg","pluggnb","rage rap","jerk rap","new jazz","sigilkore","trap metal","rap rock","emo rap","horrorcore","nerdcore","chopped and screwed","turntablism","miami bass","hyphy","g-funk"],
    "reggae": ["roots reggae","dub","dancehall","lovers rock","ragga","rocksteady","ska","ska punk","reggae rock","reggae fusion","calypso","soca","mento","nyahbinghi","seggae","sega","maloya","kaneka","zimdancehall","dub poetry"],
    "reggaeton": ["dembow","perreo","neoperreo","latin trap","urbano latino","cubaton","reparto","salsaton","cumbiaton","cumbia 420","rkt","turreo","malianteo","bellakeo","moombahton"],
    "regional mexican": ["corridos","corridos tumbados","corridos belicos","norteno","banda","sierreno","sierreno urbano","sad sierreno","ranchera","mariachi","tejano","tex-mex","grupera","duranguense","tierra caliente","huapango","son jarocho","son huasteco"],
    "rock": ["classic rock","hard rock","alternative rock","indie rock","punk","punk rock","pop punk","post-punk","post-hardcore","emo","screamo","psychedelic rock","progressive rock","garage rock","grunge","post-grunge","glam rock","southern rock","heartland rock","yacht rock","soft rock","aor","folk rock","country rock","americana","blues rock","pop rock","power pop","art rock","post-rock","math rock","noise rock","shoegaze","slowcore","space rock","stoner rock","desert rock","krautrock","rock and roll","rockabilly","psychobilly","surf rock","funk rock","rap rock","gothic rock","dark wave","industrial rock","christian rock","rock en espanol","argentine rock","chilean rock","mexican rock","brazilian rock","german rock","russian rock","turkish rock","anatolian rock","persian rock","pinoy rock","j-rock","visual kei","k-rock","australian rock"],
    "salsa": ["salsa dura","salsa romantica","salsa brava","timba","boogaloo","mambo","son cubano","son montuno","guaguanco","cuban rumba","cha-cha-cha","danzon","charanga","descarga","latin jazz"],
    "samba": ["pagode","samba de roda","samba-enredo","partido alto","bossa nova","pagodao","pagode baiano","samba-rock","samba-jazz","samba-cancao","choro","chorinho","marchinha","batucada"],
    "shoegaze": ["dream pop","nu gaze","slowcore","ambient pop","space rock","blackgaze","doomgaze","grungegaze","dreamgaze","psych gaze"],
    "ska": ["two-tone","third wave ska","3rd wave ska","ska punk","skacore","traditional ska","rocksteady","ska jazz","bluebeat","crack rock steady"],
    "soul": ["motown","southern soul","northern soul","memphis soul","chicago soul","blue-eyed soul","psychedelic soul","deep soul","philly soul","new orleans soul","neo soul","retro soul","souldies","british soul","brazilian soul","soul jazz","soul blues","gospel","doo-wop","r&b"],
    "soundtrack": ["score","film score","epic","epiccore","trailer music","vgm","video game music","anime score","anime ost","orchestral soundtrack","ambient score","chiptune","show tunes","library music","tv themes"],
    "synthpop": ["electropop","futurepop","new wave","synthwave","electroclash","indie pop","minimal synth","minimal wave","dark wave","italo disco"],
    "synthwave": ["retrowave","darksynth","outrun","vaporwave","future funk","chillwave","synthpop","cyberpunk","spacesynth","chillsynth","spacewave","dreamwave"],
    "tech house": ["minimal tech house","uk tech house","french tech house","deep tech house","italian tech house","funky tech house","latin tech house","german tech house","brazilian tech house","mexican tech house","bass house","g-house","jackin house","tribal house"],
    "techno": ["minimal techno","acid techno","hard techno","industrial techno","detroit techno","dub techno","dark techno","berlin minimal techno","schranz","peak time techno","deep techno","ambient techno","melodic techno","minimal melodic techno","rominimal","hardgroove","raw techno","hypnotic techno","modular techno","bleep techno","acidcore","hardtek"],
    "thrash metal": ["crossover thrash","groove metal","bay area thrash","teutonic thrash","speed metal","black thrash","deathrash","technical thrash","progressive thrash"],
    "trance": ["psytrance","goa trance","progressive trance","uplifting trance","vocal trance","hard trance","tech trance","euro trance","eurotrance","dream trance","melodic trance","acid trance","balearic trance","bubble trance","hypertrance"],
    "trap": ["latin trap","trap latino","trap argentino","dark trap","trap brasileiro","trap soul","emo trap","emo rap","plugg","pluggnb","dark plugg","dream plugg","emoplugg","tread","phonk","drift phonk","drill","uk drill","sexy drill","jerk rap","new jazz","sigilkore","krushclub","rage rap","cloud rap","trap metal","detroit trap","atl trap","southern trap","hybrid trap","electronic trap","wave","hardwave","vaportrap"],
    "uk garage": ["2-step","speed garage","bassline","future garage","grime","uk funky","sublow","breakstep","dubstep"],
    "worship": ["christian pop","christian rock","gospel","global christian"]
  };
  
  let isCountryOnly_Set = null;
  function isCountryOnly(tag) {
      if (!tag) return false;
      const lowerTag = tag.toLowerCase().trim();

      if (!isCountryOnly_Set) {
          isCountryOnly_Set = new Set();
          Object.keys(COUNTRY_MAPPINGS).forEach(c => isCountryOnly_Set.add(c.toLowerCase().trim()));
          Object.values(COUNTRY_MAPPINGS).forEach(variants => {
              variants.forEach(v => isCountryOnly_Set.add(v.toLowerCase().trim()));
          });
      }
      
      return isCountryOnly_Set.has(lowerTag);
  }

  let isWhitelistedGenre_MappedSet = null;
  function isWhitelistedGenre(tag, genreMap) {
      if (!tag) return false;
      const normalizedTag = normalizeGenre(tag);
      
      if (!isWhitelistedGenre_MappedSet) {
          isWhitelistedGenre_MappedSet = new Set();
          Object.keys(GENRE_MAPPINGS).forEach(g => isWhitelistedGenre_MappedSet.add(normalizeGenre(g)));
          Object.values(GENRE_MAPPINGS).forEach(variants => {
              variants.forEach(v => isWhitelistedGenre_MappedSet.add(normalizeGenre(v)));
          });
          if (typeof GENRE_ALIASES_RAW !== "undefined") {
              Object.keys(GENRE_ALIASES_RAW).forEach(g => isWhitelistedGenre_MappedSet.add(normalizeGenre(g)));
              Object.values(GENRE_ALIASES_RAW).forEach(aliases => {
                  aliases.forEach(a => isWhitelistedGenre_MappedSet.add(normalizeGenre(a)));
              });
          }
          if (typeof BLACKLIST_UMBRELLA_MAP !== "undefined" && BLACKLIST_UMBRELLA_MAP) {
              Object.keys(BLACKLIST_UMBRELLA_MAP).forEach(g => isWhitelistedGenre_MappedSet.add(normalizeGenre(g)));
              Object.values(BLACKLIST_UMBRELLA_MAP).forEach(subgenres => {
                  subgenres.forEach(s => isWhitelistedGenre_MappedSet.add(normalizeGenre(s)));
              });
          }
      }
      
      const isMapped = isWhitelistedGenre_MappedSet.has(normalizedTag);
      
      let isInJson = false;
      if (genreMap) {
          if (!genreMap._normalizedSet) {
              genreMap._normalizedSet = new Set(genreMap.map(p => normalizeGenre(p.genre)));
          }
          isInJson = genreMap._normalizedSet.has(normalizedTag);
      }
      
      return isMapped || isInJson;
  }


  const GENRE_FILTER_ALLOWED_MOOD_GENRES = new Set(["club", "epic"]);
  let canonicalSubgenreMap = null;
  const genrePlaylistsCache = [{"genre":"pop"},{"genre":"rap"},{"genre":"rock"},{"genre":"urbano latino"},{"genre":"hip hop"},{"genre":"trap latino"},{"genre":"reggaeton"},{"genre":"dance pop"},{"genre":"pop rap"},{"genre":"modern rock"},{"genre":"pov: indie"},{"genre":"musica mexicana"},{"genre":"latin pop"},{"genre":"classic rock"},{"genre":"filmi"},{"genre":"permanent wave"},{"genre":"trap"},{"genre":"alternative metal"},{"genre":"k-pop"},{"genre":"r&b"},{"genre":"corrido"},{"genre":"canadian pop"},{"genre":"norteno"},{"genre":"sierreno"},{"genre":"album rock"},{"genre":"soft rock"},{"genre":"pop dance"},{"genre":"sad sierreno"},{"genre":"edm"},{"genre":"hard rock"},{"genre":"contemporary country"},{"genre":"mellow gold"},{"genre":"uk pop"},{"genre":"melodic rap"},{"genre":"modern bollywood"},{"genre":"alternative rock"},{"genre":"banda"},{"genre":"post-grunge"},{"genre":"corridos tumbados"},{"genre":"sertanejo universitario"},{"genre":"nu metal"},{"genre":"country"},{"genre":"art pop"},{"genre":"atl hip hop"},{"genre":"urban contemporary"},{"genre":"sertanejo"},{"genre":"southern hip hop"},{"genre":"singer-songwriter"},{"genre":"reggaeton colombiano"},{"genre":"arrocha"},{"genre":"french hip hop"},{"genre":"colombian pop"},{"genre":"alt z"},{"genre":"country road"},{"genre":"mexican pop"},{"genre":"canadian hip hop"},{"genre":"j-pop"},{"genre":"indonesian pop"},{"genre":"singer-songwriter pop"},{"genre":"ranchera"},{"genre":"new wave pop"},{"genre":"indietronica"},{"genre":"german hip hop"},{"genre":"pop urbaine"},{"genre":"rock en espanol"},{"genre":"latin alternative"},{"genre":"gangster rap"},{"genre":"soul"},{"genre":"k-pop boy group"},{"genre":"latin arena pop"},{"genre":"chicago rap"},{"genre":"italian pop"},{"genre":"heartland rock"},{"genre":"k-pop girl group"},{"genre":"agronejo"},{"genre":"modern country pop"},{"genre":"electro house"},{"genre":"latin hip hop"},{"genre":"canadian contemporary r&b"},{"genre":"pop punk"},{"genre":"neo mellow"},{"genre":"pop rock"},{"genre":"latin rock"},{"genre":"punjabi pop"},{"genre":"rap metal"},{"genre":"trap argentino"},{"genre":"new romantic"},{"genre":"new wave"},{"genre":"uk dance"},{"genre":"slap house"},{"genre":"modern alternative rock"},{"genre":"indie pop"},{"genre":"indie rock"},{"genre":"house"},{"genre":"conscious hip hop"},{"genre":"modern country rock"},{"genre":"east coast hip hop"},{"genre":"folk rock"},{"genre":"metal"},{"genre":"turkish pop"},{"genre":"bedroom pop"},{"genre":"desi pop"},{"genre":"italian hip hop"},{"genre":"hoerspiel"},{"genre":"afrobeats"},{"genre":"adult standards"},{"genre":"post-teen pop"},{"genre":"neo soul"},{"genre":"sped up"},{"genre":"cloud rap"},{"genre":"viral pop"},{"genre":"talent show"},{"genre":"spanish pop"},{"genre":"punk"},{"genre":"alternative r&b"},{"genre":"grupera"},{"genre":"west coast rap"},{"genre":"opm"},{"genre":"boy band"},{"genre":"psychedelic rock"},{"genre":"glam metal"},{"genre":"stomp and holler"},{"genre":"desi hip hop"},{"genre":"ccm"},{"genre":"rage rap"},{"genre":"hip pop"},{"genre":"puerto rican pop"},{"genre":"german pop"},{"genre":"miami hip hop"},{"genre":"argentine rock"},{"genre":"sertanejo pop"},{"genre":"tropical"},{"genre":"glam rock"},{"genre":"funk carioca"},{"genre":"nigerian pop"},{"genre":"argentine hip hop"},{"genre":"dark trap"},{"genre":"latin viral pop"},{"genre":"piano rock"},{"genre":"detroit hip hop"},{"genre":"italian adult pop"},{"genre":"country rock"},{"genre":"underground hip hop"},{"genre":"mexican hip hop"},{"genre":"progressive electro house"},{"genre":"synthpop"},{"genre":"metropopolis"},{"genre":"garage rock"},{"genre":"indie folk"},{"genre":"vocal jazz"},{"genre":"classical"},{"genre":"europop"},{"genre":"progressive house"},{"genre":"art rock"},{"genre":"yacht rock"},{"genre":"mpb"},{"genre":"pagode"},{"genre":"tropical house"},{"genre":"urbano espanol"},{"genre":"chamber pop"},{"genre":"rap francais"},{"genre":"dance rock"},{"genre":"j-rock"},{"genre":"polish hip hop"},{"genre":"sleep"},{"genre":"folk"},{"genre":"anime"},{"genre":"trap brasileiro"},{"genre":"disco"},{"genre":"pluggnb"},{"genre":"british soul"},{"genre":"metalcore"},{"genre":"australian pop"},{"genre":"uk hip hop"},{"genre":"christian music"},{"genre":"gen z singer-songwriter"},{"genre":"electropop"},{"genre":"big room"},{"genre":"forro"},{"genre":"swedish pop"},{"genre":"classic oklahoma country"},{"genre":"reggaeton flow"},{"genre":"pop nacional"},{"genre":"british invasion"},{"genre":"mexican rock"},{"genre":"indie soul"},{"genre":"contemporary r&b"},{"genre":"folk-pop"},{"genre":"white noise"},{"genre":"pagode novo"},{"genre":"soundtrack"},{"genre":"funk metal"},{"genre":"grunge"},{"genre":"french pop"},{"genre":"emo rap"},{"genre":"salsa"},{"genre":"rain"},{"genre":"r&b francais"},{"genre":"lgbtq+ hip hop"},{"genre":"turkish rock"},{"genre":"memphis hip hop"},{"genre":"mariachi"},{"genre":"brostep"},{"genre":"classic soul"},{"genre":"funk mtg"},{"genre":"trap triste"},{"genre":"dirty south rap"},{"genre":"melodic metalcore"},{"genre":"blues rock"},{"genre":"alternative hip hop"},{"genre":"melancholia"},{"genre":"pop soul"},{"genre":"brazilian gospel"},{"genre":"outlaw country"},{"genre":"orchestral soundtrack"},{"genre":"dutch house"},{"genre":"turkish hip hop"},{"genre":"queens hip hop"},{"genre":"christian alternative rock"},{"genre":"mandopop"},{"genre":"lounge"},{"genre":"worship"},{"genre":"dfw rap"},{"genre":"electronica"},{"genre":"pixel"},{"genre":"trap italiana"},{"genre":"pop reggaeton"},{"genre":"new orleans rap"},{"genre":"otacore"},{"genre":"rock-and-roll"},{"genre":"funk"},{"genre":"quiet storm"},{"genre":"motown"},{"genre":"japanese teen pop"},{"genre":"brazilian hip hop"},{"genre":"gruperas inmortales"},{"genre":"kleine hoerspiel"},{"genre":"indie poptimism"},{"genre":"dream pop"},{"genre":"rap conscient"},{"genre":"neo-synthpop"},{"genre":"funk rock"},{"genre":"easy listening"},{"genre":"bolero"},{"genre":"g funk"},{"genre":"barbadian pop"},{"genre":"progressive rock"},{"genre":"eurodance"},{"genre":"hardcore hip hop"},{"genre":"bachata"},{"genre":"australian dance"},{"genre":"neon pop punk"},{"genre":"emo"},{"genre":"trap boricua"},{"genre":"brazilian rock"},{"genre":"funk paulista"},{"genre":"pop venezolano"},{"genre":"cantautor"},{"genre":"chanson"},{"genre":"drift phonk"},{"genre":"florida rap"},{"genre":"bedroom r&b"},{"genre":"latin christian"},{"genre":"movie tunes"},{"genre":"indonesian pop rock"},{"genre":"russian hip hop"},{"genre":"spanish hip hop"},{"genre":"cali rap"},{"genre":"dancehall"},{"genre":"brooklyn drill"},{"genre":"trap queen"},{"genre":"urbano chileno"},{"genre":"color noise"},{"genre":"children's music"},{"genre":"world worship"},{"genre":"urbano mexicano"},{"genre":"sheffield indie"},{"genre":"classic texas country"},{"genre":"escape room"},{"genre":"modern indie pop"},{"genre":"funk rj"},{"genre":"plugg"},{"genre":"anime rock"},{"genre":"merseybeat"},{"genre":"reggae fusion"},{"genre":"shoegaze"},{"genre":"tamil hip hop"},{"genre":"britpop"},{"genre":"australian rock"},{"genre":"industrial metal"},{"genre":"baroque pop"},{"genre":"brooklyn indie"},{"genre":"pop argentino"},{"genre":"r&b en espanol"},{"genre":"trance"},{"genre":"turkish trap"},{"genre":"thai pop"},{"genre":"lilith"},{"genre":"indian instrumental"},{"genre":"downtempo"},{"genre":"southern rock"},{"genre":"sophisti-pop"},{"genre":"punjabi hip hop"},{"genre":"polish trap"},{"genre":"socal pop punk"},{"genre":"candy pop"},{"genre":"tamil pop"},{"genre":"rockabilly"},{"genre":"girl group"},{"genre":"uk contemporary r&b"},{"genre":"atl trap"},{"genre":"old school thrash"},{"genre":"classic bollywood"},{"genre":"compositional ambient"},{"genre":"gym phonk"},{"genre":"north carolina hip hop"},{"genre":"dark r&b"},{"genre":"country dawn"},{"genre":"symphonic rock"},{"genre":"tennessee hip hop"},{"genre":"instrumental lullaby"},{"genre":"pittsburgh rap"},{"genre":"thrash metal"},{"genre":"afropop"},{"genre":"screamo"},{"genre":"canadian rock"},{"genre":"kindermusik"},{"genre":"melodic drill"},{"genre":"nyc rap"},{"genre":"modern blues rock"},{"genre":"rock nacional brasileiro"},{"genre":"philly rap"},{"genre":"afrofuturism"},{"genre":"healing hz"},{"genre":"cumbia pop"},{"genre":"rap latina"},{"genre":"reggae"},{"genre":"madchester"},{"genre":"spanish pop rock"},{"genre":"k-rap"},{"genre":"dutch hip hop"},{"genre":"trip hop"},{"genre":"la indie"},{"genre":"alternative dance"},{"genre":"v-pop"},{"genre":"rap rock"},{"genre":"funk consciente"},{"genre":"indie anthem-folk"},{"genre":"musica chihuahuense"},{"genre":"chill house"},{"genre":"australian hip hop"},{"genre":"azontobeats"},{"genre":"new americana"},{"genre":"tejano"},{"genre":"korean ost"},{"genre":"nova mpb"},{"genre":"dutch edm"},{"genre":"j-division"},{"genre":"sertanejo tradicional"},{"genre":"acoustic pop"},{"genre":"aesthetic rap"},{"genre":"pop flamenco"},{"genre":"cancion melodica"},{"genre":"sigilkore"},{"genre":"rap conciencia"},{"genre":"neo-psychedelic"},{"genre":"dutch pop"},{"genre":"adoracao"},{"genre":"ska argentino"},{"genre":"irish rock"},{"genre":"classic italian pop"},{"genre":"indie pop rap"},{"genre":"pop r&b"},{"genre":"groove metal"},{"genre":"power metal"},{"genre":"lo-fi study"},{"genre":"classic country pop"},{"genre":"danish pop"},{"genre":"jazz"},{"genre":"industrial rock"},{"genre":"hyperpop"},{"genre":"axe"},{"genre":"phonk brasileiro"},{"genre":"pixie"},{"genre":"bossa nova"},{"genre":"uk post-punk"},{"genre":"lo-fi indie"},{"genre":"cumbia sonidera"},{"genre":"southern soul"},{"genre":"roots reggae"},{"genre":"sad rap"},{"genre":"german techno"},{"genre":"lo-fi beats"},{"genre":"sad lo-fi"},{"genre":"pop emo"},{"genre":"binaural"},{"genre":"german metal"},{"genre":"cumbia villera"},{"genre":"latin worship"},{"genre":"german dance"},{"genre":"drill"},{"genre":"pop edm"},{"genre":"arab pop"},{"genre":"brazilian reggae"},{"genre":"broadway"},{"genre":"roots rock"},{"genre":"samba"},{"genre":"tech house"},{"genre":"filter house"},{"genre":"video game music"},{"genre":"neo-classical"},{"genre":"jazz pop"},{"genre":"show tunes"},{"genre":"rap canario"},{"genre":"mollywood"},{"genre":"sufi"},{"genre":"swedish hip hop"},{"genre":"turkish alt pop"},{"genre":"hollywood"},{"genre":"spanish rock"},{"genre":"nursery"},{"genre":"irish singer-songwriter"},{"genre":"electro latino"},{"genre":"shimmer pop"},{"genre":"lullaby"},{"genre":"korean r&b"},{"genre":"baton rouge rap"},{"genre":"skate punk"},{"genre":"grime"},{"genre":"country pop"},{"genre":"german rock"},{"genre":"nigerian hip hop"},{"genre":"russian pop"},{"genre":"noise pop"},{"genre":"speed metal"},{"genre":"canadian trap"},{"genre":"indonesian indie"},{"genre":"rap marseille"},{"genre":"vallenato"},{"genre":"kentucky hip hop"},{"genre":"ohio hip hop"},{"genre":"la pop"},{"genre":"swedish trap pop"},{"genre":"salsa puertorriquena"},{"genre":"environmental"},{"genre":"musica para ninos"},{"genre":"french indie pop"},{"genre":"hindi hip hop"},{"genre":"tollywood"},{"genre":"ambient pop"},{"genre":"stutter house"},{"genre":"cloud rap francais"},{"genre":"jazz blues"},{"genre":"background piano"},{"genre":"lagu jawa"},{"genre":"florida drill"},{"genre":"cuarteto"},{"genre":"dreamo"},{"genre":"turbo folk"},{"genre":"pinoy hip hop"},{"genre":"czsk hip hop"},{"genre":"rap napoletano"},{"genre":"chicago drill"},{"genre":"japanese singer-songwriter"},{"genre":"oxford indie"},{"genre":"new rave"},{"genre":"french rock"},{"genre":"swedish electropop"},{"genre":"classic j-pop"},{"genre":"polish pop"},{"genre":"drill francais"},{"genre":"new jack swing"},{"genre":"canadian singer-songwriter"},{"genre":"drill espanol"},{"genre":"gym hardstyle"},{"genre":"indonesian singer-songwriter"},{"genre":"dangdut"},{"genre":"swing"},{"genre":"deep house"},{"genre":"new french touch"},{"genre":"industrial"},{"genre":"uk alternative pop"},{"genre":"coverchill"},{"genre":"hare krishna"},{"genre":"complextro"},{"genre":"kollywood"},{"genre":"uk metalcore"},{"genre":"baroque"},{"genre":"el paso indie"},{"genre":"flamenco urbano"},{"genre":"modern indie folk"},{"genre":"country rap"},{"genre":"early music"},{"genre":"glitchcore"},{"genre":"cantopop"},{"genre":"bachata dominicana"},{"genre":"modern folk rock"},{"genre":"egyptian pop"},{"genre":"mexican indie"},{"genre":"bubblegrunge"},{"genre":"beatlesque"},{"genre":"norwegian pop"},{"genre":"meditation"},{"genre":"symphonic metal"},{"genre":"arabesk"},{"genre":"german drill"},{"genre":"deep underground hip hop"},{"genre":"electronic trap"},{"genre":"classic pakistani pop"},{"genre":"electric blues"},{"genre":"weirdcore"},{"genre":"late romantic era"},{"genre":"chill r&b"},{"genre":"meme rap"},{"genre":"viral rap"},{"genre":"japanese vgm"},{"genre":"funk ostentacao"},{"genre":"trap funk"},{"genre":"arrochadeira"},{"genre":"indie r&b"},{"genre":"pop rock brasileiro"},{"genre":"previa"},{"genre":"blues"},{"genre":"covertronica"},{"genre":"pagode baiano"},{"genre":"indie rock italiano"},{"genre":"bhojpuri pop"},{"genre":"neue deutsche harte"},{"genre":"scandipop"},{"genre":"classic canadian rock"},{"genre":"meme"},{"genre":"belgian edm"},{"genre":"indonesian jazz"},{"genre":"contemporary vocal jazz"},{"genre":"nu-cumbia"},{"genre":"rap dominicano"},{"genre":"anime score"},{"genre":"classic swedish pop"},{"genre":"ambient lo-fi"},{"genre":"swamp rock"},{"genre":"vocaloid"},{"genre":"classical era"},{"genre":"pakistani hip hop"},{"genre":"australian psych"},{"genre":"australian indie"},{"genre":"instrumental hip hop"},{"genre":"c-pop"},{"genre":"old school atlanta hip hop"},{"genre":"indonesian rock"},{"genre":"punk blues"},{"genre":"taiwan pop"},{"genre":"power pop"},{"genre":"schlager"},{"genre":"chillhop"},{"genre":"russian trap"},{"genre":"nz pop"},{"genre":"gujarati pop"},{"genre":"memphis soul"},{"genre":"musica popular colombiana"},{"genre":"mambo chileno"},{"genre":"christian rock"},{"genre":"classic indonesian rock"},{"genre":"early romantic era"},{"genre":"edmonton indie"},{"genre":"sacramento indie"},{"genre":"jam band"},{"genre":"drum and bass"},{"genre":"melbourne bounce international"},{"genre":"dutch rap pop"},{"genre":"dangdut koplo"},{"genre":"turkish folk"},{"genre":"golden age hip hop"},{"genre":"javanese dangdut"},{"genre":"post-punk argentina"},{"genre":"alternative emo"},{"genre":"greek trap"},{"genre":"post-punk"},{"genre":"hamburg hip hop"},{"genre":"soul blues"},{"genre":"pop rap brasileiro"},{"genre":"venezuelan hip hop"},{"genre":"j-pixie"},{"genre":"cantautora mexicana"},{"genre":"deep euro house"},{"genre":"pop lgbtq+ brasileira"},{"genre":"bass house"},{"genre":"nouvelle chanson francaise"},{"genre":"crunk"},{"genre":"electro"},{"genre":"operatic pop"},{"genre":"spanish indie pop"},{"genre":"celtic rock"},{"genre":"vietnamese hip hop"},{"genre":"p-pop"},{"genre":"indie hip hop"},{"genre":"stoner rock"},{"genre":"pop house"},{"genre":"bubblegum pop"},{"genre":"argentine indie"},{"genre":"modern bhajan"},{"genre":"new york drill"},{"genre":"red dirt"},{"genre":"irish pop"},{"genre":"danish hip hop"},{"genre":"progressive metal"},{"genre":"canadian metal"},{"genre":"malaysian pop"},{"genre":"countrygaze"},{"genre":"indie garage rock"},{"genre":"etherpop"},{"genre":"ska"},{"genre":"bebop"},{"genre":"funk pop"},{"genre":"chilean rock"},{"genre":"chinese viral pop"},{"genre":"turkce drill"},{"genre":"australian electropop"},{"genre":"musica de fondo"},{"genre":"philly indie"},{"genre":"hip house"},{"genre":"post-romantic era"},{"genre":"swedish gangsta rap"},{"genre":"dancefloor dnb"},{"genre":"comic"},{"genre":"scenecore"},{"genre":"piano cover"},{"genre":"rumba"},{"genre":"electra"},{"genre":"korean pop"},{"genre":"reggae rock"},{"genre":"dance-punk"},{"genre":"chill pop"},{"genre":"german alternative rap"},{"genre":"canadian indie"},{"genre":"preschool children's music"},{"genre":"moombahton"},{"genre":"tagalog rap"},{"genre":"background music"},{"genre":"funk bh"},{"genre":"torch song"},{"genre":"indie surf"},{"genre":"italian underground hip hop"},{"genre":"pop romantico"},{"genre":"dutch rock"},{"genre":"rome indie"},{"genre":"uk drill"},{"genre":"protopunk"},{"genre":"shush"},{"genre":"smooth jazz"},{"genre":"j-poprock"},{"genre":"old school hip hop"},{"genre":"ectofolk"},{"genre":"small room"},{"genre":"turkish singer-songwriter"},{"genre":"indonesian r&b"},{"genre":"kentucky roots"},{"genre":"turkish alternative rock"},{"genre":"bedroom soul"},{"genre":"cartoon"},{"genre":"modern salsa"},{"genre":"writing"},{"genre":"background jazz"},{"genre":"lo-fi jazzhop"},{"genre":"musica infantil"},{"genre":"romanian pop"},{"genre":"gauze pop"},{"genre":"chillwave"},{"genre":"deep ccm"},{"genre":"norteno-sax"},{"genre":"alternative pop rock"},{"genre":"finnish pop"},{"genre":"trova"},{"genre":"desi trap"},{"genre":"dembow"},{"genre":"cumbia"},{"genre":"speedrun"},{"genre":"world"},{"genre":"norwegian indie"},{"genre":"perreo"},{"genre":"reggaeton chileno"},{"genre":"aussietronica"},{"genre":"classic schlager"},{"genre":"melbourne bounce"},{"genre":"rock cristiano"},{"genre":"finnish hip hop"},{"genre":"french indietronica"},{"genre":"experimental pop"},{"genre":"belgian hip hop"},{"genre":"classic opm"},{"genre":"jazz funk"},{"genre":"tecnobanda"},{"genre":"japanese soundtrack"},{"genre":"modern dream pop"},{"genre":"pinoy r&b"},{"genre":"czech hip hop"},{"genre":"indie triste"},{"genre":"south carolina hip hop"},{"genre":"trap mexicano"},{"genre":"albanian hip hop"},{"genre":"boom bap espanol"},{"genre":"chutney"},{"genre":"laiko"},{"genre":"sunshine pop"},{"genre":"birmingham metal"},{"genre":"german soundtrack"},{"genre":"disco house"},{"genre":"fvnky rimex"},{"genre":"acid rock"},{"genre":"instrumental worship"},{"genre":"japanese alternative rock"},{"genre":"scottish rock"},{"genre":"corridos alternativos"},{"genre":"nashville sound"},{"genre":"modern alternative pop"},{"genre":"rap df"},{"genre":"velha guarda"},{"genre":"rap politico"},{"genre":"post-hardcore"},{"genre":"cumbia 420"},{"genre":"british singer-songwriter"},{"genre":"bossa nova cover"},{"genre":"social media pop"},{"genre":"brazilian edm"},{"genre":"scorecore"},{"genre":"redneck"},{"genre":"german baroque"},{"genre":"detroit trap"},{"genre":"texas country"},{"genre":"greek pop"},{"genre":"british soundtrack"},{"genre":"swedish metal"},{"genre":"israeli pop"},{"genre":"slowcore"},{"genre":"gaming edm"},{"genre":"houston rap"},{"genre":"german romanticism"},{"genre":"nu jazz"},{"genre":"panamanian pop"},{"genre":"new jersey rap"},{"genre":"epicore"},{"genre":"r&b brasileiro"},{"genre":"slowed and reverb"},{"genre":"czech pop"},{"genre":"death metal"},{"genre":"arkansas country"},{"genre":"chicano rap"},{"genre":"high vibe"},{"genre":"swedish trap"},{"genre":"political hip hop"},{"genre":"j-rap"},{"genre":"uk funky"},{"genre":"albanian pop"},{"genre":"mexican rock-and-roll"},{"genre":"black americana"},{"genre":"ghazal"},{"genre":"modern southern rock"},{"genre":"indian singer-songwriter"},{"genre":"japanese emo"},{"genre":"indian indie"},{"genre":"indonesian folk"},{"genre":"deboxe"},{"genre":"french synthpop"},{"genre":"russian dance"},{"genre":"gothic metal"},{"genre":"lo-fi cover"},{"genre":"post-disco"},{"genre":"greek hip hop"},{"genre":"rap genovese"},{"genre":"trap chileno"},{"genre":"reggaeton mexicano"},{"genre":"cumbia chilena"},{"genre":"italian indie pop"},{"genre":"kentucky indie"},{"genre":"nyc pop"},{"genre":"uk alternative hip hop"},{"genre":"bronx drill"},{"genre":"italo dance"},{"genre":"salsa colombiana"},{"genre":"euphoric hardstyle"},{"genre":"christian indie"},{"genre":"canadian punk"},{"genre":"polish viral pop"},{"genre":"musica sonorense"},{"genre":"brill building pop"},{"genre":"modern blues"},{"genre":"rawstyle"},{"genre":"afroswing"},{"genre":"oakland hip hop"},{"genre":"hard rock brasileiro"},{"genre":"grupero romantico"},{"genre":"phonk"},{"genre":"modern power pop"},{"genre":"rap calme"},{"genre":"rock urbano mexicano"},{"genre":"british blues"},{"genre":"hardcore punk"},{"genre":"anime lo-fi"},{"genre":"hungarian pop"},{"genre":"russian alt pop"},{"genre":"rap belge"},{"genre":"chicago indie"},{"genre":"lo-fi sleep"},{"genre":"german cloud rap"},{"genre":"cumbia peruana"},{"genre":"indie game soundtrack"},{"genre":"spanish new wave"},{"genre":"stomp and flutter"},{"genre":"bossbeat"},{"genre":"minimal techno"},{"genre":"alternative country"},{"genre":"gothic symphonic metal"},{"genre":"banda jalisciense"},{"genre":"minnesota hip hop"},{"genre":"latin talent show"},{"genre":"frauenrap"},{"genre":"early modern classical"},{"genre":"asmr"},{"genre":"acoustic cover"},{"genre":"afrofuturismo brasileiro"},{"genre":"zolo"},{"genre":"nu disco"},{"genre":"indonesian pop punk"},{"genre":"afro r&b"},{"genre":"hi-nrg"},{"genre":"lo-fi chill"},{"genre":"anadolu rock"},{"genre":"duranguense"},{"genre":"dubstep"},{"genre":"trancecore"},{"genre":"dutch trance"},{"genre":"christian hip hop"},{"genre":"jazz rap"},{"genre":"persian pop"},{"genre":"rock gospel brasileiro"},{"genre":"pop electronico"},{"genre":"finnish dance pop"},{"genre":"supergroup"},{"genre":"deep groove house"},{"genre":"classic hardstyle"},{"genre":"modern hard rock"},{"genre":"ocean"},{"genre":"haryanvi pop"},{"genre":"belgian pop"},{"genre":"contemporary post-bop"},{"genre":"vietnamese melodic rap"},{"genre":"hip hop tuga"},{"genre":"gospel"},{"genre":"shiver pop"},{"genre":"jazz trumpet"},{"genre":"american metalcore"},{"genre":"canadian electronic"},{"genre":"water"},{"genre":"barnmusik"},{"genre":"northern soul"},{"genre":"argentine telepop"},{"genre":"deathcore"},{"genre":"pakistani pop"},{"genre":"visual kei"},{"genre":"stoner metal"},{"genre":"ukrainian pop"},{"genre":"doo-wop"},{"genre":"colombian hip hop"},{"genre":"traprun"},{"genre":"melodic dubstep"},{"genre":"seattle hip hop"},{"genre":"detroit rock"},{"genre":"hindi indie"},{"genre":"ambient worship"},{"genre":"piseiro"},{"genre":"ska mexicano"},{"genre":"big beat"},{"genre":"canadian country"},{"genre":"pinoy trap"},{"genre":"vapor soul"},{"genre":"haryanvi hip hop"},{"genre":"taiwan singer-songwriter"},{"genre":"hardwave"},{"genre":"australian indie folk"},{"genre":"folklore argentino"},{"genre":"partyschlager"},{"genre":"rock alternativo brasileiro"},{"genre":"diva house"},{"genre":"london rap"},{"genre":"argentine reggae"},{"genre":"future garage"},{"genre":"milan indie"},{"genre":"intelligent dance music"},{"genre":"drumless hip hop"},{"genre":"nwobhm"},{"genre":"charva"},{"genre":"cool jazz"},{"genre":"canadian pop punk"},{"genre":"indonesian alternative rock"},{"genre":"indonesian folk pop"},{"genre":"melodic death metal"},{"genre":"j-pop boy group"},{"genre":"japanese electropop"},{"genre":"australian surf rock"},{"genre":"j-acoustic"},{"genre":"progressive bluegrass"},{"genre":"corridos clasicos"},{"genre":"rif"},{"genre":"turkce slow sarkilar"},{"genre":"canadian contemporary country"},{"genre":"chicago bop"},{"genre":"middle earth"},{"genre":"swedish synthpop"},{"genre":"hawaiian hip hop"},{"genre":"neoperreo"},{"genre":"boston rock"},{"genre":"classic mandopop"},{"genre":"soul jazz"},{"genre":"rave funk"},{"genre":"seattle indie"},{"genre":"vocal house"},{"genre":"russelater"},{"genre":"cubaton"},{"genre":"vapor twitch"},{"genre":"mainland chinese pop"},{"genre":"trap soul"},{"genre":"electronica argentina"},{"genre":"tropicalia"},{"genre":"manguebeat"},{"genre":"rock uruguayo"},{"genre":"rap espanol"},{"genre":"korean city pop"},{"genre":"jazz saxophone"},{"genre":"moroccan pop"},{"genre":"impressionism"},{"genre":"nu gaze"},{"genre":"chill drill"},{"genre":"urdu hip hop"},{"genre":"traditional blues"},{"genre":"dinner jazz"},{"genre":"funk 150 bpm"},{"genre":"jamaican dancehall"},{"genre":"brighton indie"},{"genre":"spacegrunge"},{"genre":"musica bajacaliforniana"},{"genre":"suomi rock"},{"genre":"comic metal"},{"genre":"swedish idol pop"},{"genre":"alte"},{"genre":"japanese r&b"},{"genre":"swedish alternative rock"},{"genre":"psychedelic hip hop"},{"genre":"japanese chillhop"},{"genre":"roots worship"},{"genre":"experimental r&b"},{"genre":"uplifting trance"},{"genre":"new age"},{"genre":"p funk"},{"genre":"scam rap"},{"genre":"vallenato moderno"},{"genre":"german indie"},{"genre":"new age piano"},{"genre":"float house"},{"genre":"sky room"},{"genre":"swedish indie pop"},{"genre":"rock drums"},{"genre":"sound"},{"genre":"levenslied"},{"genre":"nueva cancion"},{"genre":"russian rock"},{"genre":"bhajan"},{"genre":"experimental hip hop"},{"genre":"bolero mexicano"},{"genre":"vancouver indie"},{"genre":"arabic hip hop"},{"genre":"new jersey indie"},{"genre":"nashville hip hop"},{"genre":"ska punk"},{"genre":"rap cristiano"},{"genre":"english indie rock"},{"genre":"naija worship"},{"genre":"uk americana"},{"genre":"neo-singer-songwriter"},{"genre":"modern j-rock"},{"genre":"south african pop"},{"genre":"lo-fi product"},{"genre":"rap maroc"},{"genre":"ambient folk"},{"genre":"bass trap"},{"genre":"classic kollywood"},{"genre":"jazz piano"},{"genre":"rebel blues"},{"genre":"toronto indie"},{"genre":"progressive trance"},{"genre":"tierra caliente"},{"genre":"muziek voor kinderen"},{"genre":"dark pop"},{"genre":"odia pop"},{"genre":"trap colombiano"},{"genre":"indie quebecois"},{"genre":"ambient"},{"genre":"funk viral"},{"genre":"medieval rock"},{"genre":"teen pop"},{"genre":"folk brasileiro"},{"genre":"lo-fi"},{"genre":"manele"},{"genre":"instrumental rock"},{"genre":"trap baiano"},{"genre":"british folk"},{"genre":"rap baiano"},{"genre":"amapiano"},{"genre":"funk mandelao"},{"genre":"celtic"},{"genre":"tekk"},{"genre":"turkish alternative"},{"genre":"german hard rock"},{"genre":"canadian latin"},{"genre":"bases de freestyle"},{"genre":"minneapolis sound"},{"genre":"bubblegum dance"},{"genre":"funk das antigas"},{"genre":"jazz cover"},{"genre":"british indie rock"},{"genre":"alabama rap"},{"genre":"baltimore indie"},{"genre":"women's music"},{"genre":"old school rap francais"},{"genre":"antiviral pop"},{"genre":"shamanic"},{"genre":"basshall"},{"genre":"czech rock"},{"genre":"a cappella"},{"genre":"deep tropical house"},{"genre":"nasheed"},{"genre":"japanese soul"},{"genre":"german trap"},{"genre":"rkt"},{"genre":"brazilian ccm"},{"genre":"zhongguo feng"},{"genre":"crank wave"},{"genre":"st louis rap"},{"genre":"canzone d'autore"},{"genre":"trap catala"},{"genre":"athens indie"},{"genre":"australian house"},{"genre":"australian reggae fusion"},{"genre":"philly soul"},{"genre":"classic girl group"},{"genre":"boom bap"},{"genre":"r&b argentino"},{"genre":"bow pop"},{"genre":"texas latin rap"},{"genre":"synthwave"},{"genre":"chill phonk"},{"genre":"rap catala"},{"genre":"pinoy rock"},{"genre":"thai indie pop"},{"genre":"austropop"},{"genre":"azonto"},{"genre":"karadeniz turkuleri"},{"genre":"russian drain"},{"genre":"indie viet"},{"genre":"nu-metalcore"},{"genre":"swedish singer-songwriter"},{"genre":"hopebeat"},{"genre":"gymcore"},{"genre":"focus"},{"genre":"wonky"},{"genre":"swedish eurodance"},{"genre":"russian gangster rap"},{"genre":"taiwan indie"},{"genre":"synth funk"},{"genre":"rap mineiro"},{"genre":"rap algerien"},{"genre":"ye ye"},{"genre":"singaporean pop"},{"genre":"pinoy reggae"},{"genre":"art punk"},{"genre":"batidao romantico"},{"genre":"indiecoustica"},{"genre":"hypnagogic pop"},{"genre":"djent"},{"genre":"variete francaise"},{"genre":"classify"},{"genre":"indonesian worship"},{"genre":"greek drill"},{"genre":"g-house"},{"genre":"turkish trap pop"},{"genre":"lebanese pop"},{"genre":"tamaulipas rap"},{"genre":"polish alternative"},{"genre":"swedish drill"},{"genre":"harlem renaissance"},{"genre":"uk doom metal"},{"genre":"hard bop"},{"genre":"jazztronica"},{"genre":"portuguese pop"},{"genre":"classic soundtrack"},{"genre":"italian baroque"},{"genre":"westcoast flow"},{"genre":"rap chileno"},{"genre":"rap geek"},{"genre":"russian romanticism"},{"genre":"j-pop girl group"},{"genre":"new school turkce rap"},{"genre":"sleaze rock"},{"genre":"brazilian jazz"},{"genre":"electronic rock"},{"genre":"chill abstract hip hop"},{"genre":"jazz guitar"},{"genre":"rhythm game"},{"genre":"proto-metal"},{"genre":"prog metal"},{"genre":"bassline"},{"genre":"retro soul"},{"genre":"jazz fusion"},{"genre":"latin afrobeat"},{"genre":"classic colombian pop"},{"genre":"iskelma"},{"genre":"proto-hyperpop"},{"genre":"japanese classical"},{"genre":"electro swing"},{"genre":"rock nacional"},{"genre":"rap cearense"},{"genre":"rock gaucho"},{"genre":"pop folk"},{"genre":"spanish punk"},{"genre":"australian children's music"},{"genre":"rock kapak"},{"genre":"cyberpunk"},{"genre":"eau claire indie"},{"genre":"scottish singer-songwriter"},{"genre":"lo-fi vgm"},{"genre":"chicha"},{"genre":"french soundtrack"},{"genre":"deep german hip hop"},{"genre":"classic city pop"},{"genre":"salsa venezolana"},{"genre":"hardcore techno"},{"genre":"classic russian pop"},{"genre":"ottawa rap"},{"genre":"turkish deep house"},{"genre":"stomp pop"},{"genre":"nintendocore"},{"genre":"boom bap brasileiro"},{"genre":"italo disco"},{"genre":"ghanaian pop"},{"genre":"rap sardegna"},{"genre":"lata"},{"genre":"latin jazz"},{"genre":"swedish power metal"},{"genre":"anime rap"},{"genre":"hk-pop"},{"genre":"classic arab pop"},{"genre":"rap underground espanol"},{"genre":"italian alternative"},{"genre":"glitch hop"},{"genre":"forro de favela"},{"genre":"black metal"},{"genre":"filthstep"},{"genre":"spanish metal"},{"genre":"boston hip hop"},{"genre":"romanian trap"},{"genre":"cumbia santafesina"},{"genre":"german r&b"},{"genre":"thai rock"},{"genre":"anthem emo"},{"genre":"merengue"},{"genre":"rock brasiliense"},{"genre":"banda sinaloense"},{"genre":"french reggae"},{"genre":"trap carioca"},{"genre":"hands up"},{"genre":"german underground rap"},{"genre":"atlanta indie"},{"genre":"bitpop"},{"genre":"newcastle nsw indie"},{"genre":"christian pop"},{"genre":"bandung indie"},{"genre":"chill breakcore"},{"genre":"classic uk pop"},{"genre":"flamenco"},{"genre":"musica tlaxcalteca"},{"genre":"indie electropop"},{"genre":"deep disco house"},{"genre":"livetronica"},{"genre":"chicago punk"},{"genre":"aussie drill"},{"genre":"mahraganat"},{"genre":"pet calming"},{"genre":"classic russian rock"},{"genre":"pop violin"},{"genre":"nederpop"},{"genre":"indie punk"},{"genre":"reggaeton cristiano"},{"genre":"breakbeat"},{"genre":"lo-fi rap"},{"genre":"palm desert scene"},{"genre":"german punk"},{"genre":"afghan pop"},{"genre":"folk punk"},{"genre":"argentine alternative rock"},{"genre":"finnish metal"},{"genre":"boston folk"},{"genre":"nordic soundtrack"},{"genre":"cumbia del sureste"},{"genre":"australian alternative rock"},{"genre":"desi emo rap"},{"genre":"violao"},{"genre":"grave wave"},{"genre":"abstract hip hop"},{"genre":"israeli mediterranean"},{"genre":"german pop rock"},{"genre":"lovers rock"},{"genre":"barnsagor"},{"genre":"fantasy metal"},{"genre":"melodic thrash"},{"genre":"mississippi hip hop"},{"genre":"german singer-songwriter"},{"genre":"lo-fi emo"},{"genre":"cumbia ranchera"},{"genre":"future house"},{"genre":"anthem worship"},{"genre":"australian metalcore"},{"genre":"thai indie rock"},{"genre":"dembow dominicano"},{"genre":"icelandic indie"},{"genre":"dark synthpop"},{"genre":"upstate ny rap"},{"genre":"acoustic opm"},{"genre":"australian country"},{"genre":"venezuelan rock"},{"genre":"scream rap"},{"genre":"morelos indie"},{"genre":"bboy"},{"genre":"noise rock"},{"genre":"narco rap"},{"genre":"sholawat"},{"genre":"manchester hip hop"},{"genre":"future bass"},{"genre":"organic electronic"},{"genre":"pop nacional antigas"},{"genre":"instrumental funk"},{"genre":"k-indie"},{"genre":"cumbia sonorense"},{"genre":"carnaval"},{"genre":"digital hardcore"},{"genre":"dutch indie"},{"genre":"garage rock revival"},{"genre":"indie liguria"},{"genre":"christmas instrumental"},{"genre":"ghanaian hip hop"},{"genre":"trap venezolano"},{"genre":"traphall"},{"genre":"belgian dance"},{"genre":"swedish melodeath"},{"genre":"kirtan"},{"genre":"qawwali"},{"genre":"cancion infantil latinoamericana"},{"genre":"polish classical"},{"genre":"reggae en espanol"},{"genre":"detroit trap brasileiro"},{"genre":"psychedelic soul"},{"genre":"kizomba"},{"genre":"nerdcore brasileiro"},{"genre":"canzone napoletana"},{"genre":"neue neue deutsche welle"},{"genre":"chinese r&b"},{"genre":"thai hip hop"},{"genre":"uptempo hardcore"},{"genre":"indian folk"},{"genre":"modern reggae"},{"genre":"happy hardcore"},{"genre":"musica tradicional cubana"},{"genre":"solo wave"},{"genre":"canadian soundtrack"},{"genre":"classic sierreno"},{"genre":"egyptian trap"},{"genre":"classic praise"},{"genre":"asian american hip hop"},{"genre":"swedish pop rap"},{"genre":"turkish psych"},{"genre":"veracruz indie"},{"genre":"icelandic rock"},{"genre":"finnish power metal"},{"genre":"indonesian reggae"},{"genre":"bubble trance"},{"genre":"acoustic guitar cover"},{"genre":"pop virale italiano"},{"genre":"rai"},{"genre":"danish rock"},{"genre":"liquid funk"},{"genre":"turkish jazz"},{"genre":"tontipop"},{"genre":"dansband"},{"genre":"pianissimo"},{"genre":"kayokyoku"},{"genre":"singaporean mandopop"},{"genre":"bronx hip hop"},{"genre":"jazz trio"},{"genre":"japanese punk rock"},{"genre":"dark clubbing"},{"genre":"electro-pop francais"},{"genre":"egyptian hip hop"},{"genre":"french shoegaze"},{"genre":"drill italiana"},{"genre":"aggressive phonk"},{"genre":"uk dnb"},{"genre":"progressive metalcore"},{"genre":"french romanticism"},{"genre":"neo r&b"},{"genre":"german house"},{"genre":"electropowerpop"},{"genre":"japanese alternative pop"},{"genre":"vegas indie"},{"genre":"austindie"},{"genre":"uk reggae"},{"genre":"healing"},{"genre":"musica triste brasileira"},{"genre":"samba-enredo"},{"genre":"afro soul"},{"genre":"jovem guarda"},{"genre":"gujarati garba"},{"genre":"nightcore"},{"genre":"saskatchewan indie"},{"genre":"swedish death metal"},{"genre":"hamburg electronic"},{"genre":"canadian americana"},{"genre":"umbanda"},{"genre":"souldies"},{"genre":"anti-folk"},{"genre":"riot grrrl"},{"genre":"monterrey indie"},{"genre":"mexican classic rock"},{"genre":"new orleans jazz"},{"genre":"organic house"},{"genre":"dixieland"},{"genre":"cosmic american"},{"genre":"rap feminino nacional"},{"genre":"british alternative rock"},{"genre":"indonesian idol pop"},{"genre":"jawaiian"},{"genre":"mariachi cristiano"},{"genre":"classic cantopop"},{"genre":"romantico"},{"genre":"german power metal"},{"genre":"classic disco polo"},{"genre":"musique pour enfants"},{"genre":"swedish tropical house"},{"genre":"discofox"},{"genre":"chilena"},{"genre":"j-metal"},{"genre":"welsh rock"},{"genre":"bulgarian pop"},{"genre":"virginia hip hop"},{"genre":"brega paraense"},{"genre":"thai trap"},{"genre":"grungegaze"},{"genre":"chicago hardcore"},{"genre":"sludge metal"},{"genre":"pacific islands pop"},{"genre":"south african rock"},{"genre":"swedish indie rock"},{"genre":"russian post-punk"},{"genre":"smooth saxophone"},{"genre":"ukrainian rock"},{"genre":"chicago soul"},{"genre":"samba moderno"},{"genre":"freestyle"},{"genre":"american shoegaze"},{"genre":"latin metal"},{"genre":"german reggae"},{"genre":"danish metal"},{"genre":"rock mineiro"},{"genre":"sound team"},{"genre":"canadian electropop"},{"genre":"drone"},{"genre":"regional mexicano femenil"},{"genre":"indian edm"},{"genre":"j-idol"},{"genre":"okinawan pop"},{"genre":"sandalwood"},{"genre":"scottish new wave"},{"genre":"indie jazz"},{"genre":"afrikaans"},{"genre":"nz reggae"},{"genre":"israeli rock"},{"genre":"oklahoma country"},{"genre":"viking metal"},{"genre":"christian trap"},{"genre":"brega"},{"genre":"buffalo hip hop"},{"genre":"kazakh pop"},{"genre":"chill lounge"},{"genre":"belly dance"},{"genre":"minimal tech house"},{"genre":"icelandic pop"},{"genre":"classic indo pop"},{"genre":"oakland indie"},{"genre":"surf punk"},{"genre":"australian trap"},{"genre":"brutal death metal"},{"genre":"christian metal"},{"genre":"japanese vtuber"},{"genre":"south african hip hop"},{"genre":"rhode island rap"},{"genre":"austrian pop"},{"genre":"shaabi"},{"genre":"celtic metal"},{"genre":"salsa peruana"},{"genre":"tecnobrega"},{"genre":"indian lo-fi"},{"genre":"transpop"},{"genre":"chillstep"},{"genre":"japanese trap"},{"genre":"egyptian alternative"},{"genre":"jersey club"},{"genre":"experimental"},{"genre":"channel pop"},{"genre":"czech drill"},{"genre":"texas metal"},{"genre":"polish rock"},{"genre":"norwegian pop rap"},{"genre":"indonesian lo-fi pop"},{"genre":"samba de roda"},{"genre":"sda a cappella"},{"genre":"harlem hip hop"},{"genre":"danish pop rock"},{"genre":"canadian ccm"},{"genre":"russian emo rap"},{"genre":"pinoy city pop"},{"genre":"slayer"},{"genre":"memphis phonk"},{"genre":"danspunk"},{"genre":"polish alternative rap"},{"genre":"uk pop punk"},{"genre":"indie rock mexicano"},{"genre":"bhangra"},{"genre":"russian punk"},{"genre":"chill dream pop"},{"genre":"quran"},{"genre":"classic turkish pop"},{"genre":"dark techno"},{"genre":"gothenburg indie"},{"genre":"musica gaucha tradicionalista"},{"genre":"boston indie"},{"genre":"quebec indie"},{"genre":"uk house"},{"genre":"psychedelic trance"},{"genre":"neoclassical darkwave"},{"genre":"oc rap"},{"genre":"rave"},{"genre":"vapor pop"},{"genre":"cdo indie"},{"genre":"classic venezuelan pop"},{"genre":"kazakh hip hop"},{"genre":"guadalajara indie"},{"genre":"german alternative rock"},{"genre":"karadeniz pop"},{"genre":"post-rock"},{"genre":"children's folk"},{"genre":"polish drill"},{"genre":"vaporwave"},{"genre":"hungarian hip hop"},{"genre":"alternative americana"},{"genre":"hyphy"},{"genre":"easycore"},{"genre":"new beat"},{"genre":"indonesian hip hop"},{"genre":"instrumental grime"},{"genre":"punk urbano"},{"genre":"reggae uruguayo"},{"genre":"khaliji"},{"genre":"opera metal"},{"genre":"scottish indie"},{"genre":"ann arbor indie"},{"genre":"study beats"},{"genre":"vintage italian soundtrack"},{"genre":"folk rock italiano"},{"genre":"mexican pop punk"},{"genre":"midwest emo"},{"genre":"cumbia paraguaya"},{"genre":"italian romanticism"},{"genre":"russian drill"},{"genre":"swedish hard rock"},{"genre":"romanian house"},{"genre":"viral trap"},{"genre":"liverpool indie"},{"genre":"pinoy drill"},{"genre":"bandinhas"},{"genre":"experimental rock"},{"genre":"northern irish indie"},{"genre":"bluegrass"},{"genre":"jazz boom bap"},{"genre":"early us punk"},{"genre":"dub"},{"genre":"spectra"},{"genre":"nashville singer-songwriter"},{"genre":"drill chileno"},{"genre":"classic danish pop"},{"genre":"ambient guitar"},{"genre":"piano blues"},{"genre":"indian classical"},{"genre":"horror punk"},{"genre":"pinoy alternative rap"},{"genre":"yugoslav rock"},{"genre":"turkish instrumental"},{"genre":"folk metal"},{"genre":"melodic metal"},{"genre":"classic french pop"},{"genre":"russian electronic"},{"genre":"new jersey hardcore"},{"genre":"rune folk"},{"genre":"french techno"},{"genre":"technical death metal"},{"genre":"magyar trap"},{"genre":"indonesian viral pop"},{"genre":"rap underground argentino"},{"genre":"norwegian hip hop"},{"genre":"dancehall queen"},{"genre":"gospel r&b"},{"genre":"polish viral rap"},{"genre":"south african house"},{"genre":"icelandic classical"},{"genre":"viral afropop"},{"genre":"wave"},{"genre":"german metalcore"},{"genre":"pop minang"},{"genre":"progressive groove metal"},{"genre":"deep turkish pop"},{"genre":"pink noise"},{"genre":"contemporary jazz"},{"genre":"classic house"},{"genre":"rhythm and blues"},{"genre":"classic israeli pop"},{"genre":"glee club"},{"genre":"american folk revival"},{"genre":"kosovan pop"},{"genre":"rva drill"},{"genre":"atmosphere"},{"genre":"peruvian rock"},{"genre":"zhenskiy rep"},{"genre":"bc underground hip hop"},{"genre":"pinoy indie"},{"genre":"uk dancehall"},{"genre":"kurdish pop"},{"genre":"gaming dubstep"},{"genre":"danish electronic"},{"genre":"spanish folk metal"},{"genre":"pinoy singer-songwriter"},{"genre":"deep latin christian"},{"genre":"north carolina roots"},{"genre":"chill guitar"},{"genre":"folktronica"},{"genre":"croatian pop"},{"genre":"swedish soul"},{"genre":"bergamo indie"},{"genre":"lo-fi house"},{"genre":"puerto rican rock"},{"genre":"idol rock"},{"genre":"idol"},{"genre":"kolsche karneval"},{"genre":"rocksteady"},{"genre":"acoustic blues"},{"genre":"latinx alternative"},{"genre":"frenchcore"},{"genre":"washington indie"},{"genre":"soca"},{"genre":"auckland indie"},{"genre":"oyun havasi"},{"genre":"central asian hip hop"},{"genre":"antideutsche"},{"genre":"christian metalcore"},{"genre":"chiptune"},{"genre":"spanish modern rock"},{"genre":"post-minimalism"},{"genre":"rap uliczny"},{"genre":"nederlandse hardstyle"},{"genre":"gothenburg metal"},{"genre":"icelandic experimental"},{"genre":"kabarett"},{"genre":"latin classical"},{"genre":"ghanaian alternative"},{"genre":"deep pop edm"},{"genre":"jangle pop"},{"genre":"calming instrumental"},{"genre":"ethereal wave"},{"genre":"emo rap italiano"},{"genre":"polish underground rap"},{"genre":"musica aragonesa"},{"genre":"turkish edm"},{"genre":"balkan trap"},{"genre":"gothic rock"},{"genre":"classic peruvian pop"},{"genre":"italian opera"},{"genre":"gospel antigas"},{"genre":"celtic punk"},{"genre":"irish folk"},{"genre":"dream plugg"},{"genre":"classical drill"},{"genre":"rock andaluz"},{"genre":"focus beats"},{"genre":"j-indie"},{"genre":"rap boricua"},{"genre":"indonesian city pop"},{"genre":"afrobeat"},{"genre":"rap uruguayo"},{"genre":"pop teen brasileiro"},{"genre":"dark plugg"},{"genre":"idol kayo"},{"genre":"kiwi rock"},{"genre":"maga rap"},{"genre":"pop chileno"},{"genre":"chinese indie"},{"genre":"brain waves"},{"genre":"argentine heavy metal"},{"genre":"chinese singer-songwriter"},{"genre":"arab electronic"},{"genre":"chihuahua indie"},{"genre":"progressive post-hardcore"},{"genre":"microhouse"},{"genre":"portland indie"},{"genre":"comedy rap"},{"genre":"samba-jazz"},{"genre":"classic garage rock"},{"genre":"game mood"},{"genre":"portland hip hop"},{"genre":"ukrainian viral pop"},{"genre":"belgian rock"},{"genre":"russian grime"},{"genre":"chilean indie"},{"genre":"french opera"},{"genre":"anime phonk"},{"genre":"glitchbreak"},{"genre":"west bengali pop"},{"genre":"rock catala"},{"genre":"neue deutsche welle"},{"genre":"fourth world"},{"genre":"native american traditional"},{"genre":"music box"},{"genre":"bgm"},{"genre":"samba paulista"},{"genre":"viking folk"},{"genre":"neomelodici"},{"genre":"comedy"},{"genre":"chicago house"},{"genre":"tropical alternativo"},{"genre":"vietnamese trap"},{"genre":"musica angolana"},{"genre":"samba-rock"},{"genre":"brega romantico"},{"genre":"korean instrumental"},{"genre":"halloween"},{"genre":"trap pesado"},{"genre":"theme"},{"genre":"persian hip hop"},{"genre":"rap underground mexicano"},{"genre":"narodna muzika"},{"genre":"swedish indie folk"},{"genre":"trap dominicano"},{"genre":"contemporary classical"},{"genre":"southern americana"},{"genre":"fotbollslatar"},{"genre":"texas blues"},{"genre":"huzunlu sarkilar"},{"genre":"malayalam pop"},{"genre":"electrofox"},{"genre":"partido alto"},{"genre":"rap nacional antigo"},{"genre":"italian pop rock"},{"genre":"murcia indie"},{"genre":"german trance"},{"genre":"reggae tuga"},{"genre":"concepcion indie"},{"genre":"canadian folk"},{"genre":"pop quebecois"},{"genre":"uk melodic rap"},{"genre":"piano worship"},{"genre":"new jersey punk"},{"genre":"instrumental post-rock"},{"genre":"nordic house"},{"genre":"australian alternative pop"},{"genre":"dutch metal"},{"genre":"volkspop"},{"genre":"kavkaz"},{"genre":"polish indie"},{"genre":"no beat"},{"genre":"japanese new wave"},{"genre":"cologne indie"},{"genre":"new jersey underground rap"},{"genre":"reggae do maranhao"},{"genre":"french tech house"},{"genre":"minimal melodic techno"},{"genre":"japanese pop punk"},{"genre":"lagu timur"},{"genre":"slc indie"},{"genre":"mizrahi"},{"genre":"musica costena"},{"genre":"entehno"},{"genre":"lustrum"},{"genre":"balkan hip hop"},{"genre":"hip hop quebecois"},{"genre":"cowboy western"},{"genre":"uk experimental electronic"},{"genre":"malaysian mandopop"},{"genre":"welsh metal"},{"genre":"reggae cristao"},{"genre":"indonesian emo"},{"genre":"metallic hardcore"},{"genre":"belgian indie"},{"genre":"rochester mn indie"},{"genre":"liedermacher"},{"genre":"victoria bc indie"},{"genre":"japanese viral pop"},{"genre":"bay area indie"},{"genre":"trap peruano"},{"genre":"ska chileno"},{"genre":"marathi pop"},{"genre":"trap antillais"},{"genre":"laboratorio"},{"genre":"chillsynth"},{"genre":"minimalism"},{"genre":"chalga"},{"genre":"dutch cabaret"},{"genre":"brega funk"},{"genre":"chicago blues"},{"genre":"hungarian rock"},{"genre":"trap tuga"},{"genre":"barnemusikk"},{"genre":"birmingham grime"},{"genre":"parody"},{"genre":"nuevo folklore mexicano"},{"genre":"rap tunisien"},{"genre":"future rock"},{"genre":"jamaican hip hop"},{"genre":"mantra"},{"genre":"classic iskelma"},{"genre":"new weird america"},{"genre":"colombian rock"},{"genre":"brazilian punk"},{"genre":"big band"},{"genre":"japanese old school hip hop"},{"genre":"kermis"},{"genre":"dong-yo"},{"genre":"diy emo"},{"genre":"plug brasileiro"},{"genre":"uk garage"},{"genre":"italian soundtrack"},{"genre":"australian indigenous music"},{"genre":"deathgrind"},{"genre":"neo classical metal"},{"genre":"taiwan hip hop"},{"genre":"neoclassicism"},{"genre":"ambeat"},{"genre":"peruvian hip hop"},{"genre":"south african gospel"},{"genre":"swedish country"},{"genre":"symphonic deathcore"},{"genre":"lagu melayu"},{"genre":"thai folk rock"},{"genre":"shanty"},{"genre":"scandinavian r&b"},{"genre":"kwaito"},{"genre":"australian indie rock"},{"genre":"east coast reggae"},{"genre":"emoplugg"},{"genre":"finnish trap"},{"genre":"indonesian punk"},{"genre":"rock baiano"},{"genre":"brisbane indie"},{"genre":"greek underground rap"},{"genre":"musica tamaulipeca"},{"genre":"british children's music"},{"genre":"progressive deathcore"},{"genre":"arab alternative"},{"genre":"melodic techno"},{"genre":"pinoy pop punk"},{"genre":"swancore"},{"genre":"gregorian dance"},{"genre":"assamese pop"},{"genre":"future funk"},{"genre":"electro jazz"},{"genre":"grime brasileiro"},{"genre":"guaracha"},{"genre":"romanian rap"},{"genre":"czsk emo rap"},{"genre":"wrestling"},{"genre":"deep comedy"},{"genre":"uk contemporary jazz"},{"genre":"latin viral rap"},{"genre":"strut"},{"genre":"bergen indie"},{"genre":"tagalog worship"},{"genre":"country gospel"},{"genre":"dark cabaret"},{"genre":"folclore salteno"},{"genre":"progressive psytrance"},{"genre":"dark wave"},{"genre":"ska revival"},{"genre":"corridos belicos"},{"genre":"new comedy"},{"genre":"russian edm"},{"genre":"ecuadorian pop"},{"genre":"roda de samba"},{"genre":"fado"},{"genre":"post-screamo"},{"genre":"vintage french electronic"},{"genre":"carnaval cadiz"},{"genre":"pastoral"},{"genre":"acoustic rock"},{"genre":"rock independant francais"},{"genre":"texas pop punk"},{"genre":"alternative roots rock"},{"genre":"japanese post-hardcore"},{"genre":"nova musica pernambucana"},{"genre":"slovak hip hop"},{"genre":"musica sinaloense"},{"genre":"comedy rock"},{"genre":"colombian indie"},{"genre":"volksmusik"},{"genre":"belo horizonte indie"},{"genre":"ostrock"},{"genre":"israeli hip hop"},{"genre":"vbs"},{"genre":"xtra raw"},{"genre":"musica per bambini"},{"genre":"louvor"},{"genre":"french jazz"},{"genre":"hard bass"},{"genre":"world devotional"},{"genre":"industrial hip hop"},{"genre":"russian hyperpop"},{"genre":"japanese metalcore"},{"genre":"german oi"},{"genre":"nepali pop"},{"genre":"sinhala pop"},{"genre":"darksynth"},{"genre":"korean indie rock"},{"genre":"gregorian chant"},{"genre":"mambo"},{"genre":"deep talent show"},{"genre":"miami bass"},{"genre":"vietnamese singer-songwriter"},{"genre":"classic thai pop"},{"genre":"argentine punk"},{"genre":"samba reggae"},{"genre":"turkish soundtrack"},{"genre":"musica andina"},{"genre":"chinese idol pop"},{"genre":"kansas city hip hop"},{"genre":"steampunk"},{"genre":"experimental ambient"},{"genre":"deathgrass"},{"genre":"drain"},{"genre":"russian viral rap"},{"genre":"j-ambient"},{"genre":"banjo"},{"genre":"cancion infantil mexicana"},{"genre":"solfeggio product"},{"genre":"slamming deathcore"},{"genre":"classic polish pop"},{"genre":"turkce kadin rap"},{"genre":"norwegian rock"},{"genre":"jungle"},{"genre":"ecm-style jazz"},{"genre":"abstract beats"},{"genre":"cello"},{"genre":"ukrainian phonk"},{"genre":"saxophone house"},{"genre":"south african trap"},{"genre":"nottingham hip hop"},{"genre":"reggae cover"},{"genre":"old school bassline"},{"genre":"polish alternative rock"},{"genre":"rock quebecois"},{"genre":"indonesian ska"},{"genre":"australian r&b"},{"genre":"emo mexicano"},{"genre":"islamic recitation"},{"genre":"english baroque"},{"genre":"uk tech house"},{"genre":"australian post-hardcore"},{"genre":"synthesizer"},{"genre":"deep new americana"},{"genre":"russian underground rap"},{"genre":"dark rock"},{"genre":"dark post-punk"},{"genre":"old school dancehall"},{"genre":"doom metal"},{"genre":"musica poblana"},{"genre":"italian tenor"},{"genre":"canadian classical"},{"genre":"classical tenor"},{"genre":"swedish americana"},{"genre":"swedish melodic rock"},{"genre":"dangdut remix"},{"genre":"crossover thrash"},{"genre":"russian rave"},{"genre":"musica potosina"},{"genre":"sacramento hip hop"},{"genre":"german indie folk"},{"genre":"north east england indie"},{"genre":"punk rock mexicano"},{"genre":"psicodelia brasileira"},{"genre":"josei rap"},{"genre":"japanese instrumental"},{"genre":"bakersfield sound"},{"genre":"korean old school hip hop"},{"genre":"korean talent show"},{"genre":"chinese hip hop"},{"genre":"tex-mex"},{"genre":"anime cv"},{"genre":"city pop"},{"genre":"deutschrock"},{"genre":"drill brasileiro"},{"genre":"kawaii metal"},{"genre":"canadian metalcore"},{"genre":"groove gospel"},{"genre":"jewish pop"},{"genre":"orgcore"},{"genre":"classic belgian pop"},{"genre":"brazilian metal"},{"genre":"ballet class"},{"genre":"musica catalana"},{"genre":"kindie rock"},{"genre":"musica neoleonesa"},{"genre":"indian fusion"},{"genre":"carnatic"},{"genre":"popwave"},{"genre":"nottingham indie"},{"genre":"psychedelic pop"},{"genre":"battle rap"},{"genre":"classic j-rock"},{"genre":"indonesian post-hardcore"},{"genre":"nightrun"},{"genre":"albuquerque indie"},{"genre":"irish country"},{"genre":"portuguese rock"},{"genre":"roots americana"},{"genre":"brazilian indie"},{"genre":"glam punk"},{"genre":"brazilian emo"},{"genre":"brit funk"},{"genre":"alabama indie"},{"genre":"western swing"},{"genre":"cumbia lagunera"},{"genre":"malaysian indie"},{"genre":"post-metal"},{"genre":"french metal"},{"genre":"classic norwegian pop"},{"genre":"australian singer-songwriter"},{"genre":"8d"},{"genre":"blackened deathcore"},{"genre":"tololoche"},{"genre":"classic persian pop"},{"genre":"flamenco fusion"},{"genre":"double drumming"},{"genre":"brazilian soul"},{"genre":"west coast reggae"},{"genre":"k-pop ballad"},{"genre":"manila sound"},{"genre":"canadian children's music"},{"genre":"jazz quartet"},{"genre":"afro house"},{"genre":"singaporean singer-songwriter"},{"genre":"sertanejo gospel"},{"genre":"traditional country"},{"genre":"dabke"},{"genre":"lithuanian pop"},{"genre":"christian uplift"},{"genre":"trop rock"},{"genre":"flint hip hop"},{"genre":"trot"},{"genre":"rock alternativo espanol"},{"genre":"virginia metal"},{"genre":"lds youth"},{"genre":"chinese bgm"},{"genre":"german viral rap"},{"genre":"early avant garde"},{"genre":"swedish jazz"},{"genre":"cumbia andina mexicana"},{"genre":"super eurobeat"},{"genre":"novelty"},{"genre":"russian metal"},{"genre":"witch house"},{"genre":"acoustic chill"},{"genre":"african rock"},{"genre":"tribal house"},{"genre":"space age pop"},{"genre":"uzbek pop"},{"genre":"finnish heavy metal"},{"genre":"popping"},{"genre":"glitch"},{"genre":"zouk"},{"genre":"kawaii future bass"},{"genre":"musica alagoana"},{"genre":"louisiana blues"},{"genre":"rap cristao"},{"genre":"hip-hop experimental"},{"genre":"norwegian metal"},{"genre":"klubowe"},{"genre":"progressive jazz fusion"},{"genre":"5th wave emo"},{"genre":"dansktop"},{"genre":"swiss pop"},{"genre":"himachali pop"},{"genre":"bongo flava"},{"genre":"deep chill"},{"genre":"musica coahuilense"},{"genre":"eurobeat"},{"genre":"braindance"},{"genre":"melodic hardcore"},{"genre":"latin funk"},{"genre":"modern jazz piano"},{"genre":"asbury park indie"},{"genre":"speed up brasileiro"},{"genre":"rap anime"},{"genre":"czech folk"},{"genre":"trance brasileiro"},{"genre":"pub rock"},{"genre":"czech pop rock"},{"genre":"australian underground hip hop"},{"genre":"slovak pop"},{"genre":"lds"},{"genre":"modern melodic hardcore"},{"genre":"salsa choke"},{"genre":"relaxative"},{"genre":"south african pop dance"},{"genre":"birmingham hip hop"},{"genre":"ukrainian indie"},{"genre":"australian americana"},{"genre":"emo trap en espanol"},{"genre":"shabad"},{"genre":"organic ambient"},{"genre":"thai folk pop"},{"genre":"gabber"},{"genre":"bruneian pop"},{"genre":"acoustic punk"},{"genre":"hardcore"},{"genre":"j-reggae"},{"genre":"flute rock"},{"genre":"dreampunk"},{"genre":"magyar alternative"},{"genre":"norwegian country"},{"genre":"maskandi"},{"genre":"banda carnavalera"},{"genre":"afro drill"},{"genre":"mathcore"},{"genre":"zouk riddim"},{"genre":"groove room"},{"genre":"israeli singer-songwriter"},{"genre":"nu gabber"},{"genre":"australian garage punk"},{"genre":"latin soundtrack"},{"genre":"cologne hip hop"},{"genre":"cante flamenco"},{"genre":"bouncy house"},{"genre":"brazilian bass"},{"genre":"san marcos tx indie"},{"genre":"dominican pop"},{"genre":"deconstructed club"},{"genre":"japanese shoegaze"},{"genre":"azeri rap"},{"genre":"tolkien metal"},{"genre":"shred"},{"genre":"icelandic singer-songwriter"},{"genre":"talentschau"},{"genre":"rap lyonnais"},{"genre":"classic czech pop"},{"genre":"psychobilly"},{"genre":"indian rock"},{"genre":"country blues"},{"genre":"tango"},{"genre":"hurdy-gurdy"},{"genre":"tone"},{"genre":"deep rai"},{"genre":"math rock"},{"genre":"viet chill rap"},{"genre":"yodeling"},{"genre":"malang indie"},{"genre":"reggae gaucho"},{"genre":"chilean hardcore"},{"genre":"swedish garage rock"},{"genre":"hyperpop francais"},{"genre":"ukg revival"},{"genre":"symphonic black metal"},{"genre":"classic greek pop"},{"genre":"finnish melodeath"},{"genre":"techno kayo"},{"genre":"rap baixada fluminense"},{"genre":"shonen"},{"genre":"electroclash"},{"genre":"karneval"},{"genre":"nashville indie"},{"genre":"zxc"},{"genre":"mande pop"},{"genre":"finnish alternative rock"},{"genre":"ukrainian hip hop"},{"genre":"latintronica"},{"genre":"german hyperpop"},{"genre":"r&b italiano"},{"genre":"italian techno"},{"genre":"bosnian pop"},{"genre":"lithuanian edm"},{"genre":"belarusian indie"},{"genre":"lambadao"},{"genre":"praise"},{"genre":"papuri"},{"genre":"ebm"},{"genre":"brazilian boogie"},{"genre":"dutch tech house"},{"genre":"circuit"},{"genre":"punjabi lo-fi"},{"genre":"christian lo-fi"},{"genre":"ukrainian classical"},{"genre":"chamber psych"},{"genre":"vocal harmony group"},{"genre":"pakistani indie"},{"genre":"experimental classical"},{"genre":"cumbia colombiana regia"},{"genre":"polish reggae"},{"genre":"german worship"},{"genre":"puirt-a-beul"},{"genre":"fantasy"},{"genre":"reading indie"},{"genre":"russian indie"},{"genre":"electro bailando"},{"genre":"disco polo"},{"genre":"seiyu"},{"genre":"messianic praise"},{"genre":"batak"},{"genre":"indie catala"},{"genre":"dutch r&b"},{"genre":"turk sanat muzigi"},{"genre":"perth indie"},{"genre":"chinese melodic rap"},{"genre":"oktoberfest"},{"genre":"belarusian hip hop"},{"genre":"fogo pentecostal"},{"genre":"ethnotronica"},{"genre":"polish punk"},{"genre":"microtonal"},{"genre":"cumbia ecuatoriana"},{"genre":"anime piano"},{"genre":"russian modern classical"},{"genre":"japanese piano"},{"genre":"swedish dancehall"},{"genre":"swedish reggae"},{"genre":"austin americana"},{"genre":"indie rockism"},{"genre":"euskal rock"},{"genre":"rap antillais"},{"genre":"italian reggae"},{"genre":"high-tech minimal"},{"genre":"ambient house"},{"genre":"world fusion"},{"genre":"deep tech house"},{"genre":"rap siciliano"},{"genre":"pop worship"},{"genre":"moldovan pop"},{"genre":"new italo disco"},{"genre":"chill beats"},{"genre":"west end"},{"genre":"melodic deathcore"},{"genre":"south african alternative"},{"genre":"syrian pop"},{"genre":"turkish modern jazz"},{"genre":"uk post-punk revival"},{"genre":"instrumental soul"},{"genre":"classic finnish pop"},{"genre":"furry"},{"genre":"shatta"},{"genre":"musica gaucha"},{"genre":"christian afrobeat"},{"genre":"workout product"},{"genre":"indie extremena"},{"genre":"slovak rock"},{"genre":"british jazz"},{"genre":"russian punk rock"},{"genre":"ragga jungle"},{"genre":"oldschool deutschrap"},{"genre":"no wave"},{"genre":"orchestra"},{"genre":"california hardcore"},{"genre":"concurso de talentos argentino"},{"genre":"swiss indie"},{"genre":"british power metal"},{"genre":"tanzanian pop"},{"genre":"christelijk"},{"genre":"surf music"},{"genre":"lithuanian electronic"},{"genre":"honky tonk"},{"genre":"jump up"},{"genre":"rap romantico"},{"genre":"funktronica"},{"genre":"thai indie"},{"genre":"san diego rap"},{"genre":"j-punk"},{"genre":"smutny rap"},{"genre":"atlanta metal"},{"genre":"mundart"},{"genre":"metal cover"},{"genre":"finnish death metal"},{"genre":"leicester indie"},{"genre":"apostolic worship"},{"genre":"montreal indie"},{"genre":"chanson paillarde"},{"genre":"sevdah"},{"genre":"gypsy jazz"},{"genre":"hardvapour"},{"genre":"boston metal"},{"genre":"brega saudade"},{"genre":"timba"},{"genre":"delta blues"},{"genre":"speed up turkce"},{"genre":"pinoy idol pop"},{"genre":"musica cristiana guatemalteca"},{"genre":"pirate"},{"genre":"funky house"},{"genre":"scottish indie rock"},{"genre":"techno"},{"genre":"southern gospel"},{"genre":"dariacore"},{"genre":"russian witch house"},{"genre":"baglama"},{"genre":"classic bhangra"},{"genre":"britpop revival"},{"genre":"pinoy indie rock"},{"genre":"khaleeji iraqi"},{"genre":"hawaiian"},{"genre":"czech classical"},{"genre":"free jazz"},{"genre":"acid house"},{"genre":"neo-traditional bluegrass"},{"genre":"trap beats"},{"genre":"huayno"},{"genre":"shibuya-kei"},{"genre":"denpa-kei"},{"genre":"atlanta bass"},{"genre":"french death metal"},{"genre":"norwegian black metal"},{"genre":"comedie musicale"},{"genre":"deathstep"},{"genre":"nz hip hop"},{"genre":"adventista"},{"genre":"japanese drill"},{"genre":"finnish edm"},{"genre":"barcadi"},{"genre":"cocuk sarkilari"},{"genre":"underground power pop"},{"genre":"indonesian indie rock"},{"genre":"funk melody"},{"genre":"deep minimal techno"},{"genre":"atmospheric black metal"},{"genre":"musica llanera"},{"genre":"nasyid"},{"genre":"polish old school hip hop"},{"genre":"southern metal"},{"genre":"lesen"},{"genre":"classic punjabi pop"},{"genre":"jacksonville indie"},{"genre":"japanese pop rap"},{"genre":"cantautora argentina"},{"genre":"garhwali pop"},{"genre":"carnatic vocal"},{"genre":"norwegian singer-songwriter"},{"genre":"nederreggae"},{"genre":"rap francais nouvelle vague"},{"genre":"venezuelan indie"},{"genre":"german ska"},{"genre":"canadian old school hip hop"},{"genre":"nueva ola chilena"},{"genre":"k-rock"},{"genre":"punk 'n' roll"},{"genre":"minneapolis indie"},{"genre":"handpan"},{"genre":"canadian celtic"},{"genre":"yogyakarta indie"},{"genre":"hyperpop en espanol"},{"genre":"pakistani folk"},{"genre":"irish hip hop"},{"genre":"japanese indie pop"},{"genre":"chaotic hardcore"},{"genre":"classic malaysian pop"},{"genre":"harmonica blues"},{"genre":"jamgrass"},{"genre":"us power metal"},{"genre":"bangla pop"},{"genre":"trap cristao"},{"genre":"vintage jazz"},{"genre":"malayalam hip hop"},{"genre":"poezja spiewana"},{"genre":"rap montrealais"},{"genre":"boston punk"},{"genre":"jazz house"},{"genre":"fingerstyle"},{"genre":"baltimore hip hop"},{"genre":"drone metal"},{"genre":"musica nayarita"},{"genre":"indonesian edm"},{"genre":"german ccm"},{"genre":"folklore ecuatoriano"},{"genre":"riddim"},{"genre":"japanese screamo"},{"genre":"indiana hip hop"},{"genre":"nepali indie"},{"genre":"fluxwork"},{"genre":"indonesian blues"},{"genre":"futurepop"},{"genre":"estonian hip hop"},{"genre":"neurofunk"},{"genre":"vlaamse kinderliedje"},{"genre":"michigan indie"},{"genre":"classic dubstep"},{"genre":"french psychedelic"},{"genre":"psychill"},{"genre":"czech punk"},{"genre":"russian viral pop"},{"genre":"american contemporary classical"},{"genre":"burmese pop"},{"genre":"russian folk rock"},{"genre":"twee pop"},{"genre":"rai algerien"},{"genre":"chinderlieder"},{"genre":"vietnamese idol pop"},{"genre":"pittsburgh indie"},{"genre":"sovietwave"},{"genre":"symphonic power metal"},{"genre":"bristol indie"},{"genre":"australian talent show"},{"genre":"speed plug brasileiro"},{"genre":"new orleans blues"},{"genre":"futuristic swag"},{"genre":"manchester indie"},{"genre":"mexican edm"},{"genre":"geek folk"},{"genre":"skansk musik"},{"genre":"scottish electronic"},{"genre":"kompa"},{"genre":"malian blues"},{"genre":"substep"},{"genre":"rumba congolaise"},{"genre":"classic bangla pop"},{"genre":"british modern classical"},{"genre":"classical performance"},{"genre":"kundalini"},{"genre":"norwegian classical"},{"genre":"kurdish hip hop"},{"genre":"gaita zuliana"},{"genre":"african gospel"},{"genre":"balkan beats"},{"genre":"cumbia amazonica"},{"genre":"wyoming roots"},{"genre":"latin house"},{"genre":"japanese dance pop"},{"genre":"grand rapids indie"},{"genre":"semarang indie"},{"genre":"san diego indie"},{"genre":"touhou"},{"genre":"ndombolo"},{"genre":"hinos ccb"},{"genre":"electric bass"},{"genre":"epa dunk"},{"genre":"cumbia salvadorena"},{"genre":"dutch drill"},{"genre":"dmv rap"},{"genre":"abstract"},{"genre":"russian chanson"},{"genre":"swedish progressive metal"},{"genre":"rap regio"},{"genre":"serbian hip hop"},{"genre":"medieval folk"},{"genre":"cumbia uruguaya"},{"genre":"enka"},{"genre":"swiss rock"},{"genre":"chill out"},{"genre":"hong kong indie"},{"genre":"bozlak"},{"genre":"japanese chill rap"},{"genre":"russian dance pop"},{"genre":"leipzig electronic"},{"genre":"horrorcore"},{"genre":"galante era"},{"genre":"croatian rock"},{"genre":"nova musica carioca"},{"genre":"psychedelic folk"},{"genre":"21st century classical"},{"genre":"brazilian classical"},{"genre":"tempe indie"},{"genre":"vintage tollywood"},{"genre":"folclor colombiano"},{"genre":"neo-traditional country"},{"genre":"nantes indie"},{"genre":"rock piauiense"},{"genre":"norske viser"},{"genre":"experimental vocal"},{"genre":"south carolina indie"},{"genre":"deathrash"},{"genre":"alternative pop"},{"genre":"american modern classical"},{"genre":"african reggae"},{"genre":"pagan black metal"},{"genre":"palestinian hip hop"},{"genre":"kleinkunst"},{"genre":"sung poetry"},{"genre":"virgin islands reggae"},{"genre":"paisley underground"},{"genre":"viet lo-fi"},{"genre":"trova mexicana"},{"genre":"springfield mo indie"},{"genre":"russian reggae"},{"genre":"grindcore"},{"genre":"alaska indie"},{"genre":"finnish drill"},{"genre":"christian punk"},{"genre":"italian metal"},{"genre":"folclore santiagueno"},{"genre":"flamenco guitar"},{"genre":"kompa gouyad"},{"genre":"jamtronica"},{"genre":"ontario indie"},{"genre":"japanese indie rock"},{"genre":"canadian post-hardcore"},{"genre":"techengue"},{"genre":"tape club"},{"genre":"anime latino"},{"genre":"huapango"},{"genre":"chinese electropop"},{"genre":"japanese folk"},{"genre":"kenyan pop"},{"genre":"memphis blues"},{"genre":"german punk rock"},{"genre":"modern jazz trio"},{"genre":"dark disco"},{"genre":"oc indie"},{"genre":"folklore surero"},{"genre":"jazz rock"},{"genre":"kingston on indie"},{"genre":"thai viral pop"},{"genre":"malay rap"},{"genre":"bubblegum bass"},{"genre":"dutch americana"},{"genre":"modern hardcore"},{"genre":"rap maromba"},{"genre":"brazilian house"},{"genre":"pop peruano"},{"genre":"musica campechana"},{"genre":"musica popular paraense"},{"genre":"vintage schlager"},{"genre":"melodic groove metal"},{"genre":"azeri pop"},{"genre":"aggrotech"},{"genre":"vgm remix"},{"genre":"musica oaxaquena"},{"genre":"middle east hip hop"},{"genre":"kannada hip hop"},{"genre":"french movie tunes"},{"genre":"italian tech house"},{"genre":"dream trance"},{"genre":"boogaloo"},{"genre":"mod revival"},{"genre":"raw techno"},{"genre":"gaian doom"},{"genre":"nu age"},{"genre":"salsa international"},{"genre":"swedish metalcore"},{"genre":"collage pop"},{"genre":"arab trap"},{"genre":"thai folk"},{"genre":"horror synth"},{"genre":"champeta"},{"genre":"tallava"},{"genre":"cuban alternative"},{"genre":"american post-rock"},{"genre":"alberta country"},{"genre":"classical piano"},{"genre":"zespol dzieciecy"},{"genre":"copla"},{"genre":"kodomo no ongaku"},{"genre":"musica popular mineira"},{"genre":"musica maranhense"},{"genre":"drift"},{"genre":"swiss hip hop"},{"genre":"hokkaido indie"},{"genre":"fremantle indie"},{"genre":"bogor indie"},{"genre":"early music ensemble"},{"genre":"kurdish folk"},{"genre":"uk post-hardcore"},{"genre":"chinese minyao"},{"genre":"singing bowl"},{"genre":"danish alternative rock"},{"genre":"kenyan r&b"},{"genre":"alternative ccm"},{"genre":"folklore boliviano"},{"genre":"soukous"},{"genre":"huayno peruano"},{"genre":"blackgaze"},{"genre":"military rap"},{"genre":"cumbia surena"},{"genre":"psychedelic doom"},{"genre":"south african jazz"},{"genre":"musica juiz-forana"},{"genre":"instrumental bluegrass"},{"genre":"neue volksmusik"},{"genre":"chopped and screwed"},{"genre":"norwegian trap"},{"genre":"israeli folk"},{"genre":"instrumental math rock"},{"genre":"fidget house"},{"genre":"funky tech house"},{"genre":"beach house"},{"genre":"malaysian hip hop"},{"genre":"german jazz rap"},{"genre":"taiwan idol pop"},{"genre":"uk desi rap"},{"genre":"oriental metal"},{"genre":"rajasthani pop"},{"genre":"ukrainian electronic"},{"genre":"electro dub"},{"genre":"japanese ska"},{"genre":"irish metal"},{"genre":"jirai kei"},{"genre":"new tribe"},{"genre":"lo-fi brasileiro"},{"genre":"turntablism"},{"genre":"new england emo"},{"genre":"latincore"},{"genre":"jumpstyle"},{"genre":"hauntology"},{"genre":"zouglou"},{"genre":"igbo pop"},{"genre":"french indie folk"},{"genre":"dreamgaze"},{"genre":"arkansas hip hop"},{"genre":"children's choir"},{"genre":"riddim dubstep"},{"genre":"olympia wa indie"},{"genre":"korean singer-songwriter"},{"genre":"orthodox chant"},{"genre":"new delhi indie"},{"genre":"hong kong rock"},{"genre":"dc hardcore"},{"genre":"elektropunk"},{"genre":"melbourne indie"},{"genre":"rock viet"},{"genre":"viet remix"},{"genre":"chanson virale"},{"genre":"north carolina indie"},{"genre":"luk thung"},{"genre":"corridos cristianos"},{"genre":"garage pop"},{"genre":"scottish metal"},{"genre":"hard motivation"},{"genre":"norwegian jazz"},{"genre":"bluegrass gospel"},{"genre":"motivation"},{"genre":"electro trash"},{"genre":"musica canaria"},{"genre":"russian ska"},{"genre":"chanson quebecois"},{"genre":"instrumental acoustic guitar"},{"genre":"progressive trance house"},{"genre":"trinibad"},{"genre":"piratenmuziek"},{"genre":"speed garage"},{"genre":"swedish heavy metal"},{"genre":"clean comedy"},{"genre":"japanese jazz"},{"genre":"bolobedu house"},{"genre":"greek indie"},{"genre":"nyhc"},{"genre":"spanish synthpop"},{"genre":"balearic"},{"genre":"reunion pop"},{"genre":"doujin"},{"genre":"hindustani classical"},{"genre":"downtempo bass"},{"genre":"latin ska"},{"genre":"early synthpop"},{"genre":"azeri traditional"},{"genre":"western americana"},{"genre":"hard industrial techno"},{"genre":"bounce"},{"genre":"hip hop timur"},{"genre":"classic portuguese pop"},{"genre":"peruvian indie"},{"genre":"auteur-compositeur-interprete quebecois"},{"genre":"shojo"},{"genre":"oceania soundtrack"},{"genre":"minimal wave"},{"genre":"belgian techno"},{"genre":"cuban rumba"},{"genre":"cumbia editada"},{"genre":"indie platense"},{"genre":"classic nz pop"},{"genre":"adoracion pentecostal"},{"genre":"deep smooth jazz"},{"genre":"korean dream pop"},{"genre":"brass band"},{"genre":"polish metal"},{"genre":"hel"},{"genre":"florida death metal"},{"genre":"talentkonkurranse"},{"genre":"ambient idm"},{"genre":"italian lounge"},{"genre":"techno rave"},{"genre":"future bounce"},{"genre":"acid techno"},{"genre":"ballroom"},{"genre":"hong kong hip hop"},{"genre":"queercore"},{"genre":"musica criolla"},{"genre":"bornesange"},{"genre":"classic k-pop"},{"genre":"musica instrumental cristiana"},{"genre":"euskal musica"},{"genre":"musical advocacy"},{"genre":"straight edge"},{"genre":"opera"},{"genre":"thai teen pop"},{"genre":"cdmx indie"},{"genre":"scottish folk"},{"genre":"freak folk"},{"genre":"progressive uplifting trance"},{"genre":"kawaii edm"},{"genre":"guitarra mexicana"},{"genre":"canto popular uruguayo"},{"genre":"french baroque"},{"genre":"cha-cha-cha"},{"genre":"utopian virtual"},{"genre":"dakke dak"},{"genre":"danseband"},{"genre":"rap underground colombiano"},{"genre":"channel islands indie"},{"genre":"orebro indie"},{"genre":"experimental bass"},{"genre":"french folk pop"},{"genre":"chinese drama ost"},{"genre":"salsa cubana"},{"genre":"acid jazz"},{"genre":"sudanese pop"},{"genre":"southern soul blues"},{"genre":"power-pop punk"},{"genre":"cape town indie"},{"genre":"brutal deathcore"},{"genre":"progressive sludge"},{"genre":"nuevo folklore argentino"},{"genre":"philly drill"},{"genre":"classic progressive house"},{"genre":"comptine"},{"genre":"african-american classical"},{"genre":"native american contemporary"},{"genre":"doomgaze"},{"genre":"black thrash"},{"genre":"folklore peruano"},{"genre":"dutch singer-songwriter"},{"genre":"chinese manyao"},{"genre":"louisville indie"},{"genre":"nerdcore"},{"genre":"london indie"},{"genre":"orlando indie"},{"genre":"zikir"},{"genre":"brazilian thrash metal"},{"genre":"brazilian punk rock"},{"genre":"stride"},{"genre":"contemporary gospel"},{"genre":"tech trance"},{"genre":"harpsichord"},{"genre":"trap metal italiana"},{"genre":"reggae catala"},{"genre":"classic japanese jazz"},{"genre":"turkce remix"},{"genre":"synth punk"},{"genre":"musica andina chilena"},{"genre":"telugu folk"},{"genre":"neo-progressive"},{"genre":"canzone genovese"},{"genre":"tin pan alley"},{"genre":"japanese math rock"},{"genre":"italian power metal"},{"genre":"jump blues"},{"genre":"west coast trap"},{"genre":"calypso"},{"genre":"ethiopian pop"},{"genre":"new england americana"},{"genre":"renaissance"},{"genre":"morna"},{"genre":"rabindra sangeet"},{"genre":"avant-garde metal"},{"genre":"sgija"},{"genre":"gbvfi"},{"genre":"desert blues"},{"genre":"musique urbaine kinshasa"},{"genre":"german post-hardcore"},{"genre":"argentine ambient"},{"genre":"mashup"},{"genre":"afrobeat brasileiro"},{"genre":"space ambient"},{"genre":"classic nepali pop"},{"genre":"swiss metal"},{"genre":"rap motywacja"},{"genre":"modern ska punk"},{"genre":"arabic jazz"},{"genre":"french worship"},{"genre":"welsh indie"},{"genre":"anarcho-punk"},{"genre":"antilliaanse rap"},{"genre":"rebetiko"},{"genre":"spacewave"},{"genre":"japanese rockabilly"},{"genre":"glasgow indie"},{"genre":"jazz trombone"},{"genre":"dark hardcore"},{"genre":"canadian indie folk"},{"genre":"sevillanas"},{"genre":"hard alternative"},{"genre":"toronto rap"},{"genre":"japanese jazz fusion"},{"genre":"kasi rap"},{"genre":"russian alternative rock"},{"genre":"asheville indie"},{"genre":"forro tradicional"},{"genre":"528hz"},{"genre":"kabyle"},{"genre":"german show tunes"},{"genre":"musik anak-anak"},{"genre":"cowpunk"},{"genre":"kannada pop"},{"genre":"nu skool breaks"},{"genre":"necrotrap"},{"genre":"chanson humoristique"},{"genre":"plugg francais"},{"genre":"classical guitar"},{"genre":"german jazz"},{"genre":"cedm"},{"genre":"porro"},{"genre":"plena uruguaya"},{"genre":"trap maroc"},{"genre":"lo-fi latino"},{"genre":"rap angolano"},{"genre":"musica nicaraguense"},{"genre":"carimbo"},{"genre":"melanesian pop"},{"genre":"taiwan punk"},{"genre":"balochi pop"},{"genre":"egg punk"},{"genre":"estonian pop"},{"genre":"rogaland musikk"},{"genre":"popgaze"},{"genre":"italian folk metal"},{"genre":"danish modern jazz"},{"genre":"russian metalcore"},{"genre":"ecuadorian indie"},{"genre":"irish indie rock"},{"genre":"rap criolo"},{"genre":"american post-punk"},{"genre":"indie cordoba"},{"genre":"nordic folk"},{"genre":"socal indie"},{"genre":"metal mineiro"},{"genre":"fussball"},{"genre":"anime drill"},{"genre":"japanese jazztronica"},{"genre":"nordic folk metal"},{"genre":"brazilian progressive metal"},{"genre":"vancouver punk"},{"genre":"oi"},{"genre":"children's story"},{"genre":"arab folk"},{"genre":"streektaal"},{"genre":"bulgarian trap"},{"genre":"belgian singer-songwriter"},{"genre":"queer country"},{"genre":"indie curitibano"},{"genre":"chinese indie rock"},{"genre":"kyrgyz hip hop"},{"genre":"italian progressive rock"},{"genre":"cuatro venezolano"},{"genre":"vgm instrumental"},{"genre":"seemannslieder"},{"genre":"suomirap"},{"genre":"k-pop reality show"},{"genre":"rap italiano old school"},{"genre":"finnish classical"},{"genre":"underground rap"},{"genre":"hyperpop brasileiro"},{"genre":"mexican metal"},{"genre":"musica sarda"},{"genre":"men chika"},{"genre":"manso indie"},{"genre":"russian indie rock"},{"genre":"danish indie pop"},{"genre":"kundiman"},{"genre":"dungeon synth"},{"genre":"sinhala indie"},{"genre":"frankfurt electronic"},{"genre":"nashville americana"},{"genre":"malaysian tamil pop"},{"genre":"balkan brass"},{"genre":"metal guitar"},{"genre":"polish post-punk"},{"genre":"hip hop cubano"},{"genre":"mbalax"},{"genre":"boy pop"},{"genre":"tekno"},{"genre":"vintage dutch pop"},{"genre":"goregrind"},{"genre":"czsk viral pop"},{"genre":"brazilian groove metal"},{"genre":"gainesville indie"},{"genre":"bolero cubano"},{"genre":"classic greek rock"},{"genre":"latvian pop"},{"genre":"ritmo kombina"},{"genre":"nz electronic"},{"genre":"persian electronic"},{"genre":"spanish classical"},{"genre":"dayton indie"},{"genre":"electro-industrial"},{"genre":"irish indie"},{"genre":"japanese power metal"},{"genre":"bayerischer rap"},{"genre":"argentine indie rock"},{"genre":"soulful house"},{"genre":"turkce trap metal"},{"genre":"keroncong"},{"genre":"progressive death metal"},{"genre":"mallsoft"},{"genre":"elephant 6"},{"genre":"israeli trap"},{"genre":"bulgarian hip hop"},{"genre":"man's orchestra"},{"genre":"ulkucu sarkilar"},{"genre":"marathi traditional"},{"genre":"avant-garde jazz"},{"genre":"folklore paraguayo"},{"genre":"world chill"},{"genre":"indie shoegaze"},{"genre":"spanish invasion"},{"genre":"south african deep house"},{"genre":"cambridgeshire indie"},{"genre":"merengue tipico"},{"genre":"bali indie"},{"genre":"country quebecois"},{"genre":"tropical tecladista"},{"genre":"chicago pop punk"},{"genre":"ska jazz"},{"genre":"gothabilly"},{"genre":"japanese celtic"},{"genre":"cristiana para ninos"},{"genre":"nova canco"},{"genre":"north carolina emo"},{"genre":"german boom bap"},{"genre":"post-post-hardcore"},{"genre":"t-pop girl group"},{"genre":"drill and bass"},{"genre":"avant-garde"},{"genre":"canadian house"},{"genre":"jamaican ska"},{"genre":"huayno popular"},{"genre":"accordion"},{"genre":"louvores pentecostais"},{"genre":"swedish electronic"},{"genre":"mega funk"},{"genre":"belgian dnb"},{"genre":"french dub"},{"genre":"funky breaks"},{"genre":"vietnamese bolero"},{"genre":"slovak trap"},{"genre":"vaqueiro"},{"genre":"rosary"},{"genre":"cueca chilena"},{"genre":"new orleans funk"},{"genre":"new wave of thrash metal"},{"genre":"latin tech house"},{"genre":"classic anime"},{"genre":"cambodian pop"},{"genre":"christchurch indie"},{"genre":"czech singer-songwriter"},{"genre":"electronic djent"},{"genre":"british orchestra"},{"genre":"japanese post-rock"},{"genre":"danish indie"},{"genre":"industrial pop"},{"genre":"rap inde"},{"genre":"space rock"},{"genre":"sudanese hip hop"},{"genre":"fallen angel"},{"genre":"early reggae"},{"genre":"folclor afrocolombiano"},{"genre":"family gospel"},{"genre":"deep dnb"},{"genre":"ethio-jazz"},{"genre":"belarusian pop"},{"genre":"proto-techno"},{"genre":"congolese gospel"},{"genre":"gengetone"},{"genre":"italian jazz"},{"genre":"hokkien pop"},{"genre":"pop cristiano"},{"genre":"progressive power metal"},{"genre":"dutch dnb"},{"genre":"tipico"},{"genre":"medieval"},{"genre":"voidgaze"},{"genre":"kizomba antigas"},{"genre":"experimental folk"},{"genre":"full on"},{"genre":"thai ost"},{"genre":"icelandic folk"},{"genre":"swedish doom metal"},{"genre":"greek metal"},{"genre":"folklore nuevo argentino"},{"genre":"tamborazo"},{"genre":"cincinnati rap"},{"genre":"mappila paattu"},{"genre":"hard techno"},{"genre":"classic finnish rock"},{"genre":"folclore tucumano"},{"genre":"lds instrumental"},{"genre":"bajki"},{"genre":"romanian rock"},{"genre":"post-doom metal"},{"genre":"cumbia boliviana"},{"genre":"son cubano"},{"genre":"c86"},{"genre":"modern funk"},{"genre":"irish electronic"},{"genre":"indie dream pop"},{"genre":"tamil worship"},{"genre":"neru"},{"genre":"persian rock"},{"genre":"danish electropop"},{"genre":"depressive black metal"},{"genre":"norwegian folk rock"},{"genre":"old-time"},{"genre":"irish pub song"},{"genre":"autonomous black metal"},{"genre":"football"},{"genre":"j-core"},{"genre":"dublin indie"},{"genre":"korean electropop"},{"genre":"nz singer-songwriter"},{"genre":"rap liegeois"},{"genre":"instrumental djent"},{"genre":"zamba"},{"genre":"danish jazz"},{"genre":"choral"},{"genre":"pop ambient"},{"genre":"downtempo deathcore"},{"genre":"turkish punk"},{"genre":"puerto rican folk"},{"genre":"coupe-decale"},{"genre":"traditional soul"},{"genre":"australian metal"},{"genre":"german heavy metal"},{"genre":"old west"},{"genre":"ilahiler"},{"genre":"crust punk"},{"genre":"operetta"},{"genre":"musica santomense"},{"genre":"classic sinhala pop"},{"genre":"black punk"},{"genre":"sydney indie"},{"genre":"phleng phuea chiwit"},{"genre":"adoracion"},{"genre":"irish post-punk"},{"genre":"slovak punk"},{"genre":"semba"},{"genre":"commons"},{"genre":"okc indie"},{"genre":"zen"},{"genre":"musica ayacuchana"},{"genre":"finnish punk"},{"genre":"kc indie"},{"genre":"ska espanol"},{"genre":"yaoi"},{"genre":"hard trance"},{"genre":"melodic hard rock"},{"genre":"coral gospel"},{"genre":"nz indie"},{"genre":"rap kreyol"},{"genre":"garage house"},{"genre":"gqom"},{"genre":"jazz mexicano"},{"genre":"uk dub"},{"genre":"turin indie"},{"genre":"psychokore"},{"genre":"indonesian indie pop"},{"genre":"svensk progg"},{"genre":"thai pop rap"},{"genre":"forro gospel"},{"genre":"munich indie"},{"genre":"ugandan pop"},{"genre":"kizomba cabo-verdiana"},{"genre":"sichuanese hip hop"},{"genre":"modern old-time"},{"genre":"canadian modern jazz"},{"genre":"musique guadeloupe"},{"genre":"swedish black metal"},{"genre":"cypriot pop"},{"genre":"vancouver metal"},{"genre":"jazz clarinet"},{"genre":"finnish hard rock"},{"genre":"musica tabasquena"},{"genre":"audiophile vocal"},{"genre":"modular synth"},{"genre":"arunachal indie"},{"genre":"slow game"},{"genre":"polish blues"},{"genre":"krautrock"},{"genre":"nwocr"},{"genre":"nagpuri pop"},{"genre":"japanese underground rap"},{"genre":"omaha indie"},{"genre":"tunisian pop"},{"genre":"vintage tango"},{"genre":"folkmusik"},{"genre":"palestinian pop"},{"genre":"viola caipira"},{"genre":"dutch indie rock"},{"genre":"korean underground rap"},{"genre":"outsider"},{"genre":"modern jungle"},{"genre":"musica para criancas"},{"genre":"israeli indie"},{"genre":"musica capixaba"},{"genre":"symphonic death metal"},{"genre":"connecticut hardcore"},{"genre":"canadian garage rock"},{"genre":"lagu sunda"},{"genre":"musica jalisciense"},{"genre":"kyushu indie"},{"genre":"ukrainian folk rock"},{"genre":"rumeli turkuleri"},{"genre":"library music"},{"genre":"modern uplift"},{"genre":"midwest americana"},{"genre":"german country"},{"genre":"musica sudcaliforniana"},{"genre":"tulsa indie"},{"genre":"gypsy punk"},{"genre":"vietnamese pop"},{"genre":"rock alternatif francais"},{"genre":"dalarna indie"},{"genre":"british contemporary classical"},{"genre":"miami indie"},{"genre":"outsider house"},{"genre":"draga"},{"genre":"buffalo ny metal"},{"genre":"victorian britain"},{"genre":"ukrainian post-punk"},{"genre":"oshare kei"},{"genre":"swedish synth"},{"genre":"french punk"},{"genre":"nephop"},{"genre":"heavy alternative"},{"genre":"deep german indie"},{"genre":"thai bl ost"},{"genre":"symfonicky orchestr"},{"genre":"rap capixaba"},{"genre":"neue deutsche todeskunst"},{"genre":"rock chapin"},{"genre":"brazilian hardcore"},{"genre":"reggae peruano"},{"genre":"modern goth"},{"genre":"native american flute"},{"genre":"aussie emo"},{"genre":"okinawan folk"},{"genre":"greek house"},{"genre":"dutch trap"},{"genre":"cover acustico"},{"genre":"classic icelandic pop"},{"genre":"blaskapelle"},{"genre":"hiplife"},{"genre":"funana"},{"genre":"atlanta punk"},{"genre":"uk worship"},{"genre":"blasmusik"},{"genre":"granada indie"},{"genre":"mandolin"},{"genre":"zimdancehall"},{"genre":"hardtekk"},{"genre":"swedish punk"},{"genre":"mestissatge"},{"genre":"funk evangelico"},{"genre":"salsa urbana"},{"genre":"musica madeirense"},{"genre":"musica crista reformada"},{"genre":"finnish indie"},{"genre":"british country"},{"genre":"tibetan pop"},{"genre":"bleep techno"},{"genre":"trondersk musikk"},{"genre":"atmospheric dnb"},{"genre":"nordic post-rock"},{"genre":"dusseldorf electronic"},{"genre":"musiikkia lapsille"},{"genre":"corrosion"},{"genre":"baiao"},{"genre":"hungarian folk"},{"genre":"chinese traditional"},{"genre":"beat italiano"},{"genre":"chamame"},{"genre":"traditional folk"},{"genre":"persian melodic rap"},{"genre":"canterbury scene"},{"genre":"pop costarricense"},{"genre":"croatian hip hop"},{"genre":"musica tropical guatemalteca"},{"genre":"glitch pop"},{"genre":"persian alternative"},{"genre":"rap paranaense"},{"genre":"duluth indie"},{"genre":"russian synthpop"},{"genre":"samurai trap"},{"genre":"japanese vocal jazz"},{"genre":"grimewave"},{"genre":"russian trance"},{"genre":"trival"},{"genre":"slovenian pop"},{"genre":"coco"},{"genre":"technical groove metal"},{"genre":"austrian hip hop"},{"genre":"swing italiano"},{"genre":"dark progressive house"},{"genre":"scouse rap"},{"genre":"vaportrap"},{"genre":"hammond organ"},{"genre":"maimouna"},{"genre":"japanese contemporary classical"},{"genre":"dissonant death metal"},{"genre":"shimmer psych"},{"genre":"gothic americana"},{"genre":"experimental house"},{"genre":"deep adult standards"},{"genre":"japanese guitar"},{"genre":"andean flute"},{"genre":"marathi devotional"},{"genre":"trio huasteco"},{"genre":"austin hip hop"},{"genre":"mecha"},{"genre":"instrumental stoner rock"},{"genre":"pinoy alternative rock"},{"genre":"instrumental surf"},{"genre":"ghanaian gospel"},{"genre":"swamp pop"},{"genre":"brass band pop"},{"genre":"haitian gospel"},{"genre":"deep latin alternative"},{"genre":"munich electronic"},{"genre":"432hz"},{"genre":"kentucky punk"},{"genre":"naat"},{"genre":"musica istmena"},{"genre":"german indie pop"},{"genre":"telugu indie"},{"genre":"russian plugg"},{"genre":"neapolitan funk"},{"genre":"austrian indie"},{"genre":"deep techno"},{"genre":"bath indie"},{"genre":"icelandic electronic"},{"genre":"modern cello"},{"genre":"eugene indie"},{"genre":"plunderphonics"},{"genre":"musica andina colombiana"},{"genre":"spanish reggae"},{"genre":"dark jazz"},{"genre":"mongolian alternative"},{"genre":"rennes indie"},{"genre":"long island punk"},{"genre":"christian hardcore"},{"genre":"kora"},{"genre":"jazz metal"},{"genre":"canadian hardcore"},{"genre":"spanish folk rock"},{"genre":"manitoba indie"},{"genre":"balkan drill"},{"genre":"freeform hardcore"},{"genre":"technical thrash"},{"genre":"48g"},{"genre":"bass music"},{"genre":"denton tx indie"},{"genre":"nz children's music"},{"genre":"drone folk"},{"genre":"german thrash metal"},{"genre":"zillertal"},{"genre":"latvian hip hop"},{"genre":"greek downtempo"},{"genre":"eventyr"},{"genre":"emo punk"},{"genre":"russian folk"},{"genre":"retro metal"},{"genre":"post-black metal"},{"genre":"japanese blues"},{"genre":"piedmont blues"},{"genre":"vintage hollywood"},{"genre":"ambient psychill"},{"genre":"kentucky metal"},{"genre":"singeli"},{"genre":"choro"},{"genre":"swiss house"},{"genre":"nordnorsk musikk"},{"genre":"nova musica paulista"},{"genre":"string duo"},{"genre":"indian underground rap"},{"genre":"nuevo flamenco"},{"genre":"armenian pop"},{"genre":"indy indie"},{"genre":"brazilian power metal"},{"genre":"musica indigena latinoamericana"},{"genre":"breakcore"},{"genre":"new orleans soul"},{"genre":"korean indie folk"},{"genre":"deathrock"},{"genre":"lagu bali"},{"genre":"classic dutch pop"},{"genre":"jazz double bass"},{"genre":"modern enka"},{"genre":"amharic pop"},{"genre":"south african choral"},{"genre":"indie emo"},{"genre":"russian trap metal"},{"genre":"gothic black metal"},{"genre":"emo trap italiana"},{"genre":"musica baiana"},{"genre":"turkish metal"},{"genre":"swing revival"},{"genre":"deep christian rock"},{"genre":"indonesian psychedelia"},{"genre":"swedish house"},{"genre":"rumba catalana"},{"genre":"jazz drums"},{"genre":"pittsburgh rock"},{"genre":"musica eletronica gospel"},{"genre":"phoenix indie"},{"genre":"spanish post-punk"},{"genre":"charlotte nc indie"},{"genre":"darkstep"},{"genre":"multidisciplinary"},{"genre":"ambient post-rock"},{"genre":"kaneka"},{"genre":"connecticut indie"},{"genre":"arab groove"},{"genre":"charanga"},{"genre":"kolkata indie"},{"genre":"cantautor catala"},{"genre":"tampa indie"},{"genre":"dutch prog"},{"genre":"geek rock"},{"genre":"seinen"},{"genre":"rhode island indie"},{"genre":"denver indie"},{"genre":"spanish noise pop"},{"genre":"german indie rock"},{"genre":"virginia punk"},{"genre":"italian trance"},{"genre":"rap ivoire"},{"genre":"vocal trance"},{"genre":"jackin' house"},{"genre":"speed house"},{"genre":"indie valenciana"},{"genre":"warm drone"},{"genre":"villancicos"},{"genre":"sepedi pop"},{"genre":"reggae maghreb"},{"genre":"igbo rap"},{"genre":"deep funk ostentacao"},{"genre":"bard"},{"genre":"swamp blues"},{"genre":"vermont indie"},{"genre":"musica feirense"},{"genre":"new mexico music"},{"genre":"zilizopendwa"},{"genre":"indie rock peruano"},{"genre":"folklore chileno"},{"genre":"deep soft rock"},{"genre":"tamil devotional"},{"genre":"korean trap"},{"genre":"japanese garage rock"},{"genre":"belarusian electronic"},{"genre":"musica quintanarroense"},{"genre":"british dance band"},{"genre":"jesus movement"},{"genre":"deep norteno"},{"genre":"alabama metal"},{"genre":"galician rock"},{"genre":"deep soundtrack"},{"genre":"classic luk thung"},{"genre":"indie siciliano"},{"genre":"tatar pop"},{"genre":"neo-pagan"},{"genre":"leeds indie"},{"genre":"cincinnati indie"},{"genre":"oud"},{"genre":"christian a cappella"},{"genre":"twoubadou"},{"genre":"deep happy hardcore"},{"genre":"british black metal"},{"genre":"japanese dream pop"},{"genre":"sambalpuri pop"},{"genre":"lapland metal"},{"genre":"hungarian edm"},{"genre":"musica afroperuana"},{"genre":"nueva trova chilena"},{"genre":"brisbane hip hop"},{"genre":"hexd"},{"genre":"ambient techno"},{"genre":"funk capixaba"},{"genre":"ai"},{"genre":"vincy soca"},{"genre":"paraguayan rock"},{"genre":"punk chileno"},{"genre":"kurdish remix"},{"genre":"slovenian electronic"},{"genre":"kent indie"},{"genre":"canadian indigenous music"},{"genre":"persian underground hip hop"},{"genre":"korean worship"},{"genre":"jazz cubano"},{"genre":"musica popular uruguaya"},{"genre":"chant religieux"},{"genre":"bristol electronic"},{"genre":"classic hungarian pop"},{"genre":"straight-ahead jazz"},{"genre":"polish indie rock"},{"genre":"british death metal"},{"genre":"telugu devotional"},{"genre":"neo metal"},{"genre":"underground amapiano"},{"genre":"marimba orquesta"},{"genre":"cyber metal"},{"genre":"deep uplifting trance"},{"genre":"dub techno"},{"genre":"neurostep"},{"genre":"pinoy praise"},{"genre":"portland punk"},{"genre":"new orleans indie"},{"genre":"rare groove"},{"genre":"acidcore"},{"genre":"brazilian percussion"},{"genre":"wu fam"},{"genre":"gyerekdalok"},{"genre":"hardstyle"},{"genre":"ghettotech"},{"genre":"classic azeri pop"},{"genre":"spiritual hip hop"},{"genre":"skramz"},{"genre":"jazz worship"},{"genre":"lagu bugis"},{"genre":"polish black metal"},{"genre":"melodipop"},{"genre":"nice indie"},{"genre":"vienna indie"},{"genre":"louvor icm"},{"genre":"malayalam indie"},{"genre":"sinhala rap"},{"genre":"rap femenino mexicano"},{"genre":"dub reggae"},{"genre":"fort worth indie"},{"genre":"hamburg indie"},{"genre":"indie cristao"},{"genre":"waiata maori"},{"genre":"classic romanian pop"},{"genre":"ohio indie"},{"genre":"australian ska"},{"genre":"vintage swedish pop"},{"genre":"harp"},{"genre":"portuguese indie"},{"genre":"hindustani vocal"},{"genre":"griot"},{"genre":"slack-key guitar"},{"genre":"minimal dub"},{"genre":"musica mixteca"},{"genre":"gospel drill"},{"genre":"raboday"},{"genre":"neotango"},{"genre":"taiwan campus folk"},{"genre":"spanish folk"},{"genre":"german literature"},{"genre":"danish post-punk"},{"genre":"german opera"},{"genre":"koligeet"},{"genre":"alberta hip hop"},{"genre":"nz folk"},{"genre":"campursari"},{"genre":"welsh hip hop"},{"genre":"pakistani rock"},{"genre":"stockholm indie"},{"genre":"powerviolence"},{"genre":"dark folk"},{"genre":"belarusian rock"},{"genre":"chasidic pop"},{"genre":"viral pop brasileiro"},{"genre":"funk mexicano"},{"genre":"pennsylvania hardcore"},{"genre":"jordanian pop"},{"genre":"gothenburg hip hop"},{"genre":"chinese classical piano"},{"genre":"orquesta tipica"},{"genre":"uyghur pop"},{"genre":"taiwanese indie"},{"genre":"sound art"},{"genre":"progressive doom"},{"genre":"lithuanian hip hop"},{"genre":"tinku"},{"genre":"texas hardcore"},{"genre":"bangladeshi rock"},{"genre":"charlottesville indie"},{"genre":"musiqi-ye zanan"},{"genre":"kazakh indie"},{"genre":"schranz"},{"genre":"punk euskera"},{"genre":"utah indie"},{"genre":"spa"},{"genre":"beatboxing"},{"genre":"soviet synthpop"},{"genre":"bay area hip hop"},{"genre":"western mass indie"},{"genre":"swedish stoner rock"},{"genre":"dunedin indie"},{"genre":"nl folk"},{"genre":"melodic power metal"},{"genre":"beatdown"},{"genre":"miami metal"},{"genre":"novo rock gaucho"},{"genre":"japanese heavy metal"},{"genre":"classic hungarian rock"},{"genre":"norwegian alternative rock"},{"genre":"guinean pop"},{"genre":"pakistani electronic"},{"genre":"guided meditation"},{"genre":"birmingham indie"},{"genre":"czech metal"},{"genre":"cape verdean folk"},{"genre":"jazz organ"},{"genre":"cinematic post-rock"},{"genre":"world meditation"},{"genre":"christian hard rock"},{"genre":"lexington ky indie"},{"genre":"chinese talent show"},{"genre":"vocaloid metal"},{"genre":"montenegrin pop"},{"genre":"beats"},{"genre":"detroit house"},{"genre":"windsor on indie"},{"genre":"german tech house"},{"genre":"histoire pour enfants"},{"genre":"black 'n' roll"},{"genre":"taiwan rock"},{"genre":"rock keyboard"},{"genre":"pop paraguayo"},{"genre":"czech country"},{"genre":"footwork"},{"genre":"smooth soul"},{"genre":"west australian hip hop"},{"genre":"chinese classical performance"},{"genre":"experimental jazz"},{"genre":"louisiana metal"},{"genre":"bouyon"},{"genre":"new orleans americana"},{"genre":"ukrainian edm"},{"genre":"bisaya rap"},{"genre":"dubsteppe"},{"genre":"tunantada"},{"genre":"telugu worship"},{"genre":"guatemalan pop"},{"genre":"hamilton on indie"},{"genre":"norsk lovsang"},{"genre":"hyperpop italiano"},{"genre":"maine indie"},{"genre":"thai post-rock"},{"genre":"uk bass"},{"genre":"musica paraibana"},{"genre":"progressive alternative"},{"genre":"musique militaire"},{"genre":"tennessee metal"},{"genre":"venda pop"},{"genre":"indie napoletano"},{"genre":"college a cappella"},{"genre":"melodic black metal"},{"genre":"american grindcore"},{"genre":"polish jazz"},{"genre":"bhojpuri folk"},{"genre":"exotica"},{"genre":"nz christian"},{"genre":"scottish techno"},{"genre":"truck-driving country"},{"genre":"synth prog"},{"genre":"musica guerrerense"},{"genre":"bardcore"},{"genre":"comedia"},{"genre":"experimental indie"},{"genre":"epunk"},{"genre":"gospel rap"},{"genre":"neo-rockabilly"},{"genre":"dancehall colombiano"},{"genre":"kenyan hip hop"},{"genre":"japanese indie folk"},{"genre":"neofolk"},{"genre":"folclore jujeno"},{"genre":"icelandic hip hop"},{"genre":"hungarian metal"},{"genre":"ghent indie"},{"genre":"oulu metal"},{"genre":"dallas indie"},{"genre":"bouzouki"},{"genre":"jazzy dnb"},{"genre":"chinese audiophile"},{"genre":"power blues-rock"},{"genre":"polish electronica"},{"genre":"canadian blues"},{"genre":"british comedy"},{"genre":"afro house angolano"},{"genre":"musica cabo-verdiana"},{"genre":"alt-idol"},{"genre":"schweizer rap"},{"genre":"technical deathcore"},{"genre":"musica infantil catala"},{"genre":"anglican liturgy"},{"genre":"lampung indie"},{"genre":"afghan rap"},{"genre":"polish death metal"},{"genre":"sound effects"},{"genre":"piano mpb"},{"genre":"scottish hush"},{"genre":"black comedy"},{"genre":"trance mexicano"},{"genre":"polca paraguaya"},{"genre":"greek swing"},{"genre":"japanese beats"},{"genre":"tamaulipas indie"},{"genre":"cornetas y tambores"},{"genre":"north moroccan rap"},{"genre":"voetbal"},{"genre":"indonesian hardcore"},{"genre":"brisbane punk"},{"genre":"background jazz product"},{"genre":"malawian pop"},{"genre":"dub brasileiro"},{"genre":"irish neo-traditional"},{"genre":"italian gothic"},{"genre":"italian gothic metal"},{"genre":"musica catarinense"},{"genre":"muzica etno"},{"genre":"spytrack"},{"genre":"zcc"},{"genre":"punk cover"},{"genre":"chinese worship"},{"genre":"png pop"},{"genre":"spanish indie folk"},{"genre":"syrian hip hop"},{"genre":"guitarra andina"},{"genre":"lagu aceh"},{"genre":"zambian hip hop"},{"genre":"gospel reggae"},{"genre":"lebanese indie"},{"genre":"tamil indie"},{"genre":"ukulele"},{"genre":"dutch moombahton"},{"genre":"psychedelic folk rock"},{"genre":"musica yucateca"},{"genre":"polynesian hip hop"},{"genre":"cartoni animati"},{"genre":"thall"},{"genre":"chakra"},{"genre":"charango"},{"genre":"christian power metal"},{"genre":"british choir"},{"genre":"brazilian ska"},{"genre":"raggatek"},{"genre":"folklore venezolano"},{"genre":"jain bhajan"},{"genre":"slavic folk metal"},{"genre":"psychedelic punk"},{"genre":"ok indie"},{"genre":"fan chant"},{"genre":"detroit techno"},{"genre":"austin metal"},{"genre":"austrian dnb"},{"genre":"grebo"},{"genre":"bandoneon"},{"genre":"austrian metal"},{"genre":"candomble"},{"genre":"c-pop girl group"},{"genre":"broken transmission"},{"genre":"sunnlensk tonlist"},{"genre":"ramonescore"},{"genre":"instrumental progressive metal"},{"genre":"musica bautista"},{"genre":"sorani pop"},{"genre":"north carolina metal"},{"genre":"action rock"},{"genre":"sci-fi metal"},{"genre":"mashcore"},{"genre":"italo house"},{"genre":"belgian indie rock"},{"genre":"alpine yodeling"},{"genre":"turkish electronic"},{"genre":"indie folk argentino"},{"genre":"deep acoustic pop"},{"genre":"trinidadian reggae"},{"genre":"lithuanian trap"},{"genre":"deep idm"},{"genre":"cameroonian pop"},{"genre":"er ge"},{"genre":"varmland rock"},{"genre":"chinese folk"},{"genre":"afro-cuban percussion"},{"genre":"slam poetry"},{"genre":"samoan pop"},{"genre":"musica evangelica instrumental"},{"genre":"bush ballad"},{"genre":"atmospheric post-metal"},{"genre":"newfoundland indie"},{"genre":"halftime dnb"},{"genre":"romanian electronic"},{"genre":"marimba de guatemala"},{"genre":"maithili"},{"genre":"chamber folk"},{"genre":"one-person band"},{"genre":"slam death metal"},{"genre":"nwothm"},{"genre":"punk melodico chileno"},{"genre":"kurdish rock"},{"genre":"rochester ny indie"},{"genre":"czech folk rock"},{"genre":"hard house"},{"genre":"tanzanian hip hop"},{"genre":"xitsonga pop"},{"genre":"zambian pop"},{"genre":"armenian hip hop"},{"genre":"spiritual jazz"},{"genre":"austin rock"},{"genre":"york indie"},{"genre":"idaho indie"},{"genre":"gambian hip hop"},{"genre":"deep ragga"},{"genre":"muzica crestina"},{"genre":"musica duranguense"},{"genre":"caucasian classical"},{"genre":"carnaval limburg"},{"genre":"visor"},{"genre":"italian library music"},{"genre":"quebec punk"},{"genre":"trap angolano"},{"genre":"post-disco soul"},{"genre":"oaxaca indie"},{"genre":"boston hardcore"},{"genre":"danish techno"},{"genre":"greek fem rap"},{"genre":"vogue"},{"genre":"rock en asturiano"},{"genre":"bomba y plena"},{"genre":"melbourne punk"},{"genre":"nuevo tango"},{"genre":"german prog"},{"genre":"psych gaze"},{"genre":"corridos adictivos"},{"genre":"tamazight"},{"genre":"modern progressive rock"},{"genre":"british grindcore"},{"genre":"nordic contemporary classical"},{"genre":"vintage chanson"},{"genre":"dc indie"},{"genre":"polish prog"},{"genre":"berlin school"},{"genre":"uk82"},{"genre":"zim urban groove"},{"genre":"moog"},{"genre":"marathi remix"},{"genre":"experimental electronic"},{"genre":"polish synthpop"},{"genre":"sinaloa indie"},{"genre":"death 'n' roll"},{"genre":"persian traditional"},{"genre":"hungarian underground rap"},{"genre":"ska catala"},{"genre":"blues latinoamericano"},{"genre":"makossa"},{"genre":"afro-funk"},{"genre":"dansei seiyu"},{"genre":"southampton indie"},{"genre":"rockabilly en espanol"},{"genre":"rock of gibraltar"},{"genre":"technical melodic death metal"},{"genre":"sami"},{"genre":"cleveland metal"},{"genre":"deep contemporary country"},{"genre":"british post-rock"},{"genre":"jazz vibraphone"},{"genre":"baltic classical"},{"genre":"korean drill"},{"genre":"nz dnb"},{"genre":"scottish hip hop"},{"genre":"canadian underground hip hop"},{"genre":"muzika l'yeladim"},{"genre":"italian electronica"},{"genre":"israelite hip hop"},{"genre":"christmas product"},{"genre":"rosario indie"},{"genre":"mewati pop"},{"genre":"israeli jazz"},{"genre":"norwegian house"},{"genre":"gothic alternative"},{"genre":"tuareg guitar"},{"genre":"asakaa"},{"genre":"musica popular amazonense"},{"genre":"afrikaans hip hop"},{"genre":"appalachian folk"},{"genre":"hardgroove"},{"genre":"scratch"},{"genre":"korean electronic"},{"genre":"flick hop"},{"genre":"slovenian indie"},{"genre":"devon indie"},{"genre":"israeli techno"},{"genre":"accordeon"},{"genre":"malaysian punk"},{"genre":"cosmic post-rock"},{"genre":"jazz catala"},{"genre":"australian ambient"},{"genre":"belgian metal"},{"genre":"music hall"},{"genre":"cruise"},{"genre":"american primitive"},{"genre":"norrlandsk hip hop"},{"genre":"swahili gospel"},{"genre":"korean superband"},{"genre":"usbm"},{"genre":"marwadi pop"},{"genre":"malayalam madh"},{"genre":"khayal"},{"genre":"waiata mo tamariki"},{"genre":"russian ccm"},{"genre":"2-step"},{"genre":"indian electronic"},{"genre":"uk christian rap"},{"genre":"italian renaissance"},{"genre":"rap tico"},{"genre":"classic korean pop"},{"genre":"fijian pop"},{"genre":"martial industrial"},{"genre":"new york death metal"},{"genre":"dancehall chileno"},{"genre":"detskie pesni"},{"genre":"chamber orchestra"},{"genre":"subliminal product"},{"genre":"musica portuguesa contemporanea"},{"genre":"tearout"},{"genre":"emotional black metal"},{"genre":"psicodelia chilena"},{"genre":"cosmic death metal"},{"genre":"fictitious orchestra"},{"genre":"st louis drill"},{"genre":"musique comorienne"},{"genre":"hungarian punk"},{"genre":"chinese indie pop"},{"genre":"vinahouse"},{"genre":"classical cello"},{"genre":"street punk espanol"},{"genre":"swiss trap"},{"genre":"bemani"},{"genre":"rap metal espanol"},{"genre":"orchestral performance"},{"genre":"brazilian modern jazz"},{"genre":"paidika tragoudia"},{"genre":"latmiya"},{"genre":"batida"},{"genre":"puerto rican indie"},{"genre":"sambass"},{"genre":"hungarian classical performance"},{"genre":"folklore uruguayo"},{"genre":"hindustani instrumental"},{"genre":"cook islands pop"},{"genre":"psalmen"},{"genre":"fake"},{"genre":"sitar"},{"genre":"greek contemporary classical"},{"genre":"karaoke"},{"genre":"ecuadorian alternative rock"},{"genre":"palestinian alternative"},{"genre":"israeli classical piano"},{"genre":"dominican indie"},{"genre":"italian punk"},{"genre":"deep gothic post-punk"},{"genre":"math pop"},{"genre":"peruvian punk"},{"genre":"musica michoacana"},{"genre":"neo kyma"},{"genre":"rap feminino chileno"},{"genre":"polyphony"},{"genre":"mumbai indie"},{"genre":"classic italian folk pop"},{"genre":"viking black metal"},{"genre":"wassoulou"},{"genre":"south african underground rap"},{"genre":"ryukyu ongaku"},{"genre":"rap chretien"},{"genre":"yugoslav new wave"},{"genre":"jig and reel"},{"genre":"chaabi marocain"},{"genre":"breton folk"},{"genre":"quebec death metal"},{"genre":"punk catala"},{"genre":"modern psychedelic folk"},{"genre":"chinese soundtrack"},{"genre":"zim hip hop"},{"genre":"tuna"},{"genre":"musica nublensina"},{"genre":"south asian metal"},{"genre":"ukrainian classical piano"},{"genre":"mongolian hip hop"},{"genre":"crack rock steady"},{"genre":"danzon"},{"genre":"kumaoni pop"},{"genre":"malayalam cover"},{"genre":"bomba"},{"genre":"violao classico"},{"genre":"bangladeshi indie"},{"genre":"newcastle indie"},{"genre":"violin"},{"genre":"tassie indie"},{"genre":"bagpipe"},{"genre":"graz indie"},{"genre":"mpb gospel"},{"genre":"australian indigenous hip hop"},{"genre":"sega mauricien"},{"genre":"cumbia cristiana"},{"genre":"rock curitibano"},{"genre":"deep dubstep"},{"genre":"garage punk"},{"genre":"spanish techno"},{"genre":"balkan punk"},{"genre":"ambient synth"},{"genre":"french garage rock"},{"genre":"warrington indie"},{"genre":"khortha pop"},{"genre":"portland metal"},{"genre":"gospel singers"},{"genre":"rva indie"},{"genre":"uwielbienie"},{"genre":"goralski"},{"genre":"eritrean pop"},{"genre":"slavic metal"},{"genre":"taiwan instrumental"},{"genre":"garage punk blues"},{"genre":"vegan straight edge"},{"genre":"mandible"},{"genre":"clap and tap"},{"genre":"buffalo ny indie"},{"genre":"remix product"},{"genre":"japanese boom bap"},{"genre":"christian dance"},{"genre":"kids hip hop"},{"genre":"salsa cristiana"},{"genre":"deep disco"},{"genre":"swedish hardcore"},{"genre":"bahai"},{"genre":"musique pour enfant quebecois"},{"genre":"ukrainian folk pop"},{"genre":"macedonian pop"},{"genre":"lafayette indie"},{"genre":"igbo trap"},{"genre":"chhattisgarhi pop"},{"genre":"gulf hip hop"},{"genre":"memphis americana"},{"genre":"bahamian pop"},{"genre":"shoegaze brasileiro"},{"genre":"cavernous death metal"},{"genre":"new wave of glam metal"},{"genre":"finnish new wave"},{"genre":"lldm"},{"genre":"slushwave"},{"genre":"modern swing"},{"genre":"serbian electronic"},{"genre":"sanfona"},{"genre":"naija old school"},{"genre":"american 21st century classical"},{"genre":"west african jazz"},{"genre":"urban kiz"},{"genre":"japanese melodic punk"},{"genre":"punk rock italiano"},{"genre":"british industrial"},{"genre":"deep progressive rock"},{"genre":"british experimental"},{"genre":"military band"},{"genre":"wrock"},{"genre":"japanese hyperpop"},{"genre":"rogaland indie"},{"genre":"northeast indian indie"},{"genre":"magyar retro dance"},{"genre":"sheilat"},{"genre":"detroit trap en espanol"},{"genre":"dennery segment"},{"genre":"swedish rockabilly"},{"genre":"rap portuense"},{"genre":"kuduro"},{"genre":"detske pisnicky"},{"genre":"deep big room"},{"genre":"japanese psychedelic"},{"genre":"didgeridoo"},{"genre":"irish rebel song"},{"genre":"ambient trance"},{"genre":"uppsala indie"},{"genre":"mississippi indie"},{"genre":"pop catracho"},{"genre":"faroese pop"},{"genre":"rwandan pop"},{"genre":"french black metal"},{"genre":"indonesian underground hip hop"},{"genre":"japanese electronic"},{"genre":"uk beatdown"},{"genre":"ukulele cover"},{"genre":"pornogrind"},{"genre":"new isolationism"},{"genre":"norwegian americana"},{"genre":"musica hondurena"},{"genre":"trio batak"},{"genre":"jazz harp"},{"genre":"panpipe"},{"genre":"cancoes infantis"},{"genre":"swiss folk"},{"genre":"indonesian metal"},{"genre":"jazz brass"},{"genre":"louange"},{"genre":"hmong pop"},{"genre":"comedienne"},{"genre":"manipuri pop"},{"genre":"sonora indie"},{"genre":"german black metal"},{"genre":"argentine metal"},{"genre":"south african soulful deep house"},{"genre":"czsk reggae"},{"genre":"polish folk metal"},{"genre":"solomon islands pop"},{"genre":"concert band"},{"genre":"drill beats"},{"genre":"kansai indie"},{"genre":"san antonio rap"},{"genre":"svensk lovsang"},{"genre":"hamburger schule"},{"genre":"modern darkwave"},{"genre":"brazilian post-hardcore"},{"genre":"musica jibara"},{"genre":"guyanese pop"},{"genre":"derby indie"},{"genre":"norwegian punk rock"},{"genre":"spanish electronic"},{"genre":"danish singer-songwriter"},{"genre":"spanish prog"},{"genre":"traditional british folk"},{"genre":"italian new wave"},{"genre":"hindi worship"},{"genre":"american melodeath"},{"genre":"persian drill"},{"genre":"deep progressive trance"},{"genre":"worcester ma indie"},{"genre":"telugu remix"},{"genre":"chain punk"},{"genre":"musica lombarda"},{"genre":"jewish hip hop"},{"genre":"cypriot hip hop"},{"genre":"bulgarian rock"},{"genre":"swiss techno"},{"genre":"ambient country"},{"genre":"swedish folk pop"},{"genre":"greek guitar"},{"genre":"psybass"},{"genre":"vintage broadway"},{"genre":"portuguese folk"},{"genre":"flemish folk"},{"genre":"swedish prog"},{"genre":"musicas espiritas"},{"genre":"jalsat"},{"genre":"garage psych"},{"genre":"gospel italiano"},{"genre":"throat singing"},{"genre":"rap pernambucano"},{"genre":"japanese worship"},{"genre":"lancaster pa indie"},{"genre":"chinese jazz"},{"genre":"memphis indie"},{"genre":"neo-kraut"},{"genre":"musica aguascalentense"},{"genre":"rusyn folk"},{"genre":"persian sad rap"},{"genre":"punta"},{"genre":"sungura"},{"genre":"stateside dnb"},{"genre":"tucson indie"},{"genre":"slovenian rock"},{"genre":"punta rock"},{"genre":"stomp and whittle"},{"genre":"deep deep house"},{"genre":"dronescape"},{"genre":"glitch beats"},{"genre":"plugg en espanol"},{"genre":"euskal indie"},{"genre":"muzica copii"},{"genre":"ambient black metal"},{"genre":"makina"},{"genre":"musica pitiusa"},{"genre":"dub punk"},{"genre":"leipzig indie"},{"genre":"drill dominicano"},{"genre":"indian percussion"},{"genre":"festigal"},{"genre":"polish contemporary classical"},{"genre":"german pagan metal"},{"genre":"pittsburgh metal"},{"genre":"contrabass"},{"genre":"norwegian space disco"},{"genre":"ukrainian contemporary classical"},{"genre":"kelowna bc indie"},{"genre":"folk black metal"},{"genre":"bass trip"},{"genre":"hungarian techno"},{"genre":"moderne ludovky"},{"genre":"mongolian pop"},{"genre":"indie electronica"},{"genre":"malayalam worship"},{"genre":"lagu sasak"},{"genre":"banda guanajuatense"},{"genre":"english renaissance"},{"genre":"light music"},{"genre":"deep progressive house"},{"genre":"chicano punk"},{"genre":"guitarra clasica"},{"genre":"halifax indie"},{"genre":"dancehall guyanaise"},{"genre":"lancashire indie"},{"genre":"columbus ohio indie"},{"genre":"oth indie"},{"genre":"cuento infantile"},{"genre":"kenyan drill"},{"genre":"baptist gospel"},{"genre":"czech indie"},{"genre":"jazz puertorriqueno"},{"genre":"singaporean electronic"},{"genre":"armenian folk"},{"genre":"pashto pop"},{"genre":"canadian psychedelic rock"},{"genre":"detske pesnicky"},{"genre":"german dnb"},{"genre":"northern irish punk"},{"genre":"trad quebecois"},{"genre":"future ambient"},{"genre":"spanish rockabilly"},{"genre":"aarhus indie"},{"genre":"italian folk"},{"genre":"rap galego"},{"genre":"swiss alternative rock"},{"genre":"solipsynthm"},{"genre":"brazilian techno"},{"genre":"fast melodic punk"},{"genre":"libyan pop"},{"genre":"american romanticism"},{"genre":"northeast indian hip hop"},{"genre":"erotica"},{"genre":"atmospheric sludge"},{"genre":"arabic instrumental"},{"genre":"swiss indie folk"},{"genre":"brazilian dnb"},{"genre":"acid trance"},{"genre":"rap metalcore"},{"genre":"bossa nova jazz"},{"genre":"highlife"},{"genre":"deep liquid"},{"genre":"psydub"},{"genre":"broken beat"},{"genre":"old school hard trance"},{"genre":"power thrash"},{"genre":"corsican folk"},{"genre":"deep soul house"},{"genre":"musikkorps"},{"genre":"romanian folk"},{"genre":"psalms"},{"genre":"austin singer-songwriter"},{"genre":"sega"},{"genre":"magyar mulatos"},{"genre":"limerick indie"},{"genre":"xhosa"},{"genre":"russian techno"},{"genre":"zurich indie"},{"genre":"minimal dnb"},{"genre":"hungarian indie"},{"genre":"indie psych-pop"},{"genre":"greek rock"},{"genre":"industrial techno"},{"genre":"mexican traditional"},{"genre":"vintage italian pop"},{"genre":"experimental synth"},{"genre":"swiss singer-songwriter"},{"genre":"rasiya"},{"genre":"nitzhonot"},{"genre":"gambian pop"},{"genre":"canadian experimental"},{"genre":"swiss reggae"},{"genre":"deep brazilian pop"},{"genre":"capoeira"},{"genre":"metal gotico"},{"genre":"finnish pop punk"},{"genre":"deep liquid bass"},{"genre":"kenyan alternative"},{"genre":"freakbeat"},{"genre":"spirituals"},{"genre":"drone ambient"},{"genre":"orquestas de galicia"},{"genre":"irish punk"},{"genre":"mezmur"},{"genre":"punk tuga"},{"genre":"french post-punk"},{"genre":"experimental guitar"},{"genre":"boogie-woogie"},{"genre":"musica costarricense"},{"genre":"german dark minimal techno"},{"genre":"singaporean hip hop"},{"genre":"texas punk"},{"genre":"forest psy"},{"genre":"serialism"},{"genre":"reiki"},{"genre":"gamecore"},{"genre":"erotik"},{"genre":"swedish techno"},{"genre":"dirty texas rap"},{"genre":"australian blues"},{"genre":"blackened screamo"},{"genre":"vintage cantonese pop"},{"genre":"french dnb"},{"genre":"indie singer-songwriter"},{"genre":"cosmic black metal"},{"genre":"nordic ambient"},{"genre":"musica potiguar"},{"genre":"russian dnb"},{"genre":"popullore jugu"},{"genre":"technical black metal"},{"genre":"bansuri"},{"genre":"soul flow"},{"genre":"greek psychedelic rock"},{"genre":"klapa"},{"genre":"electronica chilena"},{"genre":"birdsong"},{"genre":"reggae mexicano"},{"genre":"puglia indie"},{"genre":"deep new wave"},{"genre":"somali pop"},{"genre":"brazilian tech house"},{"genre":"australian experimental"},{"genre":"ukhc"},{"genre":"8-bit"},{"genre":"pop boliviano"},{"genre":"indorock"},{"genre":"uk stoner rock"},{"genre":"south african country"},{"genre":"canadian indigenous hip hop"},{"genre":"indie folk italiano"},{"genre":"bible"},{"genre":"berlin minimal techno"},{"genre":"minimal dubstep"},{"genre":"austro-german modernism"},{"genre":"deep metalcore"},{"genre":"japanese experimental"},{"genre":"nz gangsta rap"},{"genre":"persian trap"},{"genre":"irish classical"},{"genre":"italian ska"},{"genre":"mbira"},{"genre":"japanese girl punk"},{"genre":"shamisen"},{"genre":"focus trance"},{"genre":"indie veneto"},{"genre":"south african r&b"},{"genre":"musica nortena chilena"},{"genre":"gypsy fusion"},{"genre":"kansas indie"},{"genre":"russian pop punk"},{"genre":"purple sound"},{"genre":"dunedin sound"},{"genre":"japanese edm"},{"genre":"technical brutal death metal"},{"genre":"outer hip hop"},{"genre":"rap moldovenesc"},{"genre":"japanese traditional"},{"genre":"pinoy metal"},{"genre":"punjabi folk"},{"genre":"edinburgh indie"},{"genre":"classic moroccan pop"},{"genre":"laulaja-lauluntekija"},{"genre":"uruguayan indie"},{"genre":"kids dance party"},{"genre":"erotic product"},{"genre":"surinamese pop"},{"genre":"post-punk mexicano"},{"genre":"drill tuga"},{"genre":"belgian new wave"},{"genre":"classic bulgarian pop"},{"genre":"joropo"},{"genre":"arkansas indie"},{"genre":"italian contemporary jazz"},{"genre":"west virginia indie"},{"genre":"jazz venezolano"},{"genre":"mizo pop"},{"genre":"southern china indie"},{"genre":"language"},{"genre":"destroy techno"},{"genre":"lezginka"},{"genre":"oberkrainer"},{"genre":"dancehall mauricien"},{"genre":"stl indie"},{"genre":"dutch blues"},{"genre":"lund indie"},{"genre":"pacific islands gospel"},{"genre":"lagu sabahan"},{"genre":"indie pop rock"},{"genre":"musica occitana"},{"genre":"vlaamse rap"},{"genre":"turkish reggae"},{"genre":"contemporary folk"},{"genre":"spacesynth"},{"genre":"string folk"},{"genre":"powwow"},{"genre":"german melodeath"},{"genre":"minneapolis punk"},{"genre":"wyoming indie"},{"genre":"deep neofolk"},{"genre":"detroit indie"},{"genre":"country boogie"},{"genre":"east anglia indie"},{"genre":"belgian jazz"},{"genre":"milwaukee hip hop"},{"genre":"romanian indie"},{"genre":"canadian post-punk"},{"genre":"yoruba worship"},{"genre":"khmer hip hop"},{"genre":"dutch jazz"},{"genre":"finnish progressive metal"},{"genre":"malagasy pop"},{"genre":"korean soundtrack"},{"genre":"afro psych"},{"genre":"vispop"},{"genre":"madrigal"},{"genre":"chill baile"},{"genre":"drumfunk"},{"genre":"spanish indie rock"},{"genre":"experimental club"},{"genre":"thrash core"},{"genre":"hardcore punk espanol"},{"genre":"indie rock colombiano"},{"genre":"norrbotten indie"},{"genre":"zydeco"},{"genre":"sierra leonean pop"},{"genre":"christlicher rap"},{"genre":"southeast asian post-rock"},{"genre":"bisrock"},{"genre":"german street punk"},{"genre":"kyrgyz pop"},{"genre":"russian shoegaze"},{"genre":"cantaditas"},{"genre":"japanese idm"},{"genre":"brazilian experimental"},{"genre":"little rock indie"},{"genre":"traditional scottish folk"},{"genre":"salay"},{"genre":"malawian hip hop"},{"genre":"belgian electronic"},{"genre":"cologne electronic"},{"genre":"american choir"},{"genre":"venda rap"},{"genre":"gamelan"},{"genre":"swedish psychedelic rock"},{"genre":"tango cancion"},{"genre":"british math rock"},{"genre":"musica mocambicana"},{"genre":"purulia pop"},{"genre":"progressive breaks"},{"genre":"argentine hardcore"},{"genre":"guitarra argentina"},{"genre":"irish dance"},{"genre":"punk colombiano"},{"genre":"new wave of osdm"},{"genre":"african electronic"},{"genre":"north dakota indie"},{"genre":"minneapolis metal"},{"genre":"danish black metal"},{"genre":"dark psytrance"},{"genre":"baltic post-punk"},{"genre":"panamanian rock"},{"genre":"deep ambient"},{"genre":"denver metal"},{"genre":"hengelliset laulut"},{"genre":"trallpunk"},{"genre":"early music choir"},{"genre":"samba gospel"},{"genre":"brazilian indie rock"},{"genre":"dutch black metal"},{"genre":"chattanooga indie"},{"genre":"navajo"},{"genre":"santali pop"},{"genre":"musique tahitienne"},{"genre":"german blues"},{"genre":"mexican son"},{"genre":"nordic shoegaze"},{"genre":"afrobeat fusion"},{"genre":"indonesian trap"},{"genre":"yoga"},{"genre":"uk noise rock"},{"genre":"barbershop"},{"genre":"finnish black metal"},{"genre":"rap guarulhense"},{"genre":"tunisian alternative"},{"genre":"psychedelic jazz fusion"},{"genre":"sefardi"},{"genre":"irish drill"},{"genre":"italian mandolin"},{"genre":"classical harp"},{"genre":"galego"},{"genre":"pei indie"},{"genre":"myanmar indie"},{"genre":"canadian psychedelic"},{"genre":"australian techno"},{"genre":"traditional rockabilly"},{"genre":"german electronica"},{"genre":"ney"},{"genre":"house argentino"},{"genre":"lithuanian indie"},{"genre":"deep southern trap"},{"genre":"vlaamse cabaret"},{"genre":"ottawa indie"},{"genre":"russian nu metal"},{"genre":"khandeshi pop"},{"genre":"musique acadienne"},{"genre":"ragtime"},{"genre":"cabaret"},{"genre":"vintage chinese pop"},{"genre":"nohay"},{"genre":"rock tico"},{"genre":"banda peruana"},{"genre":"marimba mexicana"},{"genre":"american orchestra"},{"genre":"abstract idm"},{"genre":"brazilian blues"},{"genre":"russian pixel"},{"genre":"ny roots"},{"genre":"sasscore"},{"genre":"voidgrind"},{"genre":"assyrian pop"},{"genre":"malaysian tamil rap"},{"genre":"jazz violin"},{"genre":"estonian rock"},{"genre":"greenlandic pop"},{"genre":"japanese psychedelic rock"},{"genre":"erhu"},{"genre":"celtic harp"},{"genre":"ruta destroy"},{"genre":"taiwan post-rock"},{"genre":"belgian modern jazz"},{"genre":"montana indie"},{"genre":"euroska"},{"genre":"neo-psicodelia brasileira"},{"genre":"western saharan folk"},{"genre":"pahadi pop"},{"genre":"musica calabrese"},{"genre":"deep melodic hard rock"},{"genre":"luxembourgian indie"},{"genre":"south african electronic"},{"genre":"finnish jazz"},{"genre":"synthwave brasileiro"},{"genre":"turkish post-punk"},{"genre":"vaudeville"},{"genre":"portuguese metal"},{"genre":"boogie"},{"genre":"trap cristiano"},{"genre":"guidance"},{"genre":"barnalog"},{"genre":"australian comedy"},{"genre":"slovak folk"},{"genre":"dutch musical"},{"genre":"piano house"},{"genre":"deep german punk"},{"genre":"psychedelic blues-rock"},{"genre":"gospel amapiano"},{"genre":"new wave of speed metal"},{"genre":"deep east coast hip hop"},{"genre":"manitoba country"},{"genre":"hip hop reunionnais"},{"genre":"friese muziek"},{"genre":"caracas indie"},{"genre":"essex indie"},{"genre":"tzadik"},{"genre":"galician folk"},{"genre":"klezmer"},{"genre":"musica mapuche"},{"genre":"jazz guitar trio"},{"genre":"german death metal"},{"genre":"traditional reggae"},{"genre":"string band"},{"genre":"ambient dub techno"},{"genre":"wisconsin indie"},{"genre":"swedish post-hardcore"},{"genre":"thai instrumental"},{"genre":"adelaide indie"},{"genre":"new weird finland"},{"genre":"son cubano clasico"},{"genre":"georgian hip hop"},{"genre":"dark electro"},{"genre":"musica goiana"},{"genre":"humppa"},{"genre":"calgary indie"},{"genre":"albany ny indie"},{"genre":"uilleann pipes"},{"genre":"post-punk latinoamericano"},{"genre":"technical grindcore"},{"genre":"musica indigena mexicana"},{"genre":"polish hardcore"},{"genre":"fo jing"},{"genre":"musica mallorquina"},{"genre":"lo star"},{"genre":"judaica"},{"genre":"chinese instrumental"},{"genre":"nz metal"},{"genre":"chicago mexican"},{"genre":"euskal reggae"},{"genre":"deep funk house"},{"genre":"indonesian death metal"},{"genre":"circus"},{"genre":"austrian black metal"},{"genre":"speedcore"},{"genre":"portuguese techno"},{"genre":"joseon pop"},{"genre":"georgian alternative"},{"genre":"indonesian emo rap"},{"genre":"finnish progressive rock"},{"genre":"cleveland indie"},{"genre":"deep flow"},{"genre":"talentos brasileiros"},{"genre":"cybergrind"},{"genre":"grunge pop"},{"genre":"norwegian contemporary jazz"},{"genre":"psybreaks"},{"genre":"african percussion"},{"genre":"folklore veracruzano"},{"genre":"gothic post-punk"},{"genre":"szanty"},{"genre":"polish folk"},{"genre":"sinogaze"},{"genre":"ukrainian alternative rock"},{"genre":"forro manauara"},{"genre":"blues-rock guitar"},{"genre":"byzantine"},{"genre":"metal colombiano"},{"genre":"rap tuga underground"},{"genre":"finnish reggae"},{"genre":"underground boom bap"},{"genre":"tijuana indie"},{"genre":"macedonian hip hop"},{"genre":"old school highlife"},{"genre":"atmospheric doom"},{"genre":"georgian pop"},{"genre":"taiwan electronic"},{"genre":"classic danish rock"},{"genre":"rap congolais"},{"genre":"hip hop galsen"},{"genre":"epic doom"},{"genre":"french folk"},{"genre":"experimental techno"},{"genre":"talentkonkurrence"},{"genre":"mexican tech house"},{"genre":"folklore cuyano"},{"genre":"russian heavy metal"},{"genre":"palestinian traditional"},{"genre":"isle of wight indie"},{"genre":"latvian indie"},{"genre":"lagu karo"},{"genre":"electronicore"},{"genre":"washboard"},{"genre":"australian classical"},{"genre":"crossover prog"},{"genre":"ukrainian folk"},{"genre":"therapy"},{"genre":"finnish soul"},{"genre":"atlantic canada hip hop"},{"genre":"neo-crust"},{"genre":"cork indie"},{"genre":"marching band"},{"genre":"experimental indie rock"},{"genre":"canadian post-rock"},{"genre":"blackened crust"},{"genre":"street band"},{"genre":"electronica venezuela"},{"genre":"darbuka"},{"genre":"italian post-punk"},{"genre":"kashmiri pop"},{"genre":"rap ecuatoriano"},{"genre":"norwegian death metal"},{"genre":"noise punk"},{"genre":"cameroonian hip hop"},{"genre":"barockinterpreten"},{"genre":"bmore"},{"genre":"west-vlaamse hip hop"},{"genre":"euskal metal"},{"genre":"tanzlmusi"},{"genre":"mallet"},{"genre":"maluku pop"},{"genre":"neo-trad metal"},{"genre":"bolivian rock"},{"genre":"junior songfestival"},{"genre":"progressive thrash"},{"genre":"bisaya indie"},{"genre":"pasodobles"},{"genre":"hard minimal techno"},{"genre":"gnawa"},{"genre":"jazz orchestra"},{"genre":"umea hardcore"},{"genre":"finlandssvenska musik"},{"genre":"emocore"},{"genre":"ilocano pop"},{"genre":"belarusian punk"},{"genre":"norwegian gospel"},{"genre":"lagu tarling"},{"genre":"korean shoegaze"},{"genre":"rock progressif francais"},{"genre":"bisaya worship"},{"genre":"rap catarinense"},{"genre":"electronica peruana"},{"genre":"ukrainian experimental"},{"genre":"nordic classical piano"},{"genre":"florida hardcore"},{"genre":"traditional ska"},{"genre":"thai metal"},{"genre":"franco-flemish school"},{"genre":"dutch experimental electronic"},{"genre":"finnish doom metal"},{"genre":"traditional english folk"},{"genre":"canadian death metal"},{"genre":"musica pernambucana"},{"genre":"kalmar indie"},{"genre":"norwegian prog"},{"genre":"ukrainian metal"},{"genre":"zim gospel"},{"genre":"narodnozabavna"},{"genre":"croatian indie"},{"genre":"bachchon ke geet"},{"genre":"russian classical piano"},{"genre":"new england metal"},{"genre":"komedi"},{"genre":"czsk hyperpop"},{"genre":"rock gotico"},{"genre":"deep folk metal"},{"genre":"canberra indie"},{"genre":"blues mexicano"},{"genre":"hip hop boliviano"},{"genre":"balfolk"},{"genre":"jewish a capella"},{"genre":"japanese house"},{"genre":"sesotho pop"},{"genre":"musica mexiquense"},{"genre":"musica valenciana"},{"genre":"modern jangle pop"},{"genre":"dark ambient"},{"genre":"faroese indie"},{"genre":"greek black metal"},{"genre":"deep freestyle"},{"genre":"noisecore"},{"genre":"american oi"},{"genre":"balkan post-punk"},{"genre":"grenada soca"},{"genre":"dainuojamoji poezija"},{"genre":"military cadence"},{"genre":"bodo pop"},{"genre":"musique touareg"},{"genre":"myanmar hip hop"},{"genre":"emoviolence"},{"genre":"azeri alternative"},{"genre":"indie tico"},{"genre":"musique mariage algerien"},{"genre":"lithuanian rock"},{"genre":"indie campechano"},{"genre":"albanian rock"},{"genre":"punk galego"},{"genre":"massage"},{"genre":"italian metalcore"},{"genre":"virginia indie"},{"genre":"french hardcore"},{"genre":"maine hip hop"},{"genre":"taraneem"},{"genre":"tibetan mantra"},{"genre":"bangladeshi hip hop"},{"genre":"estonian electronic"},{"genre":"pune indie"},{"genre":"italian post-hardcore"},{"genre":"iowa hip hop"},{"genre":"musica antigua"},{"genre":"swiss worship"},{"genre":"lagu manado"},{"genre":"tijuana electronic"},{"genre":"xinyao"},{"genre":"japanese classical piano"},{"genre":"swedish experimental"},{"genre":"russian emo"},{"genre":"swiss black metal"},{"genre":"russian post-rock"},{"genre":"swedish underground rap"},{"genre":"winnipeg hip hop"},{"genre":"avant-garde black metal"},{"genre":"classic tollywood"},{"genre":"knoxville indie"},{"genre":"mincecore"},{"genre":"musica sammarinese"},{"genre":"australian hardcore"},{"genre":"forro instrumental"},{"genre":"bajan soca"},{"genre":"bosnian indie"},{"genre":"louisville underground"},{"genre":"czech alternative rap"},{"genre":"korean bl ost"},{"genre":"bangalore indie"},{"genre":"chimurenga"},{"genre":"trash rock"},{"genre":"togolese pop"},{"genre":"uk diy punk"},{"genre":"cornwall indie"},{"genre":"montana roots"},{"genre":"brasilia indie"},{"genre":"canadian comedy"},{"genre":"electronica cristiana"},{"genre":"deep dance pop"},{"genre":"yemeni pop"},{"genre":"modern big band"},{"genre":"bagpipe marching band"},{"genre":"gospel soul"},{"genre":"muzica usoara"},{"genre":"brazilian death metal"},{"genre":"krajiska muzika"},{"genre":"spanish experimental"},{"genre":"tribute"},{"genre":"german classical piano"},{"genre":"musica paranaense"},{"genre":"london on indie"},{"genre":"japanese bedroom pop"},{"genre":"kannada bhava geethe"},{"genre":"german hardcore"},{"genre":"dresden indie"},{"genre":"hi-tech"},{"genre":"psychedelic space rock"},{"genre":"australian jazz"},{"genre":"pre-war blues"},{"genre":"polka nortena"},{"genre":"slovak electronic"},{"genre":"hausa pop"},{"genre":"indonesian hyperpop"},{"genre":"oslo indie"},{"genre":"college marching band"},{"genre":"black death"},{"genre":"cascadian black metal"},{"genre":"latino comedy"},{"genre":"classical trumpet"},{"genre":"raspe"},{"genre":"beach music"},{"genre":"italian death metal"},{"genre":"polyphonies corses"},{"genre":"dikir barat"},{"genre":"icelandic post-punk"},{"genre":"second line"},{"genre":"finnish metalcore"},{"genre":"stuttgart indie"},{"genre":"cascadia psych"},{"genre":"texas death metal"},{"genre":"deep melodic death metal"},{"genre":"bornehistorier"},{"genre":"hjemmesnekk"},{"genre":"canadian black metal"},{"genre":"polish thrash metal"},{"genre":"seattle metal"},{"genre":"muzica moldoveneasca"},{"genre":"d-beat"},{"genre":"nyc metal"},{"genre":"finnish electro"},{"genre":"acousmatic"},{"genre":"backing track"},{"genre":"mindfulness"},{"genre":"traditional funk"},{"genre":"michigan folk"},{"genre":"breaks"},{"genre":"dessin anime"},{"genre":"irish banjo"},{"genre":"ukrainian black metal"},{"genre":"igbo traditional"},{"genre":"malmo indie"},{"genre":"latvian rock"},{"genre":"finnish worship"},{"genre":"german stoner rock"},{"genre":"deep funk"},{"genre":"musica de intervencao"},{"genre":"rap gaucho"},{"genre":"danish death metal"},{"genre":"mexican death metal"},{"genre":"dub metal"},{"genre":"milwaukee indie"},{"genre":"cantonese worship"},{"genre":"lasten satuja"},{"genre":"musique nigerienne"},{"genre":"indonesian deathcore"},{"genre":"kabyle moderne"},{"genre":"russian old school hip hop"},{"genre":"street punk"},{"genre":"algerian folk"},{"genre":"underground grunge"},{"genre":"japanese classical performance"},{"genre":"classical soprano"},{"genre":"ua trap"},{"genre":"sevilla indie"},{"genre":"reggae tico"},{"genre":"zenonesque"},{"genre":"old school nederhop"},{"genre":"pinoy edm"},{"genre":"cymraeg"},{"genre":"slovak indie"},{"genre":"afrikaans gqom"},{"genre":"noel quebecois"},{"genre":"odia bhajan"},{"genre":"turkish classical performance"},{"genre":"rwandan gospel"},{"genre":"kuduro antigo"},{"genre":"swedish blues"},{"genre":"turkish classical"},{"genre":"rap abc paulista"},{"genre":"polish techno"},{"genre":"rock campineiro"},{"genre":"italian jazz fusion"},{"genre":"neo grime"},{"genre":"algorave"},{"genre":"canadian rockabilly"},{"genre":"cardiff indie"},{"genre":"zambian gospel"},{"genre":"cornish folk"},{"genre":"japanese post-punk"},{"genre":"hard rock mexicano"},{"genre":"kansas hip hop"},{"genre":"spanish jazz"},{"genre":"south dakota indie"},{"genre":"adivasi pop"},{"genre":"kokborok pop"},{"genre":"fuji"},{"genre":"historic piano performance"},{"genre":"melbourne hip hop"},{"genre":"portuguese indie rock"},{"genre":"malagasy folk"},{"genre":"french oi"},{"genre":"arizona punk"},{"genre":"musica colombiana instrumental"},{"genre":"russian romance"},{"genre":"japanese death metal"},{"genre":"rautalanka"},{"genre":"gabonese pop"},{"genre":"rock cearense"},{"genre":"heligonka"},{"genre":"greek folk"},{"genre":"lounge house"},{"genre":"mexican experimental"},{"genre":"northwest china indie"},{"genre":"mexican hardcore"},{"genre":"singaporean indie"},{"genre":"baja indie"},{"genre":"jazz flute"},{"genre":"liechtenstein"},{"genre":"german post-punk"},{"genre":"native american hip hop"},{"genre":"deep psychobilly"},{"genre":"classical jazz fusion"},{"genre":"go-go"},{"genre":"sesotho hip hop"},{"genre":"uzbek hip hop"},{"genre":"muzica populara"},{"genre":"perth hip hop"},{"genre":"anthem"},{"genre":"bulgarian r&b"},{"genre":"lawrence ks indie"},{"genre":"death doom"},{"genre":"bal-musette"},{"genre":"dutch death metal"},{"genre":"deep darkpsy"},{"genre":"rock paraibano"},{"genre":"balinese traditional"},{"genre":"kritika"},{"genre":"doomcore"},{"genre":"ugandan gospel"},{"genre":"australian post-rock"},{"genre":"metal catala"},{"genre":"musica eletronica brasileira"},{"genre":"native american spiritual"},{"genre":"schwyzerorgeli"},{"genre":"khmer"},{"genre":"italian pop punk"},{"genre":"canadian drill"},{"genre":"old school uk hip hop"},{"genre":"indian metal"},{"genre":"ethiopian hip hop"},{"genre":"murga"},{"genre":"tigrigna pop"},{"genre":"hull indie"},{"genre":"grunneger muziek"},{"genre":"power noise"},{"genre":"musica etnica"},{"genre":"norwegian doom metal"},{"genre":"whale song"},{"genre":"danish punk"},{"genre":"hardcore breaks"},{"genre":"ostschlager"},{"genre":"new tejano"},{"genre":"beninese pop"},{"genre":"prog quebec"},{"genre":"black speed metal"},{"genre":"japanese techno"},{"genre":"swedish post-punk"},{"genre":"prepared piano"},{"genre":"norman ok indie"},{"genre":"australian death metal"},{"genre":"german renaissance"},{"genre":"brass ensemble"},{"genre":"dundee indie"},{"genre":"taiwanese indigenous music"},{"genre":"deep punk rock"},{"genre":"classic sudanese pop"},{"genre":"rap sureno chileno"},{"genre":"estonian indie"},{"genre":"chaabi algerien"},{"genre":"balkan folk metal"},{"genre":"hypnosis"},{"genre":"fado antigo"},{"genre":"comptine africaine"},{"genre":"argentine jazz"},{"genre":"finnish folk"},{"genre":"xhosa hip hop"},{"genre":"goa hip hop"},{"genre":"jumptek"},{"genre":"musique mahoraise"},{"genre":"surinamese hip hop"},{"genre":"serbian indie"},{"genre":"medieval black metal"},{"genre":"punk mexicano"},{"genre":"meenawati"},{"genre":"mongolian folk"},{"genre":"persian neo-traditional"},{"genre":"swedish pop punk"},{"genre":"russian experimental electronic"},{"genre":"jazz accordion"},{"genre":"australian post-punk"},{"genre":"hampton roads indie"},{"genre":"indie salvadoreno"},{"genre":"saraiki pop"},{"genre":"contemporary choir"},{"genre":"norwegian psychedelic"},{"genre":"west yorkshire indie"},{"genre":"uk rockabilly"},{"genre":"cambodian rock"},{"genre":"harmonica jazz"},{"genre":"chilean metal"},{"genre":"nisiotika"},{"genre":"kerkkoor"},{"genre":"scottish indie folk"},{"genre":"deep vocal jazz"},{"genre":"juju"},{"genre":"japanese progressive house"},{"genre":"czech electronic"},{"genre":"orquesta tropical"},{"genre":"czsk electropop"},{"genre":"mexican classical"},{"genre":"cocuk masallari"},{"genre":"rap salvadoreno"},{"genre":"symphonic melodic death metal"},{"genre":"experimental psych"},{"genre":"icelandic jazz"},{"genre":"bloco"},{"genre":"dansk lovsang"},{"genre":"musiikkia lapista"},{"genre":"neo soul-jazz"},{"genre":"indie michoacano"},{"genre":"bulgarian electronic"},{"genre":"turkmen pop"},{"genre":"carnatic instrumental"},{"genre":"baltic folk"},{"genre":"icelandic metal"},{"genre":"rock goiano"},{"genre":"chinese electronic"},{"genre":"konkani pop"},{"genre":"chennai indie"},{"genre":"chant basque"},{"genre":"christian deathcore"},{"genre":"lao hip hop"},{"genre":"classic tunisian pop"},{"genre":"maltese pop"},{"genre":"blackened hardcore"},{"genre":"scottish gaelic folk"},{"genre":"steel guitar"},{"genre":"chabad niggunim"},{"genre":"norwegian experimental"},{"genre":"slovenian folk"},{"genre":"coventry indie"},{"genre":"quarteto gospel"},{"genre":"arpa grande"},{"genre":"musica sul-mato-grossense"},{"genre":"nz jazz"},{"genre":"string quartet"},{"genre":"burundian pop"},{"genre":"malaysian metal"},{"genre":"free folk"},{"genre":"honky-tonk piano"},{"genre":"musica andorra"},{"genre":"britcore"},{"genre":"mezwed"},{"genre":"modular techno"},{"genre":"gotlandsk musik"},{"genre":"meyxana"},{"genre":"sean-nos singing"},{"genre":"old school ebm"},{"genre":"mluvene slovo"},{"genre":"skinhead oi"},{"genre":"basque folk"},{"genre":"igbo worship"},{"genre":"gospel blues"},{"genre":"deep sunset lounge"},{"genre":"detski pesnichki"},{"genre":"ukrainian ccm"},{"genre":"musique mandingue"},{"genre":"nueva ola peruana"},{"genre":"scottish fiddle"},{"genre":"welsh folk"},{"genre":"weightless"},{"genre":"spanish renaissance"},{"genre":"danish experimental"},{"genre":"portuguese black metal"},{"genre":"swiss jazz"},{"genre":"nu electro"},{"genre":"heavy gothic rock"},{"genre":"lao pop"},{"genre":"tavern"},{"genre":"iowa indie"},{"genre":"north alabama indie"},{"genre":"bohemian baroque"},{"genre":"banjara pop"},{"genre":"dubstep product"},{"genre":"rap norteno chileno"},{"genre":"japanoise"},{"genre":"uae indie"},{"genre":"indie cantabria"},{"genre":"epic black metal"},{"genre":"israeli metal"},{"genre":"inuit pop"},{"genre":"nz hardcore"},{"genre":"spanish electropop"},{"genre":"yorkshire folk"},{"genre":"georgian folk"},{"genre":"drikkelek"},{"genre":"geinin song"},{"genre":"japanese prog"},{"genre":"garage rock mexicano"},{"genre":"progressive black metal"},{"genre":"korean metal"},{"genre":"classic afrobeat"},{"genre":"boston electronic"},{"genre":"brazilian lo-fi rock"},{"genre":"cambridge choir"},{"genre":"haur kantak"},{"genre":"afrikaans gospel"},{"genre":"musica purepecha"},{"genre":"albanian alternative"},{"genre":"birthday"},{"genre":"wind symphony"},{"genre":"italian stoner rock"},{"genre":"kaseko"},{"genre":"taiwan metal"},{"genre":"serbian alternative rock"},{"genre":"chinese metalcore"},{"genre":"sebene"},{"genre":"sulawesi indie"},{"genre":"japanese choir"},{"genre":"barnasogur"},{"genre":"slaskie piosenki"},{"genre":"funeral doom"},{"genre":"swedish rock-and-roll"},{"genre":"duduk"},{"genre":"musica wixarika"},{"genre":"industrial black metal"},{"genre":"polka"},{"genre":"screamocore"},{"genre":"comfy synth"},{"genre":"fado de coimbra"},{"genre":"university choir"},{"genre":"classical saxophone"},{"genre":"banda de viento"},{"genre":"georgian electronic"},{"genre":"psytech"},{"genre":"bleakgaze"},{"genre":"finnish idol pop"},{"genre":"taiwanese pop"},{"genre":"guam indie"},{"genre":"galician jazz"},{"genre":"musica guineense"},{"genre":"nova musica amazonense"},{"genre":"swansea indie"},{"genre":"rap guineen"},{"genre":"seggae"},{"genre":"maracatu"},{"genre":"pohadky"},{"genre":"vintage taiwan pop"},{"genre":"old-time fiddle"},{"genre":"psicodelia mexicana"},{"genre":"deep discofox"},{"genre":"maloya"},{"genre":"afro-cuban traditional"},{"genre":"musica brasiliense"},{"genre":"telugu hip hop"},{"genre":"slovenian hip hop"},{"genre":"south carolina metal"},{"genre":"rondalla"},{"genre":"choro contemporaneo"},{"genre":"siberian folk"},{"genre":"polish ambient"},{"genre":"heavy psych"},{"genre":"russian folk metal"},{"genre":"cajun"},{"genre":"irish techno"},{"genre":"experimental black metal"},{"genre":"wellington indie"},{"genre":"shakuhachi"},{"genre":"muzica lautareasca"},{"genre":"kinderliedjies"},{"genre":"hammered dulcimer"},{"genre":"faroese rock"},{"genre":"belgian blues"},{"genre":"korean hyperpop"},{"genre":"icelandic black metal"},{"genre":"ambient fusion"},{"genre":"classical organ"},{"genre":"finnish blues"},{"genre":"hot jazz"},{"genre":"starogradska"},{"genre":"war metal"},{"genre":"adelaide punk"},{"genre":"kashmiri hip hop"},{"genre":"progressive technical death metal"},{"genre":"traditional bluegrass"},{"genre":"tennessee experimental"},{"genre":"khasi pop"},{"genre":"panamanian indie"},{"genre":"jazzcore"},{"genre":"oriental classical"},{"genre":"yu-mex"},{"genre":"musica chiapaneca"},{"genre":"musica indigena brasileira"},{"genre":"austrian techno"},{"genre":"scottish jazz"},{"genre":"goa trance"},{"genre":"sludgecore"},{"genre":"atmospheric post-rock"},{"genre":"mexican thrash metal"},{"genre":"mevlevi sufi"},{"genre":"hard glam"},{"genre":"burkinabe pop"},{"genre":"musica otavalena"},{"genre":"indian jazz"},{"genre":"nova musica maranhense"},{"genre":"acid idm"},{"genre":"polish modern jazz"},{"genre":"mexican post-rock"},{"genre":"hazaragi pop"},{"genre":"estonian folk"},{"genre":"pittsburgh indie rock"},{"genre":"chamorro pop"},{"genre":"aggro chileno"},{"genre":"melodic doom"},{"genre":"greek indie rock"},{"genre":"french stoner rock"},{"genre":"lapland hip hop"},{"genre":"italian emo"},{"genre":"rap mocambicana"},{"genre":"native american metal"},{"genre":"hypnotic techno"},{"genre":"vietnamese electronic"},{"genre":"dambora"},{"genre":"shanghai indie"},{"genre":"viola da gamba"},{"genre":"convent"},{"genre":"deep psytrance"},{"genre":"poznan indie"},{"genre":"serbian folk"},{"genre":"surabaya indie"},{"genre":"triangle indie"},{"genre":"french emo"},{"genre":"portuguese jazz"},{"genre":"slovenian metal"},{"genre":"haryanvi ragni"},{"genre":"indie canario"},{"genre":"son jarocho"},{"genre":"japanese concert band"},{"genre":"lovecraftian metal"},{"genre":"classic psychedelic rock"},{"genre":"reading"},{"genre":"deep downtempo fusion"},{"genre":"ngoni"},{"genre":"dicsoites"},{"genre":"austrian jazz"},{"genre":"cape breton folk"},{"genre":"ambient industrial"},{"genre":"guzheng"},{"genre":"namibian pop"},{"genre":"latin shoegaze"},{"genre":"rap euskera"},{"genre":"dutch classical piano"},{"genre":"german post-rock"},{"genre":"bosnian electronic"},{"genre":"banda militar"},{"genre":"protest folk"},{"genre":"belgian contemporary classical"},{"genre":"classical mandolin"},{"genre":"bluegrass fiddle"},{"genre":"belgian black metal"},{"genre":"modern string quartet"},{"genre":"free improvisation"},{"genre":"maltese hip hop"},{"genre":"melodic progressive metal"},{"genre":"nordnorsk rap"},{"genre":"trap boliviano"},{"genre":"lastelaulud"},{"genre":"icelandic punk"},{"genre":"deep classic garage rock"},{"genre":"chapman stick"},{"genre":"gumbe"},{"genre":"norwegian hardcore"},{"genre":"women's choir"},{"genre":"koledy"},{"genre":"polish psychedelia"},{"genre":"italian experimental"},{"genre":"musica queretana"},{"genre":"australian black metal"},{"genre":"norwegian techno"},{"genre":"concertina"},{"genre":"bandolim"},{"genre":"sacred steel"},{"genre":"metal ecuatoriano"},{"genre":"dusseldorf indie"},{"genre":"downtempo fusion"},{"genre":"marathi hip hop"},{"genre":"swedish classical"},{"genre":"macedonian folk"},{"genre":"boeremusiek"},{"genre":"forest black metal"},{"genre":"swiss country"},{"genre":"full on groove"},{"genre":"haitian dance"},{"genre":"finnish modern jazz"},{"genre":"vocal ensemble"},{"genre":"chechen pop"},{"genre":"arpa paraguaya"},{"genre":"merida indie"},{"genre":"latvian folk"},{"genre":"hawaiian indie"},{"genre":"sunset lounge"},{"genre":"tibetan hip hop"},{"genre":"deep g funk"},{"genre":"new hampshire indie"},{"genre":"vaikiskos dainos"},{"genre":"italian black metal"},{"genre":"thai shoegaze"},{"genre":"spanish progressive rock"},{"genre":"slovenske chvaly"},{"genre":"indiana indie"},{"genre":"early american folk"},{"genre":"rap ecuatoguineano"},{"genre":"basel indie"},{"genre":"brazilian black metal"},{"genre":"lowercase"},{"genre":"rap malien"},{"genre":"korean jazz"},{"genre":"scottish americana"},{"genre":"rap nica"},{"genre":"dark minimal techno"},{"genre":"arab metal"},{"genre":"rotterdam indie"},{"genre":"death industrial"},{"genre":"musica tradicional dominicana"},{"genre":"indonesian shoegaze"},{"genre":"finnish post-punk"},{"genre":"lagu iban"},{"genre":"south african modern jazz"},{"genre":"british classical piano"},{"genre":"viet instrumental"},{"genre":"combos nacionales"},{"genre":"benga"},{"genre":"rock caipira"},{"genre":"medway sound"},{"genre":"edo old school"},{"genre":"karbi pop"},{"genre":"techno argentina"},{"genre":"ukrainian metalcore"},{"genre":"folk siciliana"},{"genre":"nyckelharpa"},{"genre":"malang punk"},{"genre":"noise"},{"genre":"via"},{"genre":"cuban funk"},{"genre":"british brass band"},{"genre":"sufi chant"},{"genre":"brazilian metalcore"},{"genre":"experimental dub"},{"genre":"greek punk"},{"genre":"vintage reggae"},{"genre":"contemporary classical piano"},{"genre":"dutch punk"},{"genre":"finnish tango"},{"genre":"salzburg indie"},{"genre":"musica cearense"},{"genre":"irish accordion"},{"genre":"mathgrind"},{"genre":"canti alpini"},{"genre":"bhutanese pop"},{"genre":"frankfurt indie"},{"genre":"barrelhouse piano"},{"genre":"tongan pop"},{"genre":"black sludge"},{"genre":"shoegaze chileno"},{"genre":"peruvian metal"},{"genre":"math rock latinoamericano"},{"genre":"c64"},{"genre":"fado instrumental"},{"genre":"danish classical"},{"genre":"rap gabonais"},{"genre":"rwandan hip hop"},{"genre":"demoscene"},{"genre":"tajik pop"},{"genre":"rez country"},{"genre":"veena"},{"genre":"power electronics"},{"genre":"musica morelense"},{"genre":"russian hardcore"},{"genre":"south african metal"},{"genre":"leon gto indie"},{"genre":"indie fuzzpop"},{"genre":"oeteldonk"},{"genre":"chamber choir"},{"genre":"seychelles pop"},{"genre":"german rockabilly"},{"genre":"djecje pjesme"},{"genre":"folk metal latinoamericano"},{"genre":"baps"},{"genre":"steelpan"},{"genre":"sda choir"},{"genre":"rio grande do sul indie"},{"genre":"illbient"},{"genre":"ryukoka"},{"genre":"occult black metal"},{"genre":"lesotho traditional"},{"genre":"denver rap"},{"genre":"sundanese traditional"},{"genre":"coptic hymn"},{"genre":"marrabenta"},{"genre":"belgian death metal"},{"genre":"irish black metal"},{"genre":"latvian electronic"},{"genre":"cuatro puertorriqueno"},{"genre":"spanish post-rock"},{"genre":"italian contemporary classical"},{"genre":"deep hardtechno"},{"genre":"tuna universitaria"},{"genre":"neo-manele"},{"genre":"finnish choir"},{"genre":"greek techno"},{"genre":"uk post-metal"},{"genre":"vintage country folk"},{"genre":"japanese dub"},{"genre":"qanun"},{"genre":"trikiti"},{"genre":"latin surf rock"},{"genre":"japanese orchestra"},{"genre":"alternative metalcore"},{"genre":"italogaze"},{"genre":"australian classical piano"},{"genre":"nz alternative rock"},{"genre":"guitar case"},{"genre":"metal gaucho"},{"genre":"derry indie"},{"genre":"lowlands hardcore"},{"genre":"chamame brasilero"},{"genre":"ritual ambient"},{"genre":"chinese post-rock"},{"genre":"french post-rock"},{"genre":"classic australian country"},{"genre":"yoik"},{"genre":"german orchestra"},{"genre":"classical clarinet"},{"genre":"russian contemporary classical"},{"genre":"galician indie"},{"genre":"dub poetry"},{"genre":"dortmund indie"},{"genre":"brno indie"},{"genre":"myanmar gospel"},{"genre":"ugandan hip hop"},{"genre":"pops orchestra"},{"genre":"belgian post-rock"},{"genre":"baroque ensemble"},{"genre":"norwegian folk"},{"genre":"russian orchestra"},{"genre":"gaita"},{"genre":"mexican techno"},{"genre":"swedish fiddle"},{"genre":"macedonian electronic"},{"genre":"italian doom metal"},{"genre":"yakut pop"},{"genre":"brockton hip hop"},{"genre":"nz punk"},{"genre":"irish fiddle"},{"genre":"finnish experimental"},{"genre":"coldwave"},{"genre":"portsmouth indie"},{"genre":"romanian metal"},{"genre":"french renaissance"},{"genre":"sarod"},{"genre":"fort wayne indie"},{"genre":"turkish death metal"},{"genre":"volkstumliche musik"},{"genre":"firenze indie"},{"genre":"canadian classical piano"},{"genre":"musica sergipana"},{"genre":"indonesian neo-psychedelia"},{"genre":"keller synth"},{"genre":"cifteli"},{"genre":"gothic doom"},{"genre":"tarantella"},{"genre":"drama"},{"genre":"finnish hardcore"},{"genre":"quebec hardcore"},{"genre":"swedish emo"},{"genre":"swedish contemporary classical"},{"genre":"rap toscana"},{"genre":"sotalaulut"},{"genre":"deep filthstep"},{"genre":"deep eurodance"},{"genre":"brass band brasileiro"},{"genre":"modern chamber music"},{"genre":"south african punk"},{"genre":"medimeisterschaften"},{"genre":"indie poblano"},{"genre":"trondheim indie"},{"genre":"israeli punk"},{"genre":"dutch underground hip hop"},{"genre":"chinese reggae"},{"genre":"isle of man indie"},{"genre":"magyar musicalek"},{"genre":"bernu dziesmas"},{"genre":"radio symphony"},{"genre":"decije pesme"},{"genre":"re:techno"},{"genre":"raw black metal"},{"genre":"metal paranaense"},{"genre":"oulu indie"},{"genre":"ancient mediterranean"},{"genre":"ohangla"},{"genre":"idol game"},{"genre":"cello ensemble"},{"genre":"indie paraense"},{"genre":"rap alagoano"},{"genre":"musica prehispanica"},{"genre":"taiwan classical performance"},{"genre":"clawhammer banjo"},{"genre":"romanian punk"},{"genre":"missouri indie"},{"genre":"spanish classical piano"},{"genre":"polish experimental electronic"},{"genre":"italian hardcore"},{"genre":"classic latvian pop"},{"genre":"jazz dominicano"},{"genre":"botswana hip hop"},{"genre":"shib"},{"genre":"electroacoustic improvisation"},{"genre":"west virginia metal"},{"genre":"lute"},{"genre":"indie boliviano"},{"genre":"oratory"},{"genre":"austrian punk"},{"genre":"karen pop"},{"genre":"syro-aramaic chant"},{"genre":"chill-out trance"},{"genre":"balalaika"},{"genre":"vintage norwegian pop"},{"genre":"kompa chretien"},{"genre":"instrumental death metal"},{"genre":"mizo gospel"},{"genre":"bern indie"},{"genre":"san antonio indie"},{"genre":"rap sergipano"},{"genre":"japanese melodic hardcore"},{"genre":"fisarmonica"},{"genre":"jug band"},{"genre":"drone rock"},{"genre":"post-punk brasileiro"},{"genre":"musica folk asturiana"},{"genre":"swedish ebm"},{"genre":"french rock-and-roll"},{"genre":"oxford choir"},{"genre":"lombok indie"},{"genre":"tamburica"},{"genre":"austrian stoner rock"},{"genre":"luxembourgian pop"},{"genre":"modern mod"},{"genre":"reggae boliviano"},{"genre":"tuvan folk"},{"genre":"canadian shoegaze"},{"genre":"hong kong tv drama"},{"genre":"chinese new year"},{"genre":"skweee"},{"genre":"diy pop punk"},{"genre":"italian classical piano"},{"genre":"swedish choir"},{"genre":"muzica bisericeasca"},{"genre":"galway indie"},{"genre":"new england hardcore"},{"genre":"rock catracho"},{"genre":"chinese metal"},{"genre":"neo-trad prog"},{"genre":"iraqi hip hop"},{"genre":"jazz chileno"},{"genre":"bosstown sound"},{"genre":"japanese black metal"},{"genre":"rominimal"},{"genre":"ohio hardcore"},{"genre":"hungarian contemporary classical"},{"genre":"finnish psychedelic rock"},{"genre":"rap paraguayo"},{"genre":"hypertrance"},{"genre":"canzone siciliane"},{"genre":"christian death metal"},{"genre":"irish contemporary classical"},{"genre":"swazi pop"},{"genre":"australian shoegaze"},{"genre":"nubian traditional"},{"genre":"classic ukrainian pop"},{"genre":"staff band"},{"genre":"traditional southern folk"},{"genre":"rock alagoano"},{"genre":"indie sudcaliforniano"},{"genre":"trap kreyol"},{"genre":"catalan folk"},{"genre":"jazz tico"},{"genre":"russian black metal"},{"genre":"ringtone"},{"genre":"danish folk"},{"genre":"singaporean metal"},{"genre":"muzica ardeleneasca"},{"genre":"russian choir"},{"genre":"cuban electronic"},{"genre":"austrian orchestra"},{"genre":"icelandic traditional"},{"genre":"bulgarian folk"},{"genre":"kannada indie"},{"genre":"musica piauiense"},{"genre":"kol isha"},{"genre":"terrorcore"},{"genre":"lagu maluku"},{"genre":"houston indie"},{"genre":"rap nortista"},{"genre":"cathedral choir"},{"genre":"folclore portugues"},{"genre":"croatian metal"},{"genre":"svensk indie"},{"genre":"paraguayan indie"},{"genre":"musique urbaine brazzaville"},{"genre":"cumbia funk"},{"genre":"industrial hardcore"},{"genre":"pilates"},{"genre":"armenian indie"},{"genre":"zarzuela"},{"genre":"korean musicals"},{"genre":"faroese folk"},{"genre":"libyan hip hop"},{"genre":"russian power metal"},{"genre":"tibetan traditional"},{"genre":"viet edm"},{"genre":"chamber ensemble"},{"genre":"polish post-rock"},{"genre":"indian ambient"},{"genre":"deep hardcore"},{"genre":"belgian punk"},{"genre":"new jack smooth"},{"genre":"mountain dulcimer"},{"genre":"pontian folk"},{"genre":"musica campista"},{"genre":"turkish experimental"},{"genre":"deep melodic metalcore"},{"genre":"arkansas metal"},{"genre":"japanese hardcore"},{"genre":"wisconsin metal"},{"genre":"paracana"},{"genre":"italo beats"},{"genre":"dub product"},{"genre":"pinoy shoegaze"},{"genre":"prague indie"},{"genre":"jazz tuba"},{"genre":"norwegian punk"},{"genre":"native american black metal"},{"genre":"irish flute"},{"genre":"baton rouge indie"},{"genre":"guitarra portuguesa"},{"genre":"tabla"},{"genre":"wuhan indie"},{"genre":"indian violin"},{"genre":"dansk comedy"},{"genre":"colombian hardcore"},{"genre":"horror punk brasileiro"},{"genre":"colorado hardcore"},{"genre":"new brunswick indie"},{"genre":"chinese post-punk"},{"genre":"grisly death metal"},{"genre":"indie psychedelic rock"},{"genre":"dungeon rap"},{"genre":"swedish grindcore"},{"genre":"avant-rock"},{"genre":"colombian electronic"},{"genre":"vintage french psychedelic"},{"genre":"bulgarian indie"},{"genre":"animegrind"},{"genre":"musique mauritanienne"},{"genre":"hungarian classical piano"},{"genre":"neo-industrial rock"},{"genre":"goa psytrance"},{"genre":"finnish electronic"},{"genre":"modern electroacoustic"},{"genre":"chinese classical"},{"genre":"guatemalan metal"},{"genre":"musica menorquina"},{"genre":"indie hidalguense"},{"genre":"poetry"},{"genre":"kinderchor"},{"genre":"tar"},{"genre":"deep jazz fusion"},{"genre":"nagaland indie"},{"genre":"australian thrash metal"},{"genre":"italian post-rock"},{"genre":"hardingfele"},{"genre":"vintage spanish pop"},{"genre":"dechovka"},{"genre":"trekkspill"},{"genre":"south sudanese pop"},{"genre":"musica ecuatoguineana"},{"genre":"irish underground rap"},{"genre":"japanese buddhist chant"},{"genre":"christian thrash metal"},{"genre":"botswana pop"},{"genre":"historically informed performance"},{"genre":"spanish blues"},{"genre":"american early music"},{"genre":"baithak gana"},{"genre":"xenharmonic"},{"genre":"neo honky tonk"},{"genre":"indie trujillano"},{"genre":"utah metal"},{"genre":"oromo pop"},{"genre":"german shoegaze"},{"genre":"metal tico"},{"genre":"rock progresivo mexicano"},{"genre":"bahamian folk"},{"genre":"eastern bloc groove"},{"genre":"greek jazz"},{"genre":"afghan traditional"},{"genre":"gotico brasileiro"},{"genre":"musica rapa nui"},{"genre":"deep full on"},{"genre":"vintage swing"},{"genre":"bengali folk"},{"genre":"candombe"},{"genre":"covertrance"},{"genre":"spanish psychedelic rock"},{"genre":"indonesian experimental"},{"genre":"santoor"},{"genre":"belgian stoner rock"},{"genre":"arab experimental"},{"genre":"dragspel"},{"genre":"abstractro"},{"genre":"caucasian classical piano"},{"genre":"irish gaelic folk"},{"genre":"balafon"},{"genre":"unblack metal"},{"genre":"chinese experimental"},{"genre":"javanese gamelan"},{"genre":"garifuna folk"},{"genre":"lai hla"},{"genre":"marcha funebre"},{"genre":"indie hidrocalido"},{"genre":"totalism"},{"genre":"spanish baroque"},{"genre":"classic konkani pop"},{"genre":"norwegian blues"},{"genre":"streichquartett"},{"genre":"yuri"},{"genre":"belarusian metal"},{"genre":"st petersburg fl indie"},{"genre":"musique concrete"},{"genre":"rajasthani folk"},{"genre":"swiss punk"},{"genre":"mainland se asia metal"},{"genre":"circassian folk"},{"genre":"taiko"},{"genre":"canadian choir"},{"genre":"jazz colombiano"},{"genre":"medieval ensemble"},{"genre":"scottish drill"},{"genre":"indie arequipeno"},{"genre":"minimal synth"},{"genre":"classical flute"},{"genre":"latin american heavy psych"},{"genre":"lithuanian folk"},{"genre":"irish trap"},{"genre":"molam"},{"genre":"bolivian metal"},{"genre":"grunge revival"},{"genre":"classic female blues"},{"genre":"batswana traditional"},{"genre":"jugendchor"},{"genre":"alandsk musik"},{"genre":"muzica maramureseana"},{"genre":"duhovne pjesme"},{"genre":"gaddiyali pop"},{"genre":"min'yo"},{"genre":"rap gasy"},{"genre":"korean experimental"},{"genre":"australian rockabilly"},{"genre":"aberdeen indie"},{"genre":"romanian black metal"},{"genre":"thai worship"},{"genre":"israeli traditional"},{"genre":"christian symphonic metal"},{"genre":"andalusian classical"},{"genre":"folclore castilla y leon"},{"genre":"folk cantabria"},{"genre":"men's choir"},{"genre":"marinera"},{"genre":"himalayan folk"},{"genre":"luxembourgian hip hop"},{"genre":"raga rock"},{"genre":"trio cubano"},{"genre":"classical mezzo-soprano"},{"genre":"brazilian rockabilly"},{"genre":"russian death metal"},{"genre":"italian screamo"},{"genre":"kosovan indie"},{"genre":"brazilian stoner rock"},{"genre":"macedonian indie"},{"genre":"garo pop"},{"genre":"nhac thieu nhi"},{"genre":"dutch folk"},{"genre":"cape breton indie"},{"genre":"classical percussion"},{"genre":"rock potiguar"},{"genre":"pinoy traditional"},{"genre":"senegalese traditional"},{"genre":"classical countertenor"},{"genre":"brazilian contemporary classical"},{"genre":"koto"},{"genre":"bangla gojol"},{"genre":"korean punk"},{"genre":"croatian folk"},{"genre":"dombra"},{"genre":"rap potiguar"},{"genre":"sindhi"},{"genre":"hula"},{"genre":"grim death metal"},{"genre":"prank"},{"genre":"neo-proto"},{"genre":"danish electro"},{"genre":"novos talentos brasileiros"},{"genre":"israeli classical"},{"genre":"classical baritone"},{"genre":"rhythm rock"},{"genre":"colombian death metal"},{"genre":"german choir"},{"genre":"classic assamese pop"},{"genre":"finnish techno"},{"genre":"zeuhl"},{"genre":"colombian black metal"},{"genre":"portuguese contemporary classical"},{"genre":"lagu betawi"},{"genre":"kinnauri pop"},{"genre":"korean classical performance"},{"genre":"rock nica"},{"genre":"french classical piano"},{"genre":"otroske pesmice"},{"genre":"dutch punk rock"},{"genre":"umea indie"},{"genre":"cantonese opera"},{"genre":"dutch contemporary classical"},{"genre":"sinhala edm"},{"genre":"metal noir quebecois"},{"genre":"danish hardcore"},{"genre":"mising pop"},{"genre":"polynesian traditional"},{"genre":"deep free jazz"},{"genre":"glitter trance"},{"genre":"scottish smallpipe"},{"genre":"deep vocal house"},{"genre":"post-punk colombiano"},{"genre":"brass quintet"},{"genre":"canadian contemporary classical"},{"genre":"maghreb"},{"genre":"musique peule"},{"genre":"indonesian bamboo"},{"genre":"slc hardcore"},{"genre":"rock sergipano"},{"genre":"malawian folk"},{"genre":"finnish rockabilly"},{"genre":"hakkapop"},{"genre":"portuguese death metal"},{"genre":"dutch stoner rock"},{"genre":"saxophone trio"},{"genre":"marimba"},{"genre":"vintage finnish jazz"},{"genre":"dhrupad"},{"genre":"western ny metal"},{"genre":"euro hi-nrg"},{"genre":"russian jazz"},{"genre":"musica colimense"},{"genre":"deep northern soul"},{"genre":"indian instrumental rock"},{"genre":"minnesota metal"},{"genre":"northamptonshire indie"},{"genre":"canadian stoner rock"},{"genre":"epic collage"},{"genre":"ho munda"},{"genre":"nyahbinghi"},{"genre":"kentucky mountain folk"},{"genre":"mento"},{"genre":"irish ballad"},{"genre":"italian blues"},{"genre":"estonian metal"},{"genre":"muzica banateana"},{"genre":"piada"},{"genre":"dytyachi pisni"},{"genre":"classical trombone"},{"genre":"italian progressive metal"},{"genre":"appalachian black metal"},{"genre":"zither"},{"genre":"hangoskonyvek"},{"genre":"swiss experimental"},{"genre":"metal salvadoreno"},{"genre":"guggenmusik"},{"genre":"izvorna muzika"},{"genre":"experimental percussion"},{"genre":"dark black metal"},{"genre":"bikutsi"},{"genre":"tanzorchester"},{"genre":"lok dohori"},{"genre":"american classical piano"},{"genre":"singaporean punk"},{"genre":"anime game"},{"genre":"eletronica underground brasileira"},{"genre":"italian modern prog"},{"genre":"salon music"},{"genre":"classical accordion"},{"genre":"iranian experimental"},{"genre":"thrash-groove metal"},{"genre":"polish classical piano"},{"genre":"kikuyu pop"},{"genre":"chilean techno"},{"genre":"hungarian black metal"},{"genre":"kolo"},{"genre":"welsh choir"},{"genre":"bulgarian metal"},{"genre":"edinburgh metal"},{"genre":"dogri pop"},{"genre":"guatemalan indie"},{"genre":"dutch baroque"},{"genre":"czsk black metal"},{"genre":"quebec metal"},{"genre":"borneo traditional"},{"genre":"rozpravky"},{"genre":"vintage radio show"},{"genre":"alabama hardcore"},{"genre":"kikuyu gospel"},{"genre":"moravian folk"},{"genre":"experimental big band"},{"genre":"macedonian rock"},{"genre":"dutch experimental"},{"genre":"norwegian choir"},{"genre":"musique soninke"},{"genre":"orquesta cubana"},{"genre":"chinese wind"},{"genre":"pipa"},{"genre":"cerkes muzikleri"},{"genre":"rakugo"},{"genre":"delaware indie"},{"genre":"sardinia indie"},{"genre":"punk ecuatoriano"},{"genre":"tulum"},{"genre":"african metal"},{"genre":"autoharp"},{"genre":"assamese hip hop"},{"genre":"musique ancienne"},{"genre":"kapa haka"},{"genre":"classic nz country"},{"genre":"croatian electronic"},{"genre":"rock dominicano"},{"genre":"indie asturiana"},{"genre":"musica blumenauense"},{"genre":"stubenmusik"},{"genre":"synthetic classical"},{"genre":"rock in opposition"},{"genre":"frafra"},{"genre":"field recording"},{"genre":"ceske chvaly"},{"genre":"middle eastern traditional"},{"genre":"albanian folk"},{"genre":"vintage hawaiian"},{"genre":"deep indie singer-songwriter"},{"genre":"detskie rasskazy"},{"genre":"chinese punk"},{"genre":"rock pernambucano"},{"genre":"blues band"},{"genre":"christian doom metal"},{"genre":"spanish death metal"},{"genre":"santur"},{"genre":"folklore panameno"},{"genre":"early french punk"},{"genre":"italian soprano"},{"genre":"mapouka"},{"genre":"deep italo disco"},{"genre":"rock catarinense"},{"genre":"french experimental rock"},{"genre":"serbian metal"},{"genre":"rongmei pop"},{"genre":"black noise"},{"genre":"ceilidh"},{"genre":"caucasian folk"},{"genre":"russian thrash metal"},{"genre":"sound collage"},{"genre":"irish experimental electronic"},{"genre":"indonesian thrash metal"},{"genre":"haitian traditional"},{"genre":"slovak metal"},{"genre":"gwoka"},{"genre":"indie queretano"},{"genre":"metalcore espanol"},{"genre":"belgian hardcore"},{"genre":"korean traditional"},{"genre":"malaysian hardcore"},{"genre":"lithuanian metal"},{"genre":"italian baritone"},{"genre":"ukrainian choir"},{"genre":"shehnai"},{"genre":"german contemporary classical"},{"genre":"finnish contemporary classical"},{"genre":"musica mato-grossense"},{"genre":"beat poetry"},{"genre":"brazilian heavy metal"},{"genre":"deep swedish rock"},{"genre":"belgian experimental"},{"genre":"macau pop"},{"genre":"kosovan folk"},{"genre":"djembe"},{"genre":"instrumental black metal"},{"genre":"alpenpanorama"},{"genre":"baroque singing"},{"genre":"slash punk"},{"genre":"musica amapaense"},{"genre":"trombone brasileiro"},{"genre":"pontianak indie"},{"genre":"african experimental"},{"genre":"suomisaundi"},{"genre":"vapor house"},{"genre":"dweilorkest"},{"genre":"indie nica"},{"genre":"nordic orchestra"},{"genre":"electroacoustic composition"},{"genre":"musica acoriana"},{"genre":"saxony metal"},{"genre":"ladakhi pop"},{"genre":"normal indie"},{"genre":"alaska hip hop"},{"genre":"mexican power metal"},{"genre":"musica campineira"},{"genre":"bandura"},{"genre":"lincoln ne indie"},{"genre":"soda pop"},{"genre":"danish choir"},{"genre":"guqin"},{"genre":"recorder"},{"genre":"vintage classical singing"},{"genre":"british electroacoustic"},{"genre":"georgian polyphony"},{"genre":"latin american classical piano"},{"genre":"spanish stoner rock"},{"genre":"humour francais"},{"genre":"chill groove"},{"genre":"historic classical performance"},{"genre":"antilliaanse folklore"},{"genre":"bohol indie"},{"genre":"idaho hip hop"},{"genre":"cimbalova muzika"},{"genre":"theremin"},{"genre":"deep surf music"},{"genre":"luxembourgian metal"},{"genre":"dutch idol pop"},{"genre":"deep hardcore punk"},{"genre":"kantele"},{"genre":"turkish black metal"},{"genre":"french contemporary classical"},{"genre":"modern performance"},{"genre":"brazilian post-rock"},{"genre":"musica rondoniense"},{"genre":"deep space rock"},{"genre":"charred death"},{"genre":"rock sul-mato-grossense"},{"genre":"moorish traditional"},{"genre":"organetto"},{"genre":"punk tico"},{"genre":"bury st edmunds indie"},{"genre":"orkney and shetland folk"},{"genre":"string orchestra"},{"genre":"h8000"},{"genre":"latin american baroque"},{"genre":"tan co"},{"genre":"south borneo indie"},{"genre":"modern free jazz"},{"genre":"italian rockabilly"},{"genre":"classical bass"},{"genre":"russian modern jazz"},{"genre":"taiwan graduation song"},{"genre":"brazilian surf rock"},{"genre":"czech classical piano"},{"genre":"tibetan folk pop"},{"genre":"aghani lil-atfal"},{"genre":"jazz composition"},{"genre":"hip hop mauritanien"},{"genre":"classical bassoon"},{"genre":"karntner volksmusik"},{"genre":"gayageum"},{"genre":"gong"},{"genre":"esperanto"},{"genre":"new england experimental"},{"genre":"glass"},{"genre":"italian occult psychedelia"},{"genre":"malaysian traditional"},{"genre":"czech jazz"},{"genre":"indie catracho"},{"genre":"folclore extremeno"},{"genre":"brazilian grindcore"},{"genre":"italian baroque ensemble"},{"genre":"extratone"},{"genre":"indie tucumano"},{"genre":"naturjodel"},{"genre":"rock abc paulista"},{"genre":"neo-trad doom metal"},{"genre":"austrian choir"},{"genre":"musica londrinense"},{"genre":"rabm"},{"genre":"polish noise rock"},{"genre":"jazz caraibes"},{"genre":"marsmuziek"},{"genre":"musica caririense"},{"genre":"lithuanian jazz"},{"genre":"metal galego"},{"genre":"russian screamo"},{"genre":"somatik techno"},{"genre":"icelandic choir"},{"genre":"belfast metal"},{"genre":"chaotic black metal"},{"genre":"zohioliin duu"},{"genre":"greek clarinet"},{"genre":"gospel papiamento"},{"genre":"classical oboe"},{"genre":"vintage old-time"},{"genre":"italian bass"},{"genre":"proto-rap"},{"genre":"jota aragonesa"},{"genre":"liberian pop"},{"genre":"vintage gospel"},{"genre":"jazz boliviano"},{"genre":"irish experimental"},{"genre":"danish contemporary classical"},{"genre":"german grindcore"},{"genre":"skiffle"},{"genre":"chakma pop"},{"genre":"polish metalcore"},{"genre":"taiwan experimental"},{"genre":"hipco"},{"genre":"deep active rock"},{"genre":"turkmen hip hop"},{"genre":"indian techno"},{"genre":"egyptian traditional"},{"genre":"folclore navarra"},{"genre":"romanian contemporary classical"},{"genre":"cimbalom"},{"genre":"belfast indie"},{"genre":"historic orchestral performance"},{"genre":"contra dance"},{"genre":"flashcore"},{"genre":"czech swing"},{"genre":"austrian classical piano"},{"genre":"mexican electronic"},{"genre":"latvian metal"},{"genre":"folklore quebecois"},{"genre":"french orchestra"},{"genre":"lion city hardcore"},{"genre":"zomi pop"},{"genre":"orkiestra symfoniczna"},{"genre":"landler"},{"genre":"hard chime"},{"genre":"metal cristao"},{"genre":"magyar kabare"},{"genre":"thai traditional"},{"genre":"swazi hip hop"},{"genre":"deep pop emo"},{"genre":"cante alentejano"},{"genre":"cryptic black metal"},{"genre":"czech psychedelic"},{"genre":"spanish black metal"},{"genre":"italian industrial"},{"genre":"band organ"},{"genre":"afrikaans folk"},{"genre":"moroccan traditional"},{"genre":"rock paraense"},{"genre":"thai psychedelic"},{"genre":"ethnomusicology"},{"genre":"ainu folk"},{"genre":"northumbrian folk"},{"genre":"deep orgcore"},{"genre":"karelian folk"},{"genre":"italian classical guitar"},{"genre":"mexican black metal"},{"genre":"portuguese post-rock"},{"genre":"rap paraense"},{"genre":"viola"},{"genre":"nadaswaram"},{"genre":"italian heavy metal"},{"genre":"korean minyo"},{"genre":"gypsy"},{"genre":"classical piano trio"},{"genre":"minnesang"},{"genre":"classical tuba"},{"genre":"rap burkinabe"},{"genre":"baltic black metal"},{"genre":"maldivian pop"},{"genre":"czech hardcore"},{"genre":"musica piemonteisa"},{"genre":"indonesian black metal"},{"genre":"musique traditionnelle congolaise"},{"genre":"metal paraguayo"},{"genre":"french rockabilly"},{"genre":"portuguese hardcore"},{"genre":"palm wine guitar"},{"genre":"frevo"},{"genre":"korean hardcore"},{"genre":"experimental dubstep"},{"genre":"baltic choir"},{"genre":"musica roraimense"},{"genre":"baoule"},{"genre":"metal uruguayo"},{"genre":"ethiopian traditional"},{"genre":"post-rock latinoamericano"},{"genre":"fife and drum"},{"genre":"metal balear"},{"genre":"classical guitar duo"},{"genre":"troubadour"},{"genre":"spoken word"},{"genre":"portuguese early music"},{"genre":"persian poetry"},{"genre":"italian orchestra"},{"genre":"song poem"},{"genre":"boy soprano"},{"genre":"korean contemporary classical"},{"genre":"deep indie rock"},{"genre":"appenzeller folk"},{"genre":"indie nordeste argentino"},{"genre":"deep neo-synthpop"},{"genre":"kadongo kamu"},{"genre":"irish death metal"},{"genre":"metal catarinense"},{"genre":"central american metal"},{"genre":"turkish hardcore"},{"genre":"animal singing"},{"genre":"trombone ensemble"},{"genre":"tatar folk"},{"genre":"metal cearense"},{"genre":"baltic classical piano"},{"genre":"marathi balgeet"},{"genre":"deep southern soul"},{"genre":"balochi folk"},{"genre":"pansori"},{"genre":"dizi"},{"genre":"brazilian classical piano"},{"genre":"musique traditionnelle comorienne"},{"genre":"inuit traditional"},{"genre":"south african techno"},{"genre":"lagu jambi"},{"genre":"sarangi"},{"genre":"euphonium"},{"genre":"spanish contemporary classical"},{"genre":"experimental poetry"},{"genre":"rock nacional feminino"},{"genre":"yiddish folk"},{"genre":"accordion band"},{"genre":"musica sinfonica"},{"genre":"trecento"},{"genre":"sacred harp"},{"genre":"portuguese experimental"},{"genre":"deep r&b"},{"genre":"polish experimental"},{"genre":"grunge argentina"},{"genre":"akordeon"},{"genre":"hard dance"},{"genre":"metal baiano"},{"genre":"harmonikka"},{"genre":"black metal argentino"},{"genre":"kamba pop"},{"genre":"ghanaian traditional"},{"genre":"taarab"},{"genre":"nordnorsk ponk"},{"genre":"industrial noise"},{"genre":"hard stoner rock"},{"genre":"venezuelan metal"},{"genre":"traditional irish singing"},{"genre":"luxembourgian electronic"},{"genre":"malaysian post-rock"},{"genre":"chinese black metal"},{"genre":"santa fe indie"},{"genre":"malian traditional"},{"genre":"grunge brasileiro"},{"genre":"kazakh traditional"},{"genre":"vietnamese traditional"},{"genre":"tanzanian traditional"},{"genre":"classical guitar quartet"},{"genre":"deep delta blues"},{"genre":"ethereal gothic"},{"genre":"maltese metal"},{"genre":"estonian jazz"},{"genre":"historical keyboard"},{"genre":"jaw harp"},{"genre":"irish hardcore"},{"genre":"musica puntana"},{"genre":"alphorn"},{"genre":"alternative hardcore"},{"genre":"deep latin jazz"},{"genre":"classical contralto"},{"genre":"bulgarian experimental"},{"genre":"trouvere"},{"genre":"classical piano duo"},{"genre":"deep chill-out"},{"genre":"punk ska"},{"genre":"police band"},{"genre":"czech contemporary classical"},{"genre":"balkan classical piano"},{"genre":"uyghur folk"},{"genre":"swedish jazz orkester"},{"genre":"jewish cantorial"},{"genre":"musica urbana oaxaquena"},{"genre":"school choir"},{"genre":"ars subtilior"},{"genre":"necrogrind"},{"genre":"musique tchadienne"},{"genre":"montana metal"},{"genre":"irish modern jazz"},{"genre":"cypriot metal"},{"genre":"portuguese classical"},{"genre":"australian choir"},{"genre":"ghoststep"},{"genre":"new zealand classical"},{"genre":"iranian metal"},{"genre":"puerto rican metal"},{"genre":"indonesian electronic"},{"genre":"canto a tenore"},{"genre":"chilean black metal"},{"genre":"lagu lampung"},{"genre":"bells"},{"genre":"south african dnb"},{"genre":"jangle rock"},{"genre":"huqin"},{"genre":"romanian classical piano"},{"genre":"peruvian death metal"},{"genre":"brazilian doom metal"},{"genre":"deep indie pop"},{"genre":"art song"},{"genre":"metis fiddle"},{"genre":"classical horn"},{"genre":"central asian folk"},{"genre":"rock cristao fluminense"},{"genre":"pygmy music"},{"genre":"shantykoren"},{"genre":"cosmic uplifting trance"},{"genre":"hawaiian punk"},{"genre":"deep motown"},{"genre":"pibroch"},{"genre":"russian oi"},{"genre":"caribbean metal"},{"genre":"school ensemble"},{"genre":"twee indie pop"},{"genre":"vanuatu music"},{"genre":"horo"},{"genre":"tahitian traditional"},{"genre":"metal nortista"},{"genre":"handbells"},{"genre":"polish early music"},{"genre":"musica ponta-grossense"},{"genre":"schrammelmusik"},{"genre":"indie tabasqueno"},{"genre":"metal pernambucano"},{"genre":"classical saxophone quartet"},{"genre":"czech experimental"},{"genre":"deep symphonic black metal"},{"genre":"musica mogiana"},{"genre":"opera chorus"},{"genre":"albanian iso polyphony"},{"genre":"drone psych"},{"genre":"draaiorgel"},{"genre":"sirmauri pop"},{"genre":"twin cities indie"},{"genre":"austrian contemporary classical"},{"genre":"clarinet ensemble"},{"genre":"baroque woodwind"},{"genre":"indonesian indigenous traditional"},{"genre":"burkinabe traditional"},{"genre":"musica maringaense"},{"genre":"harsh noise wall"},{"genre":"chip hop"},{"genre":"swiss contemporary classical"},{"genre":"modern downshift"},{"genre":"polish choir"},{"genre":"baroque violin"},{"genre":"lagu madura"},{"genre":"deep smooth r&b"},{"genre":"trad jazz catala"},{"genre":"dark electro-industrial"},{"genre":"kaba gaida"},{"genre":"rock noise"},{"genre":"wagnerian singing"},{"genre":"indie emo rock"},{"genre":"peruvian experimental"},{"genre":"musique alsacienne"},{"genre":"cantonese traditional"},{"genre":"belgian classical piano"},{"genre":"deep power-pop punk"},{"genre":"deep deep tech house"},{"genre":"rwandan traditional"},{"genre":"kyrgyz traditional"},{"genre":"burmese traditional"},{"genre":"chinese opera"},{"genre":"burundian traditional"},{"genre":"baroque cello"},{"genre":"cambodian traditional"},{"genre":"vintage swoon"},{"genre":"musique centrafricaine"},{"genre":"faroese jazz"},{"genre":"bruneian indie"},{"genre":"korean classical piano"},{"genre":"vintage rockabilly"},{"genre":"rhythm and boogie"},{"genre":"marci brijuzi"},{"genre":"papuan traditional"},{"genre":"macedonian metal"},{"genre":"lao traditional"},{"genre":"gay chorus"},{"genre":"wind quintet"},{"genre":"polish free jazz"},{"genre":"deep breakcore"},{"genre":"tanci"},{"genre":"balikpapan indie"},{"genre":"uzbek traditional"},{"genre":"musica timor-leste"},{"genre":"italian violin"},{"genre":"wandelweiser"},{"genre":"bothy ballad"},{"genre":"metal piauiense"},{"genre":"kenyan traditional"},{"genre":"quatuor a cordes"},{"genre":"italian choir"},{"genre":"zampogna"},{"genre":"ugandan traditional"},{"genre":"yemeni traditional"},{"genre":"tajik traditional"},{"genre":"wind ensemble"},{"genre":"hungarian choir"},{"genre":"swiss classical piano"},{"genre":"mazandarani folk"},{"genre":"historic string quartet"},{"genre":"italian mezzo-soprano"},{"genre":"swazi traditional"},{"genre":"trallalero"},{"genre":"baroque brass"},{"genre":"himene tarava"},{"genre":"vintage western"},{"genre":"classical string trio"},{"genre":"cinematic dubstep"},{"genre":"quartetto d'archi"},{"genre":"yunnan traditional"},{"genre":"classical piano quartet"},{"genre":"string quintet"},{"genre":"youth orchestra"}];
  function ensureCanonicalSubgenreMap(genreMap = genrePlaylistsCache) {
    const hasEveryNoise = Boolean(genreMap && Array.isArray(genreMap) && genreMap.length > 0);
    if (canonicalSubgenreMap && (!hasEveryNoise || canonicalSubgenreMap._hasEveryNoise)) {
      return canonicalSubgenreMap;
    }

    const wasUpgraded = Boolean(canonicalSubgenreMap && !canonicalSubgenreMap._hasEveryNoise && hasEveryNoise);
    const map = new Map();
    const register = (rawStr) => {
      if (!rawStr) return;
      const clean = rawStr.toLowerCase().trim();
      if (!clean) return;
      const norm = normalizeGenre(clean);
      const key = getNormalizedGenreKey(clean);
      const canonical = GENRE_ALIAS_MAP.get(clean) || GENRE_ALIAS_MAP.get(norm) || map.get(norm) || map.get(key) || clean;
      if (!map.has(clean)) map.set(clean, canonical);
      if (norm && !map.has(norm)) map.set(norm, canonical);
      if (key && !map.has(key)) map.set(key, canonical);
    };

    if (typeof GENRE_ALIASES_RAW !== "undefined" && GENRE_ALIASES_RAW) {
      Object.keys(GENRE_ALIASES_RAW).forEach(register);
    }
    if (typeof GENRE_MAPPINGS !== "undefined" && GENRE_MAPPINGS) {
      Object.keys(GENRE_MAPPINGS).forEach(register);
    }
    if (hasEveryNoise) {
      genreMap.forEach(p => { if (p?.genre) register(p.genre); });
    }
    if (typeof GENRE_MAPPINGS !== "undefined" && GENRE_MAPPINGS) {
      Object.values(GENRE_MAPPINGS).forEach(arr => arr.forEach(register));
    }
    if (typeof BLACKLIST_UMBRELLA_MAP !== "undefined" && BLACKLIST_UMBRELLA_MAP) {
      Object.keys(BLACKLIST_UMBRELLA_MAP).forEach(register);
      Object.values(BLACKLIST_UMBRELLA_MAP).forEach(arr => arr.forEach(register));
    }

    map._hasEveryNoise = hasEveryNoise;
    canonicalSubgenreMap = map;
    if (wasUpgraded) {
      // The bundled catalog is immutable; no external filter caches exist.
    }
    return map;
  }
  function toCanonicalSubgenreName(tag, genreMap = genrePlaylistsCache) {
    if (!tag) return "";
    const lower = (typeof tag === 'string' ? tag : (tag?.name || '')).toLowerCase().trim();
    if (!lower) return "";
    if (GENRE_ALIAS_MAP.has(lower)) return GENRE_ALIAS_MAP.get(lower);
    const map = ensureCanonicalSubgenreMap(genreMap);
    const norm = normalizeGenre(lower);
    return map.get(lower) || map.get(norm) || map.get(getNormalizedGenreKey(norm)) || norm || lower;
  }
  function isSpotifyTrackExcludedConcept(tag) {
    if (!tag) return false;
    const lower = (typeof tag === 'string' ? tag : (tag?.name || '')).toLowerCase().trim();
    if (GENRE_FILTER_ALLOWED_MOOD_GENRES.has(lower)) return false;
    if (lower === "children's music" || MOOD_DESCRIPTORS_SET.has(lower)) return true;
    const norm = normalizeGenre(lower);
    if (GENRE_FILTER_ALLOWED_MOOD_GENRES.has(norm)) return false;
    return norm === "children's music" || MOOD_DESCRIPTORS_SET.has(norm);
  }
  return {
    validate(name, score) {
      const normalized = String(name || '').toLowerCase().trim();
      return !!normalized && !/^\d+$/.test(normalized)
        && (!Number.isFinite(score) || score > 0.05)
        && !isCountryOnly(normalized) && !isSpotifyTrackExcludedConcept(normalized)
        && isWhitelistedGenre(normalized, genrePlaylistsCache);
    },
    format(concepts) {
      const items = [];
      for (const concept of concepts) {
        const specific = toCanonicalSubgenreName(concept.name);
        const grouped = VARIANT_TO_MAIN_GENRE_MAP[getNormalizedGenreKey(normalizeGenre(concept.name))] || [specific];
        const rawValue = concept.rawValue || concept.name;
        if (specific) items.push({ name: specific, kind: 'style', rawValue });
        for (const label of grouped) if (label && !isSpotifyTrackExcludedConcept(label)) items.push({ name: label, kind: 'genre', rawValue });
      }
      return items;
    }
  };
})();

/* Standalone Spicetify integration. No Sort Play globals, buttons or settings are used. */
async function startGenre4all() {
  'use strict';
  const KEY = 'genre4all-visible-v1';
  const ORDER_KEY = 'genre4all-order-offset-v1';
  const COLUMNS_KEY = 'genre4all-column-order-v1';
  const ROW = '.main-trackList-trackListHeaderRow,.main-trackList-trackListRow,[role="row"]';
  const ROOT = '.main-trackList-trackList,[data-testid="tracklist"],[role="grid"]';
  const CELL = '[role="columnheader"],[role="gridcell"],[class*="main-trackList-rowSection"]';
  const CONFIG_ICON = '<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2v9.5a2.5 2.5 0 1 1-1.5-2.3V4.3L6 5.9v7.6a2.5 2.5 0 1 1-1.5-2.3V2.7L14 1v1zm-9.5 9.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm8-2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>';
  const lifecycle = new AbortController(), roots = new Map(), layouts = new Map(), rowCache = new WeakMap();
  let closed = false, frame = null, preferences = null, view = null, service = null, profileMenuItem = null;
  let visible = true, orderOffset = 0, columnOrder = [], metadataClient = null, metadataTransport = null, MetadataServiceClass = null, lastDiscovery = 0, unlisten = null;
  try {
    visible = localStorage.getItem(KEY) !== 'false';
    orderOffset = Math.max(0, parseInt(localStorage.getItem(ORDER_KEY) || '0', 10) || 0);
    const savedColumns = JSON.parse(localStorage.getItem(COLUMNS_KEY) || '[]');
    if (Array.isArray(savedColumns)) columnOrder = savedColumns.filter(k => typeof k === 'string' && k);
  } catch { /* Session preference still works. */ }
  const context = () => globalThis.Spicetify?.Platform?.History?.location?.pathname || location.pathname;
  const api = {
    version: '1.11.0',
    get visible() { return visible; },
    get orderOffset() { return orderOffset; },
    get columnOrder() { return [...columnOrder]; },
    setVisible,
    setOrderOffset,
    setColumnOrder,
    openConfig: showPreferences,
    sync: schedule,
    close,
    diagnostics: () => ({ version: api.version, visible, orderOffset, columnOrder: [...columnOrder], context: context(), roots: roots.size, rows: layouts.size, service: service?.stats(), view: view?.stats(), metadataAvailable: !!metadataClient })
  };
  // One instance even if Marketplace and a manual installation both load the file.
  globalThis.Genre4all?.close?.();
  globalThis.Genre4all = api;

  if (!customElements.get('genre4all-column')) {
    customElements.define('genre4all-column', class extends HTMLElement {
      constructor() { super(); this.semantics = this.attachInternals?.(); }
      connectedCallback() {
        if (this.semantics) {
          this.semantics.role = this.dataset.kind === 'header' ? 'columnheader' : 'gridcell';
          this.semantics.ariaLabel = 'Gênero';
        }
      }
    });
  }
  const style = document.createElement('style');
  style.id = 'genre4all-runtime-style';
  style.textContent = `
    /* Role lives in ElementInternals: other extensions' [role=gridcell] scans ignore our shell. */
    .g4a-root .g4a-row:not([data-g4a-measure]) { grid-template-columns:var(--g4a-tracks) !important; min-width:var(--g4a-total) !important; }
    .g4a-root .g4a-row:not([data-g4a-measure]) > [data-g4a-position] { grid-column:var(--g4a-position) !important; min-width:0; }
    genre4all-column { display:flex; align-items:center; min-width:0; overflow:hidden; box-sizing:border-box; }
    genre4all-column[data-kind=data] { overflow:visible; }
    genre4all-column[data-kind=header] { position:relative; justify-content:flex-start; justify-self:stretch; width:100%; height:100%; color:var(--text-subdued,var(--spice-subtext,#b3b3b3)); font-size:0.875rem; font-weight:400; line-height:normal; cursor:grab; user-select:none; }
    .g4a-root:not([data-sp-native-layout]) [role="columnheader"][data-g4a-col-key] { cursor:grab; user-select:none; }
    genre4all-column[data-kind=header].g4a-header-dragging,[role="columnheader"].g4a-header-dragging { cursor:grabbing !important; opacity:.75; z-index:3; }
    genre4all-column .g4a-genre-host { width:100%; }
    .g4a-header-label { min-width:0; margin-inline-end:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    [data-g4a-prev-sep] { display:flex; align-items:center; }
    .g4a-header-sep { cursor:col-resize; flex:0 0 8px; width:8px; height:50%; margin-inline-start:auto; user-select:none; touch-action:none; }
    .g4a-row:hover .g4a-header-sep,.g4a-row:focus-within .g4a-header-sep,html.g4a-resizing .g4a-header-sep { background:linear-gradient(rgba(var(--spice-rgb-text,255,255,255),.302),rgba(var(--spice-rgb-text,255,255,255),.302)) 50%/1px 100% no-repeat; }
    html.g4a-resizing,html.g4a-resizing * { cursor:col-resize !important; user-select:none !important; }
    html.g4a-reordering,html.g4a-reordering * { cursor:grabbing !important; user-select:none !important; }
    [data-g4a-measure] > genre4all-column,[data-g4a-measure] [data-g4a-sep] { display:none !important; }
    .g4a-root[data-g4a-overflow].g4a-root { overflow-x:auto !important; }
    .g4a-root[data-g4a-overflow] > div:has([role="columnheader"]),.g4a-root[data-sp-native-layout] > div:has([role="columnheader"]) { margin-inline:0 !important; padding-inline:0 !important; }
    .g4a-root[data-sp-native-layout] [data-sp-layout-position="native:end"] > .sp-layout-resize { display:none !important; }
    .g4a-root[data-sp-native-layout] .sp-layout-resize::after { top:25% !important; bottom:25% !important; left:5.5px !important; width:1px !important; border-radius:0 !important; background:rgba(var(--spice-rgb-text,255,255,255),.302) !important; opacity:0 !important; }
    .g4a-root[data-sp-native-layout] .g4a-row:hover .sp-layout-resize::after,.g4a-root[data-sp-native-layout] .g4a-row:focus-within .sp-layout-resize::after,.g4a-root[data-sp-native-layout] .sp-layout-resize:hover::after,.g4a-root[data-sp-native-layout] .sp-layout-resize:focus-visible::after { opacity:1 !important; }
    .g4a-root[data-sp-native-layout] .sort-play-column-header { justify-content:flex-start !important; text-align:left !important; font-size:0.875rem !important; font-weight:400 !important; }
    .g4a-menu-button,.g4a-profile-button { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; min-height:40px; padding:12px 16px; border:0; border-radius:2px; color:var(--text-base,#eee); background:transparent; text-align:left; font:inherit; cursor:pointer; }
    .g4a-profile-button { justify-content:flex-start; }
    .g4a-menu-button:hover,.g4a-menu-button:focus-visible,.g4a-profile-button:hover,.g4a-profile-button:focus-visible { background:#ffffff1a; outline-offset:-2px; }
    .g4a-menu-button[aria-checked=true] { color:var(--text-positive,#1ed760); }
    .g4a-menu-button svg,.g4a-profile-button svg { width:16px; height:16px; flex:none; fill:currentColor; }
    .g4a-preferences { position:fixed; inset:0; margin:auto; padding:24px; max-width:460px; width:calc(100vw - 40px); max-height:calc(100vh - 40px); overflow-y:auto; box-sizing:border-box; border:1px solid #555; border-radius:10px; color:var(--spice-text,#fff); background:var(--spice-main,#181818); font:14px/1.45 sans-serif; box-shadow:0 20px 50px rgba(0,0,0,.65); }
    .g4a-preferences::backdrop { background:#000a; }
    .g4a-preferences h2 { margin:0 0 14px; font:700 18px/1.3 sans-serif; display:flex; align-items:center; justify-content:space-between; }
    .g4a-preferences h3 { margin:16px 0 8px; font:600 12px/1.2 sans-serif; text-transform:uppercase; letter-spacing:.06em; color:var(--spice-subtext,#b3b3b3); }
    .g4a-preferences label { display:flex; gap:10px; margin:10px 0; align-items:center; cursor:pointer; }
    .g4a-preferences input[type="checkbox"] { accent-color:#1ed760; }
    .g4a-preferences-field { display:flex; flex-direction:column; gap:5px; margin:10px 0 14px; }
    .g4a-preferences-field span { font-size:12px; color:var(--spice-subtext,#ccc); }
    .g4a-preferences-input { width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #555; border-radius:5px; background:#121212; color:var(--spice-text,#fff); font:13px/1.3 monospace,sans-serif; }
    .g4a-preferences-input:focus { border-color:#1ed760; outline:none; }
    .g4a-preferences-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:18px; justify-content:flex-end; }
    .g4a-preferences button { padding:8px 14px; color:inherit; background:transparent; border:1px solid #aaa; border-radius:4px; cursor:pointer; font:inherit; }
    .g4a-preferences button:hover { background:#ffffff14; }
  `;
  document.head.append(style);

  const normalize = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  function node(tag, text, attrs = {}) {
    const n = document.createElement(tag); if (text != null) n.textContent = text;
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
    return n;
  }
  function ownProperty(n, name, value) {
    if (n.style.getPropertyValue(name) !== value) n.style.setProperty(name, value);
  }
  function schedule() { if (!closed && frame === null) frame = requestAnimationFrame(sync); }
  function invalidateLayouts(resetWeights = false) {
    for (const rootState of roots.values()) {
      rootState.measured = null;
      rootState.midOrder = null;
      rootState.headerForeign = null;
      rootState.midOrderCount = -1;
      if (resetWeights) rootState.weights = null;
    }
    for (const state of layouts.values()) state.appliedKey = null;
  }
  function setVisible(value) {
    visible = !!value;
    try { localStorage.setItem(KEY, String(visible)); } catch { /* Keep the current session usable. */ }
    if (!visible) {
      view?.reset();
      for (const row of [...layouts.keys()]) releaseRow(row);
      for (const root of roots.keys()) { root.classList.remove('g4a-root'); root.removeAttribute('data-g4a-overflow'); }
    }
    invalidateLayouts(false);
    for (const rootState of roots.values()) { rootState.midOrder = null; rootState.headerForeign = null; rootState.midOrderCount = -1; }
    updateMenus(); schedule();
  }
  function setOrderOffset(value) {
    const next = Math.max(0, Math.floor(Number(value) || 0));
    orderOffset = next;
    try { localStorage.setItem(ORDER_KEY, String(orderOffset)); } catch { /* Keep the current session usable. */ }
    if (columnOrder.length) {
      const withoutGenre = columnOrder.filter(k => k !== '__genre__');
      const idx = Math.max(0, Math.min(withoutGenre.length, withoutGenre.length - orderOffset));
      withoutGenre.splice(idx, 0, '__genre__');
      columnOrder = withoutGenre;
      try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(columnOrder)); } catch { /* Keep session usable. */ }
    }
    invalidateLayouts(true);
    sync();
  }
  function setColumnOrder(order) {
    if (!Array.isArray(order)) return;
    columnOrder = [...new Set(order.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()))];
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(columnOrder)); } catch { /* Keep session usable. */ }
    const genreIdx = columnOrder.indexOf('__genre__');
    if (genreIdx >= 0) {
      orderOffset = Math.max(0, (columnOrder.length - 1) - genreIdx);
      try { localStorage.setItem(ORDER_KEY, String(orderOffset)); } catch { /* Keep session usable. */ }
    }
    invalidateLayouts(false);
    for (const rootState of roots.values()) { rootState.midOrder = null; rootState.headerForeign = null; rootState.midOrderCount = -1; }
    sync();
  }

  // Adapted from Sort-Play-2 getWebpackService/getMetadataClient; scoped to this extension.
  function resolveTransport() {
    const platform = globalThis.Spicetify?.Platform;
    return platform?.ProductStateAPI?.productStateApi?.transport || platform?.Transport || platform?.PlayerAPI?._queue?._client?._transport || null;
  }
  function getMetadataClient() {
    const currentTransport = resolveTransport();
    if (metadataClient && (!currentTransport || metadataTransport === currentTransport)) return metadataClient;
    if (MetadataServiceClass && currentTransport) {
      metadataTransport = currentTransport;
      metadataClient = new MetadataServiceClass(currentTransport);
      return metadataClient;
    }
    if (Date.now() - lastDiscovery < 3000) return null;
    lastDiscovery = Date.now();
    const chunk = window.rspackChunk ?? window.webpackChunkclient_web ?? window.rspackChunkclient_web;
    if (!chunk) return null;
    let req;
    try {
      const ret = chunk.push([[Symbol('genre4all')], {}, r => { req = r; return r; }]);
      if (!req && typeof ret === 'function') req = ret;
      if (!req?.m) return null;
      for (const id of Object.keys(req.m)) {
        let exports; try { exports = req(id); } catch { continue; }
        const candidates = [exports];
        if (exports && (typeof exports === 'object' || typeof exports === 'function')) {
          for (const key of Object.keys(exports)) { try { candidates.push(exports[key]); } catch { /* Lazy export. */ } }
        }
        const MetadataService = candidates.find(c => c?.SERVICE_ID === 'spotify.mdata_esperanto.proto.MetadataService');
        if (!MetadataService) continue;
        MetadataServiceClass = MetadataService;
        if (!currentTransport) return null;
        metadataTransport = currentTransport;
        metadataClient = new MetadataService(currentTransport);
        return metadataClient;
      }
    } catch (error) { console.warn('[Genre4all] MetadataService indisponível.', error); }
    return null;
  }

  const validUri = uri => typeof uri === 'string' && /^spotify:(track|local):/.test(uri);
  function computeUri(row, rowProps, firstProps, fiber, dataUri, fallbackHref) {
    const seen = new Set();
    function find(value, depth = 10) {
      if (!value || typeof value !== 'object' || !depth || seen.has(value) || seen.size > 300) return null;
      seen.add(value);
      if (validUri(value.uri)) return value.uri;
      for (const key of Object.keys(value)) if (['children','props','value','item','track','data','content','node','spec','_path'].includes(key) || /^\d+$/.test(key)) {
        const uri = find(value[key], depth - 1); if (uri) return uri;
      }
      return null;
    }
    // React identity wins over a stale DOM link in a recycled row.
    for (const props of [rowProps, firstProps]) {
      const uri = find(props); if (uri) return uri;
    }
    const first = row.firstElementChild;
    const firstFiberKey = first ? (first.__g4aFiberKey ?? (first.__g4aFiberKey = Object.keys(first).find(k => k.startsWith('__reactFiber$')) || '')) : '';
    for (const startFiber of [fiber, firstFiberKey ? first[firstFiberKey] : null].filter(Boolean)) {
      for (let f = startFiber, i = 0; f && i < 8; f = f.return, i++) {
        const uri = find(f.pendingProps) || find(f.memoizedProps); if (uri) return uri;
      }
    }
    if (validUri(dataUri)) return dataUri;
    const href = fallbackHref || row.querySelector('a[href*="/track/"]')?.getAttribute('href');
    const id = href?.match(/\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/)?.[1];
    return id ? `spotify:track:${id}` : null;
  }
  function getRowMeta(row) {
    const propsKey = row.__g4aPropsKey ?? (row.__g4aPropsKey = Object.keys(row).find(k => k.startsWith('__reactProps$')) || '');
    const fiberKey = row.__g4aFiberKey ?? (row.__g4aFiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber$')) || '');
    const first = row.firstElementChild;
    const firstPropsKey = first ? (first.__g4aPropsKey ?? (first.__g4aPropsKey = Object.keys(first).find(k => k.startsWith('__reactProps$')) || '')) : '';
    const rowProps = propsKey ? row[propsKey] : null;
    const firstProps = first && firstPropsKey ? first[firstPropsKey] : null;
    const fiber = fiberKey ? row[fiberKey] : null;
    const fiberProps = fiber?.memoizedProps || fiber?.pendingProps || null;
    const rowIndex = row.getAttribute('aria-rowindex') || '';
    const dataUri = row.dataset.uri || '';
    const itemUri = rowProps?.item?.uri || rowProps?.children?.props?.item?.uri || firstProps?.item?.uri || fiberProps?.item?.uri || '';
    const href = !rowProps && !firstProps && !fiberProps && !dataUri ? (row.querySelector('a[href*="/track/"]')?.getAttribute('href') || '') : '';
    const cached = rowCache.get(row);
    if (cached && cached.rowProps === rowProps && cached.firstProps === firstProps && cached.fiberProps === fiberProps
      && cached.rowIndex === rowIndex && cached.dataUri === dataUri && cached.itemUri === itemUri && cached.href === href) {
      return cached;
    }
    const uri = computeUri(row, rowProps, firstProps, fiber, dataUri, href);
    const entry = { rowProps, firstProps, fiberProps, rowIndex, dataUri, itemUri, href, uri, track: null };
    rowCache.set(row, entry);
    return entry;
  }
  function getUri(row) { return getRowMeta(row).uri; }
  function track(row) {
    const meta = getRowMeta(row);
    if (!meta.uri) return { uri: null };
    if (!meta.track || meta.track.uri !== meta.uri) meta.track = Genre4allColumn.trackFromRow(row, meta.uri);
    return meta.track;
  }

  function makeStorage() {
    const memory = new Map();
    let disk;
    try { disk = Genre4allTransport.createIndexedDBStorage(); } catch { /* Memory cache fallback. */ }
    let failed = !disk;
    async function use(method, space, key, value) {
      if (method === 'set') memory.set(space + ':' + key, value);
      if (method === 'remove') memory.delete(space + ':' + key);
      if (method === 'clear') for (const k of memory.keys()) if (k.startsWith(space + ':')) memory.delete(k);
      if (!failed) {
        try { return await disk[method](space, key, value); }
        catch { failed = true; console.warn('[Genre4all] Armazenamento persistente indisponível; usando cache temporário.'); }
      }
      if (method === 'get') return memory.get(space + ':' + key);
      if (method === 'entries') return [...memory].filter(([k]) => k.startsWith(space + ':')).map(([k,v]) => [k.slice(space.length + 1),v]);
    }
    return Object.fromEntries(['get','set','remove','clear','entries'].map(method => [method, (...args) => use(method, ...args)]).concat([['close', () => disk?.close().catch(() => {})]]));
  }
  const storage = makeStorage();
  function showPreferences() {
    preferences?.remove();
    const cfg = service?.getConfig() || {};
    const d = node('dialog', null, { class: 'g4a-preferences', 'aria-label': 'Genre4all config' });
    d.append(node('h2', 'Genre4all config'));

    d.append(node('h3', 'Fontes e Chaves de API (Discogs → MusicBrainz → Spotify)'));
    for (const [providerKey, providerLabel] of [
      ['discogs', 'Priorizar Discogs (Moldura Branca)'],
      ['musicbrainz', 'Usar MusicBrainz + Spotify (Moldura Roxo/Laranja)'],
      ['spotify', 'Usar Spotify (Complementar / Fallback)']
    ]) {
      const row = node('label', providerLabel);
      const input = node('input', null, { type: 'checkbox', 'data-g4a-provider': providerKey });
      input.checked = cfg.enabled?.[providerKey] !== false;
      input.addEventListener('change', () => {
        service?.configure({ enabled: { [providerKey]: input.checked } })
          .catch(() => Spicetify.showNotification?.('Genre4all: não foi possível salvar a preferência.', true));
      });
      row.prepend(input);
      d.append(row);
    }

    const discogsField = node('div', null, { class: 'g4a-preferences-field' });
    discogsField.append(node('span', 'Chave da API do Discogs (Personal Access Token ou key:secret)'));
    const discogsInput = node('input', null, {
      type: 'password',
      class: 'g4a-preferences-input',
      name: 'discogsToken',
      'data-g4a-field': 'discogsToken',
      placeholder: 'Cole seu token do Discogs (discogs.com/settings/developers)',
      autocomplete: 'off'
    });
    discogsInput.value = cfg.discogsToken || '';
    discogsField.append(discogsInput);
    d.append(discogsField);

    const mbField = node('div', null, { class: 'g4a-preferences-field' });
    mbField.append(node('span', 'Chave / Token da API do MusicBrainz (opcional)'));
    const mbInput = node('input', null, {
      type: 'password',
      class: 'g4a-preferences-input',
      name: 'musicbrainzToken',
      'data-g4a-field': 'musicbrainzToken',
      placeholder: 'Opcional (MusicBrainz já funciona sem chave)',
      autocomplete: 'off'
    });
    mbInput.value = cfg.musicbrainzToken || '';
    mbField.append(mbInput);
    d.append(mbField);

    const saveTokens = () => {
      const current = service?.getConfig() || {};
      const nextDiscogs = discogsInput.value.trim();
      const nextMb = mbInput.value.trim();
      if (nextDiscogs !== (current.discogsToken || '') || nextMb !== (current.musicbrainzToken || '')) {
        return service?.configure({ discogsToken: nextDiscogs, musicbrainzToken: nextMb })
          .catch(() => Spicetify.showNotification?.('Genre4all: não foi possível salvar a chave de API.', true));
      }
      return Promise.resolve();
    };
    discogsInput.addEventListener('change', saveTokens);
    mbInput.addEventListener('change', saveTokens);

    d.append(node('h3', 'Exibição'));
    for (const [key, label] of [['colors','Cores nos gêneros'],['showGenres','Mostrar gêneros principais'],['showStyles','Mostrar subgêneros e estilos']]) {
      const row = node('label', label), input = node('input', null, { type: 'checkbox' });
      input.checked = !!service?.getConfig()?.[key];
      input.addEventListener('change', () => service?.configure({ [key]: input.checked }).catch(() => Spicetify.showNotification?.('Genre4all: não foi possível salvar a preferência.', true)));
      row.prepend(input); d.append(row);
    }
    d.append(node('h3', 'Cache leve (armazenamento rápido)'));
    const cacheInfo = node('div', null, { class: 'g4a-preferences-field', 'data-g4a-cache-info': '' });
    const updateCacheCount = () => {
      const count = service?.stats()?.providerCache ?? 0;
      cacheInfo.textContent = '';
      cacheInfo.append(node('span', `Registros em cache local (TXT / IndexedDB): ${count}`));
    };
    updateCacheCount();
    d.append(cacheInfo);

    const actions = node('div', null, { class: 'g4a-preferences-actions' });
    const refresh = node('button', 'Atualizar gêneros', { type: 'button' });
    const clearCacheBtn = node('button', 'Limpar cache', { type: 'button', 'data-g4a-action': 'clear-cache' });
    const done = node('button', 'Fechar', { type: 'button' });
    const dismiss = () => {
      saveTokens();
      d.close(); d.remove();
      if (preferences === d) preferences = null;
    };
    refresh.addEventListener('click', () => {
      saveTokens().finally(() => {
        dismiss();
        service?.clearCache().catch(() => {});
      });
    });
    clearCacheBtn.addEventListener('click', () => {
      saveTokens()
        .then(() => service?.clearCache())
        .then(() => {
          updateCacheCount();
          clearCacheBtn.textContent = 'Cache limpo!';
          globalThis.Spicetify?.showNotification?.('Genre4all: cache limpo com sucesso.');
        })
        .catch(() => globalThis.Spicetify?.showNotification?.('Genre4all: falha ao limpar cache.', true));
    });
    done.addEventListener('click', dismiss);
    d.addEventListener('cancel', e => { e.preventDefault(); dismiss(); });
    for (const type of ['keydown', 'keyup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'contextmenu']) d.addEventListener(type, e => e.stopPropagation());
    actions.append(refresh, clearCacheBtn, done);
    d.append(actions);
    document.body.append(d); preferences = d; d.showModal(); done.focus();
  }

  function cells(container, checkComputed = false) {
    return [...container.children].filter(c => {
      if (!c.matches(CELL) || c.style.display === 'none' || c.hidden) return false;
      return !checkComputed || getComputedStyle(c).display !== 'none';
    });
  }
  function visualCells(container) {
    return [...container.children]
      .filter(c => (c.matches(CELL) || c.tagName === 'GENRE4ALL-COLUMN') && c.style.display !== 'none' && !c.hidden && getComputedStyle(c).display !== 'none')
      .sort((a, b) => (parseInt(a.style.getPropertyValue('--g4a-position'), 10) || 0) - (parseInt(b.style.getPropertyValue('--g4a-position'), 10) || 0));
  }
  function rowContainer(row) {
    if (cells(row).length) return row;
    if (row.children.length === 1 && cells(row.firstElementChild).length) return row.firstElementChild;
    return null;
  }
  function colKeyForHeader(cell, m) {
    if (cell.tagName === 'GENRE4ALL-COLUMN') return '__genre__';
    const typeAttr = cell.getAttribute('data-column-type') || cell.querySelector('[data-column-type]')?.getAttribute('data-column-type');
    if (typeAttr) return normalize(typeAttr).trim();
    const textEl = cell.querySelector('[data-encore-id="text"], span');
    const raw = normalize((textEl ? textEl.textContent : cell.textContent) || cell.getAttribute('aria-label') || '').trim();
    return raw || `col-${m}`;
  }
  function buildMidOrder(foreignHeader, minInsert, endIndex) {
    const midCount = Math.max(0, endIndex - minInsert);
    const seenKeys = new Set();
    const items = [];
    for (let m = 0; m < midCount; m++) {
      const cell = foreignHeader ? foreignHeader[minInsert + m] : null;
      let k = cell ? colKeyForHeader(cell, m) : `col-${m}`;
      if (seenKeys.has(k)) k = `${k}#${m}`;
      seenKeys.add(k);
      items.push({ type: 'native', index: minInsert + m, key: k });
    }
    const genreDefaultIdx = Math.max(0, Math.min(midCount, midCount - orderOffset));
    items.splice(genreDefaultIdx, 0, { type: 'genre', index: -1, key: '__genre__' });
    if (columnOrder.length >= 2) {
      const rank = new Map(columnOrder.map((k, idx) => [k, idx]));
      const matchedSlots = [];
      const matchedItems = [];
      items.forEach((item, idx) => {
        if (rank.has(item.key)) {
          matchedSlots.push(idx);
          matchedItems.push(item);
        }
      });
      if (matchedItems.length >= 2) {
        matchedItems.sort((a, b) => rank.get(a.key) - rank.get(b.key));
        matchedSlots.forEach((slotIdx, i) => { items[slotIdx] = matchedItems[i]; });
      }
    }
    return items;
  }

  function attachResize(root, rootState) {
    const resolvePair = sep => {
      const headerCell = sep.closest('[role="columnheader"],genre4all-column[data-kind="header"]');
      const container = headerCell?.parentElement;
      if (!container || !layouts.has(container)) return null;
      const all = visualCells(container);
      const end = all.find(c => c.matches('.main-trackList-rowSectionEnd,[data-sp-layout-position="native:end"]')) || all[all.length - 1];
      const endIndex = all.indexOf(end);
      const flexStart = endIndex > 2 ? 1 : 0;
      const flexCells = all.slice(flexStart, endIndex);
      const k = flexCells.indexOf(headerCell);
      return k >= 0 && flexCells.length >= 2 ? { flexCells, k } : null;
    };
    const adjust = (startWidths, k, dx) => {
      const next = [...startWidths];
      const a = k < next.length - 1 ? k : k - 1, b = a + 1;
      const sign = k < next.length - 1 ? 1 : -1;
      const minA = a === 0 ? 120 : 80, minB = 80;
      const delta = Math.max(minA - startWidths[a], Math.min(startWidths[b] - minB, sign * dx));
      next[a] = startWidths[a] + delta;
      next[b] = startWidths[b] - delta;
      return next;
    };
    const startHeaderInteraction = e => {
      if (!visible || root.hasAttribute('data-sp-native-layout') || e.button !== 0 || rootState.activeDrag) return;
      const sep = e.target.closest?.('[role="separator"]:not(.sp-layout-resize)');
      if (sep && root.contains(sep)) {
        const pair = resolvePair(sep); if (!pair) return;
        e.preventDefault(); e.stopImmediatePropagation();
        rootState.activeDrag = 'resize';
        const startWidths = pair.flexCells.map(c => c.getBoundingClientRect().width || 120);
        const startX = e.clientX;
        document.documentElement.classList.add('g4a-resizing');
        const move = ev => {
          rootState.weights = adjust(startWidths, pair.k, ev.clientX - startX);
          rootState.measured = null;
          schedule();
        };
        const up = () => {
          rootState.activeDrag = null;
          document.documentElement.classList.remove('g4a-resizing');
          window.removeEventListener('mousemove', move, true);
          window.removeEventListener('mouseup', up, true);
        };
        window.addEventListener('mousemove', move, true);
        window.addEventListener('mouseup', up, true);
        return;
      }
      const headerCell = e.target.closest?.('genre4all-column[data-kind="header"],[role="columnheader"]');
      if (!headerCell || !root.contains(headerCell)) return;
      const container = headerCell.parentElement;
      if (!container || !layouts.has(container)) return;
      const all = visualCells(container);
      const end = all.find(c => c.matches('.main-trackList-rowSectionEnd,[data-sp-layout-position="native:end"]')) || all[all.length - 1];
      const allEnd = all.indexOf(end);
      const minSlot = Math.min(2, Math.max(0, allEnd - 1));
      const initialSlot = all.indexOf(headerCell);
      if (initialSlot < minSlot || initialSlot >= allEnd) return;
      rootState.activeDrag = 'reorder';
      const startX = e.clientX;
      let dragging = false;
      const clearNativeTransforms = () => {
        for (const w of container.querySelectorAll('[data-tracklist-draggable-column],[class*="columnHeaderMotionWrapper"]')) {
          if (w.style.transform) w.style.transform = '';
        }
      };
      const move = ev => {
        if (!dragging && Math.abs(ev.clientX - startX) > 5) {
          dragging = true;
          headerCell.classList.add('g4a-header-dragging');
          document.documentElement.classList.add('g4a-reordering');
          clearNativeTransforms();
        }
        if (!dragging) return;
        clearNativeTransforms();
        const curAll = visualCells(container);
        const curEnd = curAll.find(c => c.matches('.main-trackList-rowSectionEnd,[data-sp-layout-position="native:end"]')) || curAll[curAll.length - 1];
        const curAllEnd = curAll.indexOf(curEnd);
        const curMinSlot = Math.min(2, Math.max(0, curAllEnd - 1));
        const fromSlot = curAll.indexOf(headerCell);
        if (fromSlot < curMinSlot || fromSlot >= curAllEnd) return;
        let bestSlot = fromSlot, bestDist = Infinity;
        for (let s = curMinSlot; s < curAllEnd; s++) {
          const rect = curAll[s].getBoundingClientRect();
          const dist = Math.abs(ev.clientX - (rect.left + rect.right) / 2);
          if (dist < bestDist) { bestDist = dist; bestSlot = s; }
        }
        if (bestSlot !== fromSlot) {
          const midCells = curAll.slice(curMinSlot, curAllEnd);
          const keys = midCells.map((c, idx) => c.dataset.g4aColKey || colKeyForHeader(c, idx));
          const fromIdx = fromSlot - curMinSlot;
          const toIdx = bestSlot - curMinSlot;
          const [movedKey] = keys.splice(fromIdx, 1);
          keys.splice(toIdx, 0, movedKey);
          if (Array.isArray(rootState.weights) && rootState.weights.length === curAllEnd - (curAllEnd > 2 ? 1 : 0)) {
            const weightOffset = curMinSlot - (curAllEnd > 2 ? 1 : 0);
            const nextWeights = [...rootState.weights];
            const [movedW] = nextWeights.splice(weightOffset + fromIdx, 1);
            nextWeights.splice(weightOffset + toIdx, 0, movedW);
            rootState.weights = nextWeights;
          }
          const preserved = columnOrder.filter(k => !keys.includes(k));
          columnOrder = [...keys, ...preserved];
          try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(columnOrder)); } catch { /* Keep session usable. */ }
          const genreIdx = keys.indexOf('__genre__');
          if (genreIdx >= 0) {
            orderOffset = Math.max(0, (keys.length - 1) - genreIdx);
            try { localStorage.setItem(ORDER_KEY, String(orderOffset)); } catch { /* Keep session usable. */ }
          }
          invalidateLayouts(false);
          sync();
        }
      };
      const up = () => {
        rootState.activeDrag = null;
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
        if (dragging) {
          headerCell.classList.remove('g4a-header-dragging');
          document.documentElement.classList.remove('g4a-reordering');
          clearNativeTransforms();
          const suppressClick = clickEv => { clickEv.preventDefault(); clickEv.stopImmediatePropagation(); };
          headerCell.addEventListener('click', suppressClick, true);
          setTimeout(() => headerCell.removeEventListener('click', suppressClick, true), 0);
        }
      };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    };
    root.addEventListener('mousedown', startHeaderInteraction, { capture: true, signal: rootState.events.signal });
    root.addEventListener('keydown', e => {
      if (!visible || root.hasAttribute('data-sp-native-layout') || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
      const sep = e.target.closest?.('[role="separator"]:not(.sp-layout-resize)');
      if (!sep || !root.contains(sep)) return;
      const pair = resolvePair(sep); if (!pair) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const startWidths = pair.flexCells.map(c => c.getBoundingClientRect().width || 120);
      rootState.weights = adjust(startWidths, pair.k, e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 10 : -10);
      rootState.measured = null;
      schedule();
    }, { capture: true, signal: rootState.events.signal });
  }
  function releaseRow(row) {
    const state = layouts.get(row); if (!state) return;
    view?.release(state.host); state.shell.remove(); state.prevSep?.remove();
    state.prevHost?.removeAttribute('data-g4a-prev-sep');
    layouts.delete(row);
    row.classList.remove('g4a-row'); row.removeAttribute('data-g4a-measure');
    row.style.removeProperty('--g4a-tracks'); row.style.removeProperty('--g4a-total');
    for (const c of state.positions) {
      c.removeAttribute('data-g4a-position');
      c.removeAttribute('data-g4a-col-key');
      c.style.removeProperty('--g4a-position');
    }
  }
  function measureGrid(container, foreign, endIndex, minInsert, midOrder, isNativeLayout, rootState) {
    container.setAttribute('data-g4a-measure', '');
    const computed = getComputedStyle(container);
    const gap = parseFloat(computed.columnGap) || 0;
    const padding = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
    const raw = computed.gridTemplateColumns.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/).map(parseFloat);
    const baseWidths = raw.length === foreign.length && raw.every(Number.isFinite) ? raw : foreign.map(c => c.getBoundingClientRect().width || 120);
    container.removeAttribute('data-g4a-measure');
    const width = 176;
    let widths;
    if (!isNativeLayout) {
      const flexStart = endIndex > 1 ? 1 : 0;
      const flexCount = Math.max(1, endIndex - flexStart);
      const nativeFlexWidths = baseWidths.slice(flexStart, flexStart + flexCount);
      const flexSum = nativeFlexWidths.reduce((a, b) => a + b, 0);
      const avail = Math.max(0, flexSum - gap);
      const baseGenre = Math.min(176, Math.max(110, flexSum / (flexCount + 1)));
      const orderedMidWidths = midOrder.map(item => item.type === 'genre' ? baseGenre : (baseWidths[item.index] ?? 120));
      const leadingFlex = minInsert > flexStart ? baseWidths.slice(flexStart, minInsert) : [];
      const defaultWeights = [...leadingFlex, ...orderedMidWidths];
      const weights = rootState?.weights?.length === defaultWeights.length ? rootState.weights : defaultWeights;
      const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
      const mins = weights.map((_, k) => k === 0 ? 120 : 80);
      const minSum = mins.reduce((a, b) => a + b, 0);
      let alloc = weights.map((w, k) => Math.max(mins[k], avail * (w / weightSum)));
      const allocSum = alloc.reduce((a, b) => a + b, 0);
      if (avail > minSum && allocSum > avail) {
        const extra = alloc.reduce((s, v, k) => s + Math.max(0, v - mins[k]), 0);
        if (extra > 0) alloc = alloc.map((v, k) => v > mins[k] ? mins[k] + (v - mins[k]) * ((extra - (allocSum - avail)) / extra) : v);
      }
      widths = [
        ...baseWidths.slice(0, flexStart),
        ...alloc,
        ...baseWidths.slice(endIndex)
      ];
    } else {
      widths = [...baseWidths];
      widths.splice(endIndex, 0, width);
    }
    const total = Math.ceil(widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1) + padding);
    const template = widths.map(w => `${Math.max(0, w)}px`).join(' ');
    return { total, template };
  }
  function layout(row, header, root, rootState) {
    const container = rowContainer(row); if (!container) return;
    let state = layouts.get(container);
    if (!state) {
      if (getComputedStyle(container).display !== 'grid') return;
      const shell = node('genre4all-column', null, { 'data-kind': header ? 'header' : 'data' });
      const label = header ? node('span', 'Gênero', { class: 'g4a-header-label standalone-ellipsis-one-line', 'data-encore-id': 'text' }) : null;
      const sep = header ? node('div', null, { role: 'separator', 'aria-orientation': 'horizontal', 'aria-hidden': 'true', 'data-skip-in-keyboard-nav': 'true', class: 'g4a-header-sep' }) : null;
      const host = header ? null : node('div', null, { class: 'g4a-data' });
      if (header) shell.append(label, sep); else shell.append(host);
      state = { shell, label, sep, host, prevSep: null, prevHost: null, positions: new Set(), root, appliedKey: null };
      layouts.set(container, state);
    }
    const isNativeLayout = root.hasAttribute('data-sp-native-layout');
    const foreign = cells(container, header || isNativeLayout || !rootState.measured);
    if (!foreign.length) return;
    const end = foreign.find(c => c.matches('.main-trackList-rowSectionEnd,[data-sp-layout-position="native:end"]')) || foreign[foreign.length - 1];
    const endIndex = foreign.indexOf(end);
    const minInsert = Math.min(2, endIndex);
    let midOrder;
    if (isNativeLayout) {
      midOrder = [];
      for (let i = minInsert; i < endIndex; i++) midOrder.push({ type: 'native', index: i, key: `col-${i}` });
      midOrder.push({ type: 'genre', index: -1, key: '__genre__' });
    } else if (header || !rootState.midOrder || rootState.midOrderCount !== endIndex - minInsert) {
      midOrder = buildMidOrder(header ? foreign : rootState.headerForeign, minInsert, endIndex);
      if (header) {
        rootState.headerForeign = foreign;
        rootState.midOrder = midOrder;
        rootState.midOrderCount = endIndex - minInsert;
      }
    } else {
      midOrder = rootState.midOrder;
    }
    const orderSignature = midOrder.map(item => `${item.type}:${item.index}:${item.key}`).join('|');
    const rootWidth = root.clientWidth || 0;
    const inlineGrid = container.style.gridTemplateColumns || '';
    const spTracks = root.style.getPropertyValue('--sp-layout-tracks') || container.style.getPropertyValue('--sp-layout-tracks') || '';
    const weightsKey = rootState.weights ? rootState.weights.map(w => Math.round(w)).join(',') : '';
    const measureKey = `${isNativeLayout}|${rootWidth}|${foreign.length}|${endIndex}|${inlineGrid}|${spTracks}|${weightsKey}|${orderSignature}`;

    if (!header && state.appliedKey === measureKey && state.shell.parentElement === container && rootState.measured?.key === measureKey) {
      rootState.maxTotal = Math.max(rootState.maxTotal || 0, rootState.measured.total);
      return;
    }

    const midCells = midOrder.map(item => item.type === 'genre' ? state.shell : foreign[item.index]).filter(Boolean);
    const all = [...foreign.slice(0, minInsert), ...midCells, ...foreign.slice(endIndex)];
    const genreVisualIdx = all.indexOf(state.shell);
    const insertDomRef = foreign[Math.min(endIndex, Math.max(minInsert, genreVisualIdx))] || end;
    if (state.shell.parentElement !== container || state.shell.nextElementSibling !== insertDomRef) {
      container.insertBefore(state.shell, insertDomRef);
    }

    if (header) {
      midOrder.forEach(item => {
        const targetCell = item.type === 'genre' ? state.shell : foreign[item.index];
        if (targetCell && targetCell.dataset.g4aColKey !== item.key) targetCell.dataset.g4aColKey = item.key;
      });
      const sampleText = container.querySelector('[role="columnheader"] [data-encore-id="text"]');
      if (sampleText && state.label) {
        const cls = `${sampleText.className} g4a-header-label standalone-ellipsis-one-line`.trim();
        if (state.label.className !== cls) state.label.className = cls;
      }
      const sampleSep = container.querySelector('[role="columnheader"] [role="separator"]:not(.sp-layout-resize):not([data-g4a-sep])');
      const sepClass = `${sampleSep?.className || ''} g4a-header-sep`.trim();
      if (state.sep && state.sep.className !== sepClass) state.sep.className = sepClass;
      const prev = endIndex >= 2 && !isNativeLayout ? foreign[endIndex - 1] : null;
      const prevHost = prev ? (prev.querySelector('[data-tracklist-draggable-column]') || prev) : null;
      if (state.prevHost && state.prevHost !== prevHost) {
        state.prevSep?.remove(); state.prevSep = null;
        state.prevHost.removeAttribute('data-g4a-prev-sep'); state.prevHost = null;
      }
      if (prevHost && !prev.querySelector('[role="separator"]:not(.sp-layout-resize):not([data-g4a-sep])')) {
        if (!state.prevSep) state.prevSep = node('div', null, { role: 'separator', 'aria-orientation': 'horizontal', 'aria-hidden': 'true', 'data-skip-in-keyboard-nav': 'true', 'data-g4a-sep': '', class: sepClass });
        if (state.prevSep.className !== sepClass) state.prevSep.className = sepClass;
        if (state.prevSep.parentElement !== prevHost) prevHost.append(state.prevSep);
        if (!prevHost.hasAttribute('data-g4a-prev-sep')) prevHost.setAttribute('data-g4a-prev-sep', '');
        state.prevHost = prevHost;
      } else if (state.prevSep) {
        state.prevSep.remove(); state.prevSep = null;
        state.prevHost?.removeAttribute('data-g4a-prev-sep'); state.prevHost = null;
      }
    }

    let measured = rootState.measured?.key === measureKey ? rootState.measured : null;
    if (!measured) {
      const m = measureGrid(container, foreign, endIndex, minInsert, midOrder, isNativeLayout, rootState);
      measured = { key: measureKey, total: m.total, template: m.template };
      if (!inlineGrid) rootState.measured = measured;
    }

    ownProperty(container, '--g4a-tracks', measured.template);
    ownProperty(container, '--g4a-total', `${measured.total}px`);
    rootState.maxTotal = Math.max(rootState.maxTotal || 0, measured.total);
    for (const c of state.positions) if (!all.includes(c)) {
      c.removeAttribute('data-g4a-position');
      c.style.removeProperty('--g4a-position');
      state.positions.delete(c);
    }
    all.forEach((c, i) => {
      if (!c.hasAttribute('data-g4a-position')) c.setAttribute('data-g4a-position', '');
      ownProperty(c, '--g4a-position', String(i + 1));
      state.positions.add(c);
    });
    const colIdx = String(genreVisualIdx + 1);
    if (state.shell.getAttribute('aria-colindex') !== colIdx) state.shell.setAttribute('aria-colindex', colIdx);
    container.classList.add('g4a-row');
    state.appliedKey = measureKey;
  }

  function columnMenu(menu) {
    if (!menu.isConnected || menu.closest('.g4a-preferences,.g4a-genre-dialog')) return false;
    const text = normalize(menu.textContent || '');
    const items = [...menu.querySelectorAll('[role="menuitemcheckbox"],[role="checkbox"],input[type="checkbox"],button[aria-checked]')].filter(n => !n.closest('[data-g4a-menu-item]'));
    const labels = [...menu.querySelectorAll('button,[role="menuitem"]')].filter(n => !n.closest('[data-g4a-menu-item]')).map(n => normalize(n.textContent || '').trim());
    const known = labels.filter(label => /^(forma de onda|waveform|album|adicionada em|date added|added date|data de lancamento|release date|duracao|duration|bpm|tom|key)$/.test(label));
    // textContent joins adjacent menu labels without whitespace in Spotify.
    return (items.length >= 2 && (/(colunas|columns)/.test(text) || /(album|duration|duracao|added|adicionada|release date|data de lancamento)/.test(text)))
      || (known.length >= 2 && /(colunas|columns)/.test(text))
      || (known.length >= 3 && labels.some(label => /^(duration|duracao|waveform|forma de onda)$/.test(label)));
  }
  function profileMenu(menu) {
    if (!menu.isConnected || menu.closest('.g4a-preferences,.g4a-genre-dialog') || columnMenu(menu)) return false;
    const labels = [...menu.querySelectorAll('button,a,[role="menuitem"],[role="menuitemcheckbox"]')].filter(n => !n.closest('[data-g4a-profile-item]')).map(n => normalize(n.textContent || '').trim());
    if (labels.some(l => l.includes('genre4all config'))) return false;
    const known = labels.filter(l => /^(conta|account|perfil|profile|configuracoes|settings|sair|log out|experimental features|home config|spicy lyrics settings|private session|sessao particular|suporte|support)$/.test(l));
    return known.length >= 2;
  }
  function updateMenus() {
    for (const item of document.querySelectorAll('[data-g4a-menu-item]')) {
      const button = item.querySelector('button'); if (!button) continue;
      button.setAttribute('aria-checked', String(visible));
      item.querySelector('svg').style.visibility = visible ? 'visible' : 'hidden';
    }
  }
  function injectMenus() {
    for (const menu of document.querySelectorAll('[role="menu"],.main-contextMenu-menu')) {
      if (columnMenu(menu) && !menu.querySelector('[data-g4a-menu-item]')) {
        const item = node(menu.tagName === 'UL' || menu.tagName === 'OL' ? 'li' : 'div', null, { 'data-g4a-menu-item': '', role: 'presentation' });
        const sample = menu.querySelector('button[role="menuitemcheckbox"],button[aria-checked],button');
        const button = node('button', null, { type: 'button', class: `${sample?.className || ''} g4a-menu-button`, role: 'menuitemcheckbox', 'aria-checked': String(visible), tabindex: '0', title: 'Genre4all — mostrar ou ocultar a coluna de gênero' });
        button.append(node('span', 'Gênero'));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0z'); svg.append(path); button.append(svg);
        button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setVisible(!visible); });
        button.addEventListener('keydown', e => {
          if (!['ArrowUp','ArrowDown','Home','End'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const options = [...menu.querySelectorAll('button,[role="menuitem"],[role="menuitemcheckbox"]')].filter(n => !n.disabled && n.getBoundingClientRect().height > 0);
          const index = options.indexOf(button);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
          options[next]?.focus();
        });
        item.append(button); menu.append(item);
      } else if (profileMenu(menu) && !menu.querySelector('[data-g4a-profile-item]')) {
        const item = node(menu.tagName === 'UL' || menu.tagName === 'OL' ? 'li' : 'div', null, { 'data-g4a-profile-item': '', role: 'presentation' });
        const sample = menu.querySelector('button[role="menuitem"],button');
        const button = node('button', null, { type: 'button', class: `${sample?.className || ''} g4a-profile-button`, role: 'menuitem', tabindex: '-1' });
        const iconHolder = node('span'); iconHolder.innerHTML = CONFIG_ICON;
        if (iconHolder.firstElementChild) button.append(iconHolder.firstElementChild);
        button.append(node('span', 'Genre4all config'));
        button.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          menu.remove();
          showPreferences();
        });
        item.append(button);
        const anchor = [...menu.children].find(c => /spicy lyrics|home config|experimental/i.test(c.textContent || ''));
        if (anchor?.nextSibling) menu.insertBefore(item, anchor.nextSibling);
        else if (menu.firstElementChild) menu.insertBefore(item, menu.firstElementChild);
        else menu.append(item);
      }
    }
    updateMenus();
  }

  // Observe native changes and virtualization; ignore our rendering, menu writes and unrelated player animations.
  const observer = new MutationObserver(records => {
    if (document.documentElement.classList.contains('g4a-reordering')) return;
    if (records.some(m => {
      const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!target || target.closest?.('genre4all-column,[data-g4a-menu-item],[data-g4a-profile-item],[data-g4a-sep],.g4a-genre-fan,.g4a-preferences')) return false;
      if (m.type === 'childList') {
        return [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1 && !n.matches('genre4all-column,[data-g4a-menu-item],[data-g4a-profile-item],[data-g4a-sep],.g4a-genre-fan'));
      }
      return !!target.closest?.(`${ROOT},[role="menu"],.main-contextMenu-menu`);
    })) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-rowindex','data-uri','href','style','class'], characterData: true });
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { invalidateLayouts(false); schedule(); }) : null;

  function sync() {
    frame = null; if (closed) return;
    try {
      injectMenus();
      const found = new Set();
      for (const root of document.querySelectorAll(ROOT)) {
        if (!root.querySelector('.main-trackList-trackListRow,[role="row"] [role="gridcell"]')) continue;
        // The closest grid owns the rows; nested containers must not produce duplicate cells.
        const rows = [...root.querySelectorAll(ROW)].filter(row => row.closest(ROOT) === root);
        if (!rows.length) continue;
        found.add(root);
        let rootState = roots.get(root);
        if (!rootState) {
          rootState = { events: new AbortController(), weights: null, measured: null, midOrder: null, midOrderCount: -1, headerForeign: null, maxTotal: 0, activeDrag: null };
          roots.set(root, rootState);
          attachResize(root, rootState);
          resize?.observe(root);
        }
        rootState.maxTotal = 0;
        root.classList.toggle('g4a-root', visible);
        if (visible) {
          const headerRows = [], dataRows = [];
          for (const row of rows) {
            if (row.querySelector('[role="columnheader"]')) headerRows.push(row);
            else if (getUri(row)) dataRows.push(row);
          }
          for (const row of headerRows) layout(row, true, root, rootState);
          for (const row of dataRows) layout(row, false, root, rootState);
          if (rootState.maxTotal > (root.clientWidth || rootState.maxTotal) + 2) {
            if (!root.hasAttribute('data-g4a-overflow')) root.setAttribute('data-g4a-overflow', '');
          } else if (root.hasAttribute('data-g4a-overflow')) {
            root.removeAttribute('data-g4a-overflow');
          }
          view?.sync(root, [{ type: 'genre', dataSelector: '.g4a-data' }]);
        } else if (root.hasAttribute('data-g4a-overflow')) {
          root.removeAttribute('data-g4a-overflow');
        }
      }
      for (const [row, state] of layouts) if (!row.isConnected || !found.has(state.root) || !row.contains(state.shell)) releaseRow(row);
      for (const [root, rootState] of roots) if (!found.has(root)) {
        rootState.events.abort(); roots.delete(root);
        root.classList.remove('g4a-root'); root.removeAttribute('data-g4a-overflow');
        resize?.unobserve(root);
      }
      view?.prune();
    } catch (error) { console.error('[Genre4all] Falha ao atualizar coluna.', error); }
    // Only synchronous writes from this pass are discarded. Async results remain observable.
    observer.takeRecords();
  }
  function close() {
    if (closed) return;
    closed = true; lifecycle.abort(); observer.disconnect(); resize?.disconnect(); unlisten?.();
    try { profileMenuItem?.deregister?.(); } catch { /* Ignore menu cleanup errors. */ }
    if (frame !== null) cancelAnimationFrame(frame);
    for (const row of [...layouts.keys()]) releaseRow(row);
    for (const [root, rootState] of roots) {
      rootState.events.abort();
      root.classList.remove('g4a-root'); root.removeAttribute('data-g4a-overflow');
    }
    roots.clear();
    view?.close(); service?.close(); storage.close(); preferences?.remove();
    document.querySelectorAll('[data-g4a-menu-item],[data-g4a-profile-item]').forEach(n => n.remove()); style.remove();
    if (globalThis.Genre4all === api) delete globalThis.Genre4all;
  }
  window.addEventListener('pagehide', close, { once: true, signal: lifecycle.signal });
  window.addEventListener('resize', () => { invalidateLayouts(false); schedule(); }, { signal: lifecycle.signal });
  // React may replace metadata on a recycled DOM node without any attribute mutation.
  const recheck = setInterval(() => { if (!document.hidden) schedule(); }, 1500);
  lifecycle.signal.addEventListener('abort', () => clearInterval(recheck), { once: true });
  while (!closed && !globalThis.Spicetify?.Platform) await new Promise(resolve => setTimeout(resolve, 250));
  if (closed) return;
  try {
    if (globalThis.Spicetify?.Menu?.Item) {
      profileMenuItem = new Spicetify.Menu.Item('Genre4all config', false, () => showPreferences(), CONFIG_ICON);
      profileMenuItem.register();
    }
  } catch { /* Fallback DOM injection handles profile menu. */ }
  service = Genre4allGenres.createService({
    storage,
    discogs: Genre4allTransport.createDiscogsAdapter(Genre4allGenres, () => service?.getConfig()),
    musicbrainz: Genre4allTransport.createMusicBrainzAdapter(Genre4allGenres, () => service?.getConfig()),
    spotify: Genre4allTransport.createSpotifyAdapter(Genre4allGenres, getMetadataClient),
    validateSpotifyGenre: Genre4allCatalog.validate,
    formatSpotifyGenres: Genre4allCatalog.format
  });
  view = Genre4allColumn.createController(service, {
    getUri, getTrack: track, getContext: context, isEnabled: cell => visible && cell.matches('.g4a-data'),
    onConfigure: showPreferences,
    describe: result => ({
      DISCOGS_TOKEN_REQUIRED: 'Configure sua chave de API do Discogs em Genre4all config.',
      DISCOGS_AUTH_FAILED: 'Chave de API do Discogs inválida ou sem permissão.',
      SPOTIFY_METADATA_UNAVAILABLE: 'O serviço de metadados está indisponível nesta versão do Spotify. Atualize Spicetify/Spotify e tente novamente.',
      SPOTIFY_TIMEOUT: 'O Spotify não respondeu a tempo. Use Atualizar gêneros.',
      SPOTIFY_TRACK_REQUIRED: 'Gêneros disponíveis para faixas do catálogo do Spotify.',
      SPOTIFY_EXTENSION_MISSING: 'Esta versão do Spotify não disponibilizou os metadados de gênero.'
    }[result.errorCode] || result.errorCode || 'Não foi possível obter gêneros para esta faixa.')
  });
  service.ready.catch(error => console.warn('[Genre4all] Falha ao iniciar cache.', error));
  unlisten = Spicetify.Platform.History?.listen?.(() => { view.reset(); invalidateLayouts(false); schedule(); });
  schedule();
}
if (typeof document !== 'undefined') startGenre4all().catch(error => console.error('[Genre4all] Falha na inicialização.', error));

})();
