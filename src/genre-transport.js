/* Transport adapters (Discogs, MusicBrainz, Spotify MetadataService) and compact persistent cache for Genre4all. */
const Genre4allTransport = (() => {
  'use strict';
  const COMPACT_CACHE_KEY = 'genre4all-cache-txt-v11';
  const COMPACT_MAX_LINES = 2000;

  function encodeCompactEntry(id, entry) {
    if (!entry || !entry.value || !Number.isFinite(entry.expiresAt)) return '';
    const v = entry.value;
    if (!['success', 'empty', 'no_match'].includes(v.status)) return '';
    if (entry.__compactLine && entry.__compactId === id && entry.__compactExp === entry.expiresAt) return entry.__compactLine;
    const labelsPart = (v.labels || [])
      .map(l => `${String(l.label || '').replace(/[\t\n\r;~]/gu, ' ')}~${l.kind || 'genre'}~${l.provider || v.provider || ''}`)
      .join(';');
    const safeId = String(id).replace(/[\t\n\r]/gu, ' ');
    const provider = String(v.provider || '').replace(/[\t\n\r]/gu, '');
    const status = String(v.status || 'empty');
    const exp = Math.floor(entry.expiresAt).toString(36);
    const ver = Number(entry.version || 2).toString(36);
    const line = `${safeId}\t${provider}\t${status}\t${exp}\t${ver}\t${labelsPart}`;
    try {
      Object.defineProperties(entry, {
        __compactLine: { value: line, configurable: true },
        __compactId: { value: id, configurable: true },
        __compactExp: { value: entry.expiresAt, configurable: true }
      });
    } catch { /* Frozen entry fallback. */ }
    return line;
  }

  function encodeCompactCache(map) {
    const lines = [];
    for (const [id, entry] of map) {
      const line = encodeCompactEntry(id, entry);
      if (line) lines.push(line);
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
    function scoreCandidates(identity, results) {
      if (!Array.isArray(results) || !results.length) return [];
      const targetTitle = normText(identity.title);
      const targetClean = normText(cleanSearchTitle(identity.title));
      const targetAlbum = normText(cleanSearchTitle(identity.album));
      const targetArtists = (identity.artists || []).map(a => normText(String(a).replace(/\s*\(\d+\)$/u, ''))).filter(Boolean);
      const scored = [];
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
        scored.push({ item, score, genres, styles });
      }
      return scored.map((c, i) => ({ ...c, i })).sort((a, b) => (b.score - a.score) || (a.i - b.i));
    }
    function rankByVotes(candidates, field, bestList) {
      const votes = new Map();
      for (const c of candidates) {
        c[field].forEach((name, idx) => {
          const k = normText(name);
          if (!k) return;
          const weight = c.score / (1 + idx * 0.35);
          const prev = votes.get(k);
          if (prev) prev.votes += weight;
          else votes.set(k, { name, votes: weight });
        });
      }
      const bestOrder = new Map(bestList.map((n, i) => [normText(n), i]));
      return [...votes.entries()]
        .sort((a, b) => (b[1].votes - a[1].votes) || ((bestOrder.get(a[0]) ?? 99) - (bestOrder.get(b[0]) ?? 99)))
        .slice(0, 8)
        .map(([, v]) => v.name);
    }
    function pickBest(identity, results) {
      const ranked = scoreCandidates(identity, results);
      if (!ranked.length) return null;
      const top = ranked[0];
      const strong = ranked.filter(c => c.score >= top.score - 15).slice(0, 6);
      return {
        item: top.item,
        genres: rankByVotes(strong, 'genres', top.genres),
        styles: rankByVotes(strong, 'styles', top.styles)
      };
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
        genres: best.genres,
        styles: best.styles,
        entityType: best.item.type || 'release',
        entityId: String(best.item.id || ''),
        sourceUrl: best.item.uri ? new URL(best.item.uri, 'https://www.discogs.com').href : 'https://www.discogs.com'
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
if (typeof module !== 'undefined' && module.exports) module.exports = Genre4allTransport;
