/* Transport adapters (Discogs, MusicBrainz, Spotify MetadataService) and IndexedDB storage for Genre4all. */
const Genre4allTransport = (() => {
  'use strict';
  function createIndexedDBStorage(indexedDB = globalThis.indexedDB) {
    const spaces = ['settings', 'cache'];
    const ready = new Promise((resolve, reject) => {
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
      get: (s, k) => transaction(s, 'readonly', os => os.get(k)),
      set: (s, k, v) => transaction(s, 'readwrite', os => os.put(v, k)),
      remove: (s, k) => transaction(s, 'readwrite', os => os.delete(k)),
      clear: s => transaction(s, 'readwrite', os => os.clear()),
      entries: s => transaction(s, 'readonly', os => { const keys = os.getAllKeys(), values = os.getAll(); return () => keys.result.map((k, i) => [k, values.result[i]]); }),
      async close() { (await ready).close(); }
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

  async function fetchJson(api, fetchImpl, url, headers, signal, prefix) {
    if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
    if (typeof fetchImpl !== 'function') throw new api.GenreError('unsupported', `${prefix}_FETCH_UNAVAILABLE`);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
      if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
      if (res.status === 401 || res.status === 403) throw new api.GenreError('not_configured', `${prefix}_AUTH_FAILED`, Date.now() + 60000);
      if (res.status === 429 || res.status === 503) {
        throw new api.GenreError('rate_limited', `${prefix}_RATE_LIMITED`, api.retryTime(res.headers?.get?.('retry-after'), Date.now()));
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new api.GenreError('error', `${prefix}_HTTP_${res.status}`, res.status >= 500 ? Date.now() + 20000 : undefined);
      const remaining = Number(res.headers?.get?.('x-discogs-ratelimit-remaining'));
      const data = await res.json();
      if (Number.isFinite(remaining) && remaining <= 0 && data && typeof data === 'object') {
        data.__rateLimitExhaustedUntil = Date.now() + 60000;
      }
      return data;
    } catch (err) {
      if (err instanceof api.GenreError) throw err;
      if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
      if (timedOut) throw new api.GenreError('error', `${prefix}_TIMEOUT`, Date.now() + 20000);
      throw new api.GenreError('error', `${prefix}_REQUEST_FAILED`, Date.now() + 20000);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
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
      const targetAlbum = normText(identity.album);
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
    const adapter = async (identity, signal) => {
      if (signal?.aborted) throw new api.GenreError('cancelled', 'CANCELLED');
      const cfg = typeof getConfig === 'function' ? getConfig() : (getConfig || {});
      const token = String(cfg?.discogsToken || '').trim();
      if (!token) throw new api.GenreError('not_configured', 'DISCOGS_TOKEN_REQUIRED');
      const title = cleanSearchTitle(identity?.title);
      const artists = Array.isArray(identity?.artists) ? identity.artists.filter(Boolean) : [];
      if (!title || !artists.length) throw new api.GenreError('unsupported', 'TRACK_METADATA_REQUIRED');

      const params1 = new URLSearchParams({ artist: artists[0], track: title, per_page: '10' });
      applyAuth(params1, token);
      const data1 = await fetchJson(api, fetchImpl, `https://api.discogs.com/database/search?${params1}`, {}, signal, 'DISCOGS');
      let best = pickBest(identity, data1?.results);
      let exhaustedUntil = data1?.__rateLimitExhaustedUntil;

      if (!best && !exhaustedUntil) {
        const q = `${artists[0]} ${identity.album || title}`.trim();
        const params2 = new URLSearchParams({ q, per_page: '10' });
        applyAuth(params2, token);
        const data2 = await fetchJson(api, fetchImpl, `https://api.discogs.com/database/search?${params2}`, {}, signal, 'DISCOGS');
        best = pickBest(identity, data2?.results);
        exhaustedUntil = data2?.__rateLimitExhaustedUntil;
      }
      if (!best) {
        if (exhaustedUntil) throw new api.GenreError('rate_limited', 'DISCOGS_RATE_LIMITED', exhaustedUntil);
        return null;
      }
      return {
        genres: Array.isArray(best.genre) ? best.genre : [],
        styles: Array.isArray(best.style) ? best.style : [],
        entityType: best.type || 'release',
        entityId: String(best.id || ''),
        sourceUrl: best.uri ? new URL(best.uri, 'https://www.discogs.com').href : 'https://www.discogs.com',
        ...(exhaustedUntil ? { rateLimitExhaustedUntil: exhaustedUntil } : {})
      };
    };
    adapter.isConfigured = () => {
      const cfg = typeof getConfig === 'function' ? getConfig() : (getConfig || {});
      return Boolean(String(cfg?.discogsToken || '').trim());
    };
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
    return async (identity, signal) => {
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
      const data = await fetchJson(api, fetchImpl, searchUrl, headers, signal, 'MUSICBRAINZ');
      const matched = matchCandidate(identity, data?.recordings);
      if (!matched) return null;

      let { genres, tags } = collectBuckets(matched);
      if (!genres.length && !tags.length && matched.id) {
        const detailUrl = `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(matched.id)}?inc=genres+tags+artists+release-groups&fmt=json`;
        const detail = await fetchJson(api, fetchImpl, detailUrl, headers, signal, 'MUSICBRAINZ');
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

  return { createIndexedDBStorage, createSpotifyAdapter, createDiscogsAdapter, createMusicBrainzAdapter };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Genre4allTransport;
