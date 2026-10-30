'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src/genre-service.js');
const { createSpotifyAdapter, createDiscogsAdapter, createMusicBrainzAdapter, encodeCompactCache, decodeCompactCache } = require('../src/genre-transport.js');
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

test('PROVIDERS contains discogs, musicbrainz, and spotify in priority order', () => {
  assert.deepEqual(api.PROVIDERS, ['discogs', 'musicbrainz', 'spotify']);
  assert.deepEqual(api.defaultConfig().order, ['discogs', 'musicbrainz', 'spotify']);
  assert.deepEqual(api.defaultConfig().enabled, { discogs: true, musicbrainz: true, spotify: true });
  assert.equal(api.defaultConfig().discogsToken, '');
  assert.equal(api.defaultConfig().musicbrainzToken, '');
});

test('Discogs priority short-circuits MusicBrainz and Spotify, placing main genre before subgenres', async () => {
  let mbCalls = 0, spCalls = 0;
  const service = api.createService({
    storage: storage(),
    discogsInterval: 1,
    discogs: async () => ({
      genres: ['Electronic', 'Rock'],
      styles: ['Synth-pop', 'Indie Rock'],
      entityId: '999',
      sourceUrl: 'https://www.discogs.com/master/999'
    }),
    musicbrainz: async () => { mbCalls++; return { genres: ['Pop'], tags: ['Dance'] }; },
    spotify: async () => { spCalls++; return [{ name: 'House', score: 0.9 }]; }
  });
  const result = await service.resolve(TRACK);
  assert.equal(result.status, 'success');
  assert.equal(result.selectedProvider, 'discogs');
  assert.equal(mbCalls, 0, 'MusicBrainz must not be called when Discogs succeeds');
  assert.equal(spCalls, 0, 'Spotify must not be called when Discogs succeeds');
  assert.deepEqual(result.labels.map(l => l.label), ['Electronic', 'Rock', 'Synth-pop', 'Indie Rock']);
  assert.deepEqual(result.labels.map(l => l.kind), ['genre', 'genre', 'style', 'style']);
  assert.ok(result.labels.every(l => l.provider === 'discogs'));
  service.close();
});

test('MusicBrainz success still queries and appends Spotify genres while keeping MusicBrainz main genre first', async () => {
  let spCalls = 0;
  const service = api.createService({
    storage: storage(),
    musicbrainzInterval: 1,
    discogs: async () => null, // No match on Discogs
    musicbrainz: async () => ({
      genres: ['Rock'],
      tags: ['Grunge', 'Alternative Rock'],
      entityId: 'mb-1',
      sourceUrl: 'https://musicbrainz.org/recording/mb-1'
    }),
    spotify: async () => {
      spCalls++;
      return [{ name: 'Post-Grunge', score: 0.88 }, { name: 'Rock', score: 0.95 }];
    },
    validateSpotifyGenre: () => true
  });
  const result = await service.resolve(TRACK);
  assert.equal(result.status, 'success');
  assert.equal(result.selectedProvider, 'musicbrainz');
  assert.equal(spCalls, 1, 'Spotify must also be queried when MusicBrainz succeeds');
  assert.deepEqual(result.labels.map(l => l.label), ['Rock', 'Grunge', 'Alternative Rock', 'Post-Grunge']);
  assert.deepEqual(result.labels.map(l => l.provider), ['musicbrainz', 'musicbrainz', 'musicbrainz', 'spotify']);
  assert.equal(result.labels[0].kind, 'genre');
  service.close();
});

test('createDiscogsAdapter and createMusicBrainzAdapter parse API responses and respect tokens', async () => {
  let cfg = { discogsToken: '', musicbrainzToken: 'mb-secret' };
  const discogsNoToken = createDiscogsAdapter(api, () => cfg, async () => { throw new Error('should not fetch'); });
  assert.equal(discogsNoToken.isConfigured(), false);
  await assert.rejects(discogsNoToken( api.identityFor(TRACK) ), e => e.status === 'not_configured' && e.code === 'DISCOGS_TOKEN_REQUIRED');

  cfg.discogsToken = 'my-discogs-token';
  assert.equal(discogsNoToken.isConfigured(), true);
  const discogsOk = createDiscogsAdapter(api, () => cfg, async url => {
    assert.ok(String(url).includes('token=my-discogs-token'));
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          results: [
            { id: 42, type: 'master', uri: '/master/42-Artist-A-Real-Thing', title: 'Artist A - Real Thing', genre: ['Electronic'], style: ['Deep House', 'Tech House'] }
          ]
        };
      }
    };
  });
  const dRes = await discogsOk(api.identityFor(TRACK));
  assert.deepEqual(dRes.genres, ['Electronic']);
  assert.deepEqual(dRes.styles, ['Deep House', 'Tech House']);

  const mbOk = createMusicBrainzAdapter(api, () => cfg, async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer mb-secret');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          recordings: [
            {
              id: 'rec-123',
              title: 'Real Thing',
              length: 240000,
              'artist-credit': [{ name: 'Artist A', artist: { name: 'Artist A' } }],
              genres: [{ name: 'Electronic', count: 5 }],
              tags: [{ name: 'Progressive House', count: 3 }]
            }
          ]
        };
      }
    };
  });
  const mRes = await mbOk(api.identityFor(TRACK));
  assert.deepEqual(mRes.genres, ['Electronic']);
  assert.deepEqual(mRes.tags, ['Progressive House']);
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

test('disabling all sources performs no queries and returns SOURCES_DISABLED', async () => {
  let calls = 0;
  const service = api.createService({
    storage: storage(),
    spotify: async () => { calls++; return [{ name: 'House' }]; },
    validateSpotifyGenre: () => true
  });
  await service.configure({ enabled: { discogs: false, musicbrainz: false, spotify: false } });
  const r = await service.resolve(TRACK);
  assert.equal(r.status, 'empty');
  assert.equal(r.reason, 'SOURCES_DISABLED');
  assert.equal(calls, 0);
  await service.resetConfig();
  assert.deepEqual(service.getConfig().order, ['discogs', 'musicbrainz', 'spotify']);
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

test('rate-limit exhaustion or connection failure automatically descends in priority (Discogs -> MusicBrainz -> Spotify) and circuit-breaks queued tracks', async () => {
  let dcCalls = 0, mbCalls = 0, spCalls = 0;
  let mbFail = false;
  const service = api.createService({
    storage: storage(),
    discogsInterval: 1000,
    musicbrainzInterval: 1,
    discogs: async () => {
      dcCalls++;
      throw new api.GenreError('rate_limited', 'DISCOGS_RATE_LIMITED', Date.now() + 60000);
    },
    musicbrainz: async () => {
      mbCalls++;
      if (mbFail) throw new api.GenreError('error', 'MUSICBRAINZ_REQUEST_FAILED', Date.now() + 20000);
      return { genres: ['Electronic'], tags: ['House'] };
    },
    spotify: async () => {
      spCalls++;
      return [{ name: 'Deep House', score: 0.9 }];
    },
    validateSpotifyGenre: () => true
  });

  // Track 1: Discogs is rate-limited -> descends to MusicBrainz (+ Spotify)
  const res1 = await service.resolve(TRACK);
  assert.equal(res1.status, 'success');
  assert.equal(res1.selectedProvider, 'musicbrainz');
  assert.deepEqual(res1.labels.map(l => l.label), ['Electronic', 'House', 'Deep House']);
  assert.equal(dcCalls, 1);

  // Track 2: Discogs circuit-breaker is active (blockedUntil) so dcCalls does NOT increment, AND now MusicBrainz fails connection -> descends to Spotify!
  mbFail = true;
  const track2 = { ...TRACK, uri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb', name: 'Another Track' };
  const res2 = await service.resolve(track2);
  assert.equal(res2.status, 'success');
  assert.equal(res2.selectedProvider, 'spotify');
  assert.deepEqual(res2.labels.map(l => l.label), ['Deep House']);
  assert.equal(dcCalls, 1, 'Discogs was skipped immediately due to active rate-limit block');
  assert.equal(mbCalls, 2);

  // Track 3: Both Discogs and MusicBrainz circuit-breakers are active -> goes straight to Spotify with 0 external calls
  const track3 = { ...TRACK, uri: 'spotify:track:cccccccccccccccccccccc', name: 'Third Track' };
  const res3 = await service.resolve(track3);
  assert.equal(res3.status, 'success');
  assert.equal(res3.selectedProvider, 'spotify');
  assert.equal(dcCalls, 1);
  assert.equal(mbCalls, 2, 'MusicBrainz was skipped immediately due to active connection-failure cooldown');
  assert.equal(spCalls, 3);
  service.close();
});

test('v1.11: legacy v1 saved order ["spotify"] automatically migrates to ["discogs", "musicbrainz", "spotify"] when all 3 are enabled', async () => {
  const store = storage();
  // Simulate v1.0.0 persisted settings where order only had ['spotify']
  await store.set('settings', 'genre-selector-v1', {
    version: 1,
    order: ['spotify'],
    enabled: { spotify: true },
    discogsToken: 'dc-token'
  });
  let dcCalled = 0, spCalled = 0;
  const dcAdapter = async () => { dcCalled++; return { genres: ['Electronic'], styles: ['Techno'] }; };
  dcAdapter.isConfigured = () => true;
  const service = api.createService({
    storage: store,
    discogsInterval: 1,
    discogs: dcAdapter,
    spotify: async () => { spCalled++; return [{ name: 'Dance', score: 0.9 }]; }
  });
  await service.ready;
  assert.deepEqual(service.getConfig().order, ['discogs', 'musicbrainz', 'spotify']);
  const res = await service.resolve(TRACK);
  assert.equal(res.selectedProvider, 'discogs');
  assert.equal(dcCalled, 1);
  assert.equal(spCalled, 0, 'Must not return directly from Spotify when all 3 sources are enabled');
  service.close();
});

test('v1.11: Discogs missing CORS rate-limit header does not block subsequent tracks and compact TXT cache round-trips', async () => {
  const cfg = { discogsToken: 'valid-token' };
  let fetchCount = 0;
  const discogs = createDiscogsAdapter(api, () => cfg, async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null }, // Browser CORS hides X-Discogs-Ratelimit-Remaining -> returns null
      async json() {
        return {
          results: [{ id: fetchCount, type: 'master', title: 'Artist A - Real Thing', genre: ['Electronic'], style: ['House'] }]
        };
      }
    };
  });
  let time = 1000;
  const store = storage();
  const service = api.createService({
    now: () => time,
    wait: async ms => { time += ms; if (ms >= 100) await new Promise(r => setImmediate(r)); },
    storage: store,
    discogsInterval: 1100,
    discogs,
    spotify: async () => [{ name: 'Fallback Pop', score: 0.9 }],
    validateSpotifyGenre: () => true
  });
  const track2 = { ...TRACK, uri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb', name: 'Real Thing', external_ids: { isrc: 'TEST87654321' } };
  const previews = [];
  const [r1, r2] = await Promise.all([
    service.resolve(TRACK),
    service.resolve(track2, { onPreview: p => previews.push(p) })
  ]);
  assert.equal(r1.status, 'success');
  assert.equal(r1.selectedProvider, 'discogs');
  assert.equal(r2.status, 'success', 'Second track must also succeed via Discogs and not fail with rate_limited');
  assert.equal(r2.selectedProvider, 'discogs');
  assert.equal(previews.length, 1, 'Queued second track receives fast fallback preview while waiting for paced Discogs slot');
  assert.equal(previews[0].selectedProvider, 'spotify');

  // Verify compact TXT cache round-trip
  const entriesMap = new Map(await store.entries('cache'));
  const txt = encodeCompactCache(entriesMap, time);
  assert.ok(txt.includes('provider:discogs:'), 'Compact TXT format serializes provider cache lines');
  const decoded = decodeCompactCache(txt, time);
  assert.equal(decoded.size, entriesMap.size);
  service.close();
});
