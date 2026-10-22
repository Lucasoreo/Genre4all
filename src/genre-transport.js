/* Spotify MetadataService transport and IndexedDB storage for the Genre Selector. */
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
  return { createIndexedDBStorage, createSpotifyAdapter };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Genre4allTransport;
