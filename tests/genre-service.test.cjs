'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src/genre-service.js');
const { createSpotifyAdapter } = require('../src/genre-transport.js');
const TRACK = { uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa', name: 'Real Thing', artists: [{ name: 'Artist A' }], album: { name: 'Release A' }, duration_ms: 240000, external_ids: { isrc: 'TEST12345678' } };

function storage() {
  const map = new Map();
  return {
    map,
    async get(s, k) { return structuredClone(map.get(s + ':' + k)); },
    async set(s, k, v) { map.set(s + ':' + k, structuredClone(v)); },
    async remove(s, k) { map.delete(s + ':' + k); },
    async clear(s) { for (const k of map.keys()) if (k.startsWith(s + ':')) map.delete(k); },
    async entries(s) { return [...map].filter(([k]) => k.startsWith(s + ':')).map(([k, v]) => [k.slice(s.length + 1), structuredClone(v)]); }
  };
}

function encodedConcept(name, score) {
  const b = Buffer.from(name);
  if (score === undefined) return new Uint8Array([10, b.length + 2, 10, b.length, ...b]);
  const f = Buffer.alloc(4);
  f.writeFloatLE(score, 0);
  return new Uint8Array([10, b.length + 7, 10, b.length, ...b, 21, ...f]);
}

test('PROVIDERS contains only spotify as the priority source', () => {
  assert.deepEqual(api.PROVIDERS, ['spotify']);
  assert.deepEqual(api.defaultConfig().order, ['spotify']);
  assert.deepEqual(api.defaultConfig().enabled, { spotify: true });
});

test('Spotify resolution returns all valid labels and supports both broad genres and styles', async () => {
  const service = api.createService({
    storage: storage(),
    spotify: async () => [
      { name: 'progressive house', rawValue: 'spotify:concept:progressive_house', score: 0.85 },
      { name: 'tech house', rawValue: 'spotify:concept:tech_house', score: 0.42 },
      { name: 'low score tag', rawValue: 'spotify:concept:low_score_tag', score: 0.02 }
    ],
    validateSpotifyGenre: name => ['progressive house', 'tech house', 'low score tag'].includes(name),
    formatSpotifyGenres: valid => [
      ...valid.map(c => ({ name: c.name, kind: 'style', rawValue: c.rawValue })),
      { name: 'Electronic', kind: 'genre', rawValue: 'spotify:concept:progressive_house' },
      { name: 'House', kind: 'genre', rawValue: 'spotify:concept:progressive_house' }
    ]
  });
  const result = await service.resolve(TRACK);
  assert.equal(result.status, 'success');
  assert.equal(result.selectedProvider, 'spotify');
  assert.deepEqual(result.labels.map(l => l.label), ['progressive house', 'tech house', 'Electronic', 'House']);

  await service.configure({ showStyles: false });
  const genresOnly = await service.resolve(TRACK);
  assert.deepEqual(genresOnly.labels.map(l => l.label), ['Electronic', 'House']);

  await service.configure({ showStyles: true, showGenres: false });
  const stylesOnly = await service.resolve(TRACK);
  assert.deepEqual(stylesOnly.labels.map(l => l.label), ['progressive house', 'tech house']);
  service.close();
});

test('Spotify resolution works with only track URI (even when DOM title or artists are absent on Album/Artist pages)', async () => {
  const service = api.createService({
    storage: storage(),
    spotify: async uri => [{ name: 'Indie Pop', score: 0.9 }],
    validateSpotifyGenre: () => true
  });
  const r = await service.resolve({ uri: TRACK.uri });
  assert.equal(r.status, 'success');
  assert.equal(r.selectedProvider, 'spotify');
  assert.deepEqual(r.labels.map(l => l.label), ['Indie Pop']);
  service.close();
});

test('disabling Spotify source performs no queries and returns SOURCES_DISABLED', async () => {
  let calls = 0;
  const service = api.createService({
    storage: storage(),
    spotify: async () => { calls++; return [{ name: 'House' }]; },
    validateSpotifyGenre: () => true
  });
  await service.configure({ enabled: { spotify: false } });
  const r = await service.resolve(TRACK);
  assert.equal(r.status, 'empty');
  assert.equal(r.reason, 'SOURCES_DISABLED');
  assert.equal(calls, 0);
  await service.resetConfig();
  assert.deepEqual(service.getConfig().order, ['spotify']);
  assert.equal(service.getConfig().enabled.spotify, true);
  service.close();
});

test('conservative duplicate normalization; Electro and Electro House are different', () => {
  assert.deepEqual(api.labelsFrom([' Electronic ', 'electronic', 'Electro', 'Electro House', ' Electro   House ']).map(l => l.label), ['Electronic', 'Electro', 'Electro House']);
});

test('decodeConcepts parses Spotify concepts with scores, sorts by relevance, and handles empty/null buffers', () => {
  const combined = new Uint8Array([
    ...encodedConcept('spotify:concept:house', 0.45),
    ...encodedConcept('spotify:concept:progressive_house', 0.91)
  ]);
  const values = api.decodeConcepts(combined);
  assert.equal(values.length, 2);
  assert.equal(values[0].name, 'progressive house');
  assert.equal(values[0].rawValue, 'spotify:concept:progressive_house');
  assert.equal(values[1].name, 'house');
  assert.deepEqual(api.decodeConcepts(new Uint8Array()), []);
  assert.deepEqual(api.decodeConcepts(null), []);
  for (const buffer of [new Uint8Array([10, 99, 10]), new Uint8Array([0]), new Uint8Array([10, 2, 10, 9])]) {
    assert.throws(() => api.decodeConcepts(buffer), /SPOTIFY_BUFFER_INVALID/);
  }
});

test('createSpotifyAdapter accepts status.code 200 and empty extensionData, and rejects mismatched entityUri', async () => {
  const wrong = createSpotifyAdapter(api, () => ({
    fetch: async () => ({ extension: [{ extensionKind: 6, entityExtension: [{ entityUri: 'another', extensionData: { value: encodedConcept('house') } }] }] })
  }));
  await assert.rejects(wrong(TRACK.uri), /SPOTIFY_EXTENSION_MISSING/);

  const okWithStatus200 = createSpotifyAdapter(api, () => ({
    fetch: async q => {
      assert.equal(q.extensionQuery[0].extensionKind, 6);
      return {
        extension: [{
          extensionKind: 6,
          entityExtension: [{
            entityUri: TRACK.uri,
            status: { code: 200 },
            extensionData: { value: encodedConcept('spotify:concept:tech_house', 0.8) }
          }]
        }]
      };
    }
  }));
  const service = api.createService({ spotify: okWithStatus200, validateSpotifyGenre: name => name === 'tech house' });
  const r = await service.resolve(TRACK);
  assert.equal(r.status, 'success');
  assert.equal(r.selectedProvider, 'spotify');
  assert.deepEqual(r.labels.map(l => l.label), ['tech house']);
  service.close();

  const emptyTrack = createSpotifyAdapter(api, () => ({
    fetch: async () => ({
      extension: [{
        extensionKind: 6,
        entityExtension: [{ entityUri: TRACK.uri, status: { code: 200 } }]
      }]
    })
  }));
  const emptyService = api.createService({ spotify: emptyTrack, validateSpotifyGenre: () => true });
  const emptyRes = await emptyService.resolve(TRACK);
  assert.equal(emptyRes.status, 'empty');
  emptyService.close();
});

test('two simultaneous resolutions and repeated tracks deduplicate requests', async () => {
  let calls = 0;
  const service = api.createService({
    storage: storage(),
    spotify: async () => { calls++; return [{ name: 'Electronic' }]; },
    validateSpotifyGenre: () => true
  });
  const [one, two] = await Promise.all([service.resolve(TRACK), service.resolve(TRACK)]);
  assert.equal(one.status, 'success');
  assert.deepEqual(one, two);
  assert.equal(calls, 1);
  await service.resolve(TRACK);
  await service.configure({ colors: false });
  await service.resolve(TRACK);
  assert.equal(calls, 1);
  service.close();
});

test('cancelling one subscriber preserves another; final subscriber cancels work', async () => {
  let finish, aborted = false;
  const service = api.createService({
    providers: {
      spotify: (_, s) => new Promise(resolve => {
        finish = resolve;
        s.addEventListener('abort', () => { aborted = true; });
      })
    }
  });
  const a = new AbortController(), b = new AbortController();
  const one = service.resolve(TRACK, { signal: a.signal }), two = service.resolve(TRACK, { signal: b.signal });
  await new Promise(resolve => setImmediate(resolve));
  a.abort();
  assert.equal((await one).status, 'cancelled');
  assert.equal(aborted, false);
  finish({ provider: 'spotify', status: 'success', labels: api.labelsFrom(['Electronic']), expiresAt: 100000 });
  assert.equal((await two).status, 'success');
  service.close();
});

test('bounded FIFO limiters apply to all requests, honor Retry-After and drain cancelled waiters', async () => {
  let now = 0; const starts = [];
  const gate = api.createLimiter(1100, { now: () => now, wait: async ms => { now += ms; }, maxQueue: 2 });
  await Promise.all([gate.run(() => starts.push(now)), gate.run(() => starts.push(now))]); assert.deepEqual(starts, [0, 1100]);
  gate.block(6000); await assert.rejects(gate.run(() => {}), e => e.status === 'rate_limited' && e.retryAt === 6000);
  assert.equal(api.retryTime('2', 1000), 3000); assert.equal(api.retryTime('Thu, 01 Jan 1970 00:00:04 GMT', 1000), 4000);
});

for (const operation of ['clearCache', 'refresh', 'refreshContext']) test(`${operation} blocks immediate subscriber resolutions until eviction completes`, async () => {
  let current = 'Old classification', calls = 0;
  const service = api.createService({
    storage: storage(),
    spotify: async () => { calls++; return [{ name: current }]; },
    validateSpotifyGenre: () => true
  });
  assert.deepEqual((await service.resolve(TRACK)).labels.map(l => l.label), ['Old classification']);
  current = 'Fresh classification';
  let view;
  const unsubscribe = service.onChange(() => { view = service.resolve(TRACK); });
  await service[operation](operation === 'refreshContext' ? [TRACK] : TRACK);
  assert.deepEqual((await view).labels.map(l => l.label), ['Fresh classification']);
  assert.deepEqual((await service.resolve(TRACK)).labels.map(l => l.label), ['Fresh classification']);
  assert.equal(calls, 2, 'refresh and view share one fresh lookup');
  unsubscribe(); service.close();
});

test('expired cache entries automatically notify listeners and resolve fresh data without manual refresh', async () => {
  let current = 'Initial genre', calls = 0, notified = 0;
  const service = api.createService({
    storage: storage(),
    providers: {
      spotify: async () => {
        calls++;
        return { provider: 'spotify', status: 'success', labels: api.labelsFrom([current]), expiresAt: Date.now() + 40 };
      }
    }
  });
  const unsub = service.onChange(() => { notified++; });
  const first = await service.resolve(TRACK);
  assert.deepEqual(first.labels.map(l => l.label), ['Initial genre']);
  assert.equal(calls, 1);
  current = 'Reloaded after expiry';
  await new Promise(r => setTimeout(r, 70));
  assert.ok(notified >= 1, 'expiry timer notifies subscribers so visible cells reload automatically');
  const second = await service.resolve(TRACK);
  assert.deepEqual(second.labels.map(l => l.label), ['Reloaded after expiry']);
  assert.equal(calls, 2);
  unsub(); service.close();
});

test('Spotify capability tests and regular resolutions share the provider limiter and await catalog readiness', async () => {
  let time = 1000, prepared = false; const starts = [];
  const service = api.createService({
    now: () => time,
    wait: async ms => { time += ms; },
    spotify: async () => { starts.push(time); return [{ name: 'House' }]; },
    prepareSpotifyGenres: async () => { await new Promise(r => setImmediate(r)); prepared = true; },
    validateSpotifyGenre: name => prepared && name === 'House'
  });
  const [one, two] = await Promise.all([service.testSpotify(TRACK), service.resolve(TRACK)]);
  assert.equal(one.status, 'success'); assert.equal(two.status, 'success');
  assert.equal(starts.length, 2); assert.ok(starts[1] - starts[0] >= 25);
  service.close();
});
