const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Genre4allPlayerWaveform } = require(path.join(__dirname, '..', 'src', 'player-waveform.js'));

test('Genre4allPlayerWaveform: formatMusicalKey formats key and mode correctly', () => {
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey(null, 0), '--');
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey(-1, 0), '--');
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey(12, 0), '--');
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey('invalid', 0), '--');

  // C Major (0, 1) and C minor (0, 0)
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey(0, 1), 'C Major');
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey(0, 0), 'C minor');

  // F minor (5, 0) - matches Beatport reference image
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey(5, 0), 'F minor');
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey(5, 1), 'F Major');

  // A minor (9, 0) and D Major (2, 1)
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey(9, 0), 'A minor');
  assert.equal(Genre4allPlayerWaveform.formatMusicalKey(2, 1), 'D Major');
});

test('Genre4allPlayerWaveform: formatCamelot maps keys to Camelot wheel', () => {
  assert.equal(Genre4allPlayerWaveform.formatCamelot(null, 0), '');
  assert.equal(Genre4allPlayerWaveform.formatCamelot(5, 0), '4A'); // F minor
  assert.equal(Genre4allPlayerWaveform.formatCamelot(0, 1), '8B'); // C Major
  assert.equal(Genre4allPlayerWaveform.formatCamelot(9, 0), '8A'); // A minor
});

test('Genre4allPlayerWaveform: formatBpm formats tempos to integer BPM', () => {
  assert.equal(Genre4allPlayerWaveform.formatBpm(null), '-- BPM');
  assert.equal(Genre4allPlayerWaveform.formatBpm(0), '-- BPM');
  assert.equal(Genre4allPlayerWaveform.formatBpm(-10), '-- BPM');
  assert.equal(Genre4allPlayerWaveform.formatBpm(128.75), '129 BPM');
  assert.equal(Genre4allPlayerWaveform.formatBpm(124.2), '124 BPM');
  assert.equal(Genre4allPlayerWaveform.formatBpm(130), '130 BPM');
});

test('Genre4allPlayerWaveform: formatTime converts milliseconds to m:ss', () => {
  assert.equal(Genre4allPlayerWaveform.formatTime(null), '0:00');
  assert.equal(Genre4allPlayerWaveform.formatTime(0), '0:00');
  assert.equal(Genre4allPlayerWaveform.formatTime(4000), '0:04');
  assert.equal(Genre4allPlayerWaveform.formatTime(65000), '1:05');
  assert.equal(Genre4allPlayerWaveform.formatTime(86000), '1:26');
  assert.equal(Genre4allPlayerWaveform.formatTime(386000), '6:26');
});

test('Genre4allPlayerWaveform: generateProceduralBars generates valid 180-bar waveform with kicks and dynamics', () => {
  const bars = Genre4allPlayerWaveform.generateProceduralBars(180, 180, 'spotify:track:test1234');
  assert.equal(bars.length, 180);
  for (let i = 0; i < bars.length; i++) {
    assert.ok(Number.isFinite(bars[i]), `Bar ${i} should be finite`);
    assert.ok(bars[i] >= 0.05 && bars[i] <= 1.0, `Bar ${i} out of bounds: ${bars[i]}`);
  }

  // Energy in drop section (e.g. index 70-90) should be higher than breakdown (index 110-120)
  const dropAvg = (bars[70] + bars[75] + bars[80] + bars[85]) / 4;
  const breakAvg = (bars[110] + bars[115] + bars[120]) / 3;
  assert.ok(dropAvg > breakAvg, `Drop average ${dropAvg} should exceed breakdown average ${breakAvg}`);
});

test('Genre4allPlayerWaveform: generateWaveformBars parses segments and kicks accurately', () => {
  const durationMs = 60000;
  const segments = [
    { start: 0, duration: 10, loudness_max: -30 },
    { start: 10, duration: 20, loudness_max: -5 }, // loud drop
    { start: 30, duration: 30, loudness_max: -35 } // quiet outro
  ];
  const beats = [
    { start: 10.0, duration: 0.5 },
    { start: 10.5, duration: 0.5 },
    { start: 11.0, duration: 0.5 },
    { start: 11.5, duration: 0.5 }
  ];
  const bars = Genre4allPlayerWaveform.generateWaveformBars(durationMs, segments, beats, [], 60);
  assert.equal(bars.length, 60);

  // Drop section with kicks (around bar 10-20) should have much higher amplitude than outro (around bar 45)
  const loudBar = bars[11];
  const quietBar = bars[45];
  assert.ok(loudBar > quietBar * 1.5, `Loud bar (${loudBar}) should be substantially higher than quiet bar (${quietBar})`);
});

test('Genre4allPlayerWaveform: parseAudioAnalysis builds clean metadata model', () => {
  const raw = {
    track: {
      duration: 386.4,
      tempo: 129.2,
      key: 5,
      mode: 0
    },
    segments: [
      { start: 0, duration: 5, loudness_max: -20 },
      { start: 5, duration: 10, loudness_max: -4 }
    ],
    beats: [
      { start: 5.0, duration: 0.46 }
    ]
  };

  const parsed = Genre4allPlayerWaveform.parseAudioAnalysis(raw, 'spotify:track:beatport1');
  assert.equal(parsed.trackUri, 'spotify:track:beatport1');
  assert.equal(parsed.duration, 386400);
  assert.equal(parsed.tempo, 129);
  assert.equal(parsed.keyLabel, 'F minor');
  assert.equal(parsed.bars.length, 1024);
  assert.equal(parsed.body.length, parsed.bars.length);
  assert.equal(parsed.available, true);
});

test('Genre4allPlayerWaveform: toggles enabled state and persists in storage', () => {
  const original = Genre4allPlayerWaveform.enabled;
  try {
    Genre4allPlayerWaveform.setEnabled(true);
    assert.equal(Genre4allPlayerWaveform.enabled, true);

    Genre4allPlayerWaveform.setEnabled(false);
    assert.equal(Genre4allPlayerWaveform.enabled, false);
  } finally {
    Genre4allPlayerWaveform.setEnabled(original);
  }
});

test('wave envelope preserves real attacks, quiet sections, silence, and bounded memory', () => {
  const waveform = Genre4allPlayerWaveform.buildWaveformEnvelope(10000, [
    { start: 0, duration: 2, loudness_start: -45, loudness_max: -30, loudness_max_time: .2, loudness_end: -42 },
    { start: 2, duration: 2, loudness_start: -30, loudness_max: -3, loudness_max_time: .05, loudness_end: -24 },
    { start: 4, duration: 2, loudness_start: -65, loudness_max: -62, loudness_max_time: .1, loudness_end: -70 },
    { start: 8, duration: 2, loudness_start: -40, loudness_max: -32, loudness_max_time: .3, loudness_end: -45 }
  ], 1000);
  assert.equal(waveform.available, true);
  assert.ok(Math.max(...waveform.peaks.slice(200, 400)) > Math.max(...waveform.peaks.slice(0, 200)) * 3);
  assert.equal(Math.max(...waveform.peaks.slice(400, 800)), 0, 'silence and missing segments stay silent');
  assert.ok(waveform.peaks[205] > waveform.body[205], 'short attack remains distinct from integrated body');
  assert.ok([...waveform.peaks].every((p, i) => Number.isFinite(p) && p >= 0 && p <= 1 && waveform.body[i] <= p));
  assert.equal(Genre4allPlayerWaveform.buildWaveformEnvelope(10000, [], Infinity).peaks.length, 180);
  assert.equal(Genre4allPlayerWaveform.buildWaveformEnvelope(10000, [], 999999).peaks.length, 4096);
});

test('missing or malformed audio never invents a musical arrangement', () => {
  for (const raw of [null, {}, { track: { duration: -1 }, segments: [{ start: NaN }] }, { track: { duration: 10 } }]) {
    const parsed = Genre4allPlayerWaveform.parseAudioAnalysis(raw, 'spotify:track:test');
    assert.equal(parsed.available, false);
    assert.equal(Math.max(...parsed.bars), 0);
    assert.deepEqual(parsed.regions, []);
  }
});

test('section summaries use supplied boundaries and describe energy without claiming instrument detection', () => {
  const body = Float32Array.from({ length: 100 }, (_, i) => i < 50 ? .2 : .8);
  const result = Genre4allPlayerWaveform.summarizeSections([
    { start: 5, duration: 5, confidence: .9 }, { start: 0, duration: 5, confidence: .9 },
    { start: 4, duration: 1, confidence: .1 }, { start: 11, duration: 2 }
  ], 10000, body);
  assert.deepEqual(result.map(r => [r.start, r.duration, r.description]), [[0, 5, 'Energia baixa'], [5, 5, 'Energia alta']]);
  const rise = Genre4allPlayerWaveform.summarizeSections([{ start: 0, duration: 10 }], 10000, Float32Array.from({ length: 100 }, (_, i) => i / 100));
  assert.equal(rise[0].description, 'Energia crescente');
});

test('audio analysis requests are deduplicated and cache only compact waveform data', async () => {
  const original = global.Spicetify;
  let requests = 0, finish;
  global.Spicetify = { getAudioData: async () => { requests++; return new Promise(resolve => { finish = resolve; }); } };
  try {
    const first = Genre4allPlayerWaveform.fetchAudioAnalysis('spotify:track:dedup');
    const second = Genre4allPlayerWaveform.fetchAudioAnalysis('spotify:track:dedup');
    assert.equal(requests, 1);
    finish({ track: { duration: 10 }, segments: [{ start: 0, duration: 10, loudness_max: -10 }] });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
    assert.equal(a.segments, undefined);
    assert.equal((await Genre4allPlayerWaveform.fetchAudioAnalysis('spotify:track:dedup')), a);
    assert.equal(requests, 1);
    assert.equal(await Genre4allPlayerWaveform.fetchAudioAnalysis('spotify:local:artist:song'), null);
  } finally { global.Spicetify = original; }
});

