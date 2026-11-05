'use strict';
// Isolated Chromium fixture; no account, live Spotify requests, or user playback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const executablePath = [chromium.executablePath(), 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
const paths = [
  'M3 5h2l6 6h2M11 3l2 2-2 2M3 11h2l2-2M9 7l2-2h2M11 9l2 2-2 2',
  'M3 3v10M12 3L5 8l7 5z', 'M5 3l8 5-8 5z', 'M13 3v10M4 3l7 5-7 5z',
  'M12 4H5a3 3 0 0 0-3 3M11 2l2 2-2 2M4 12h7a3 3 0 0 0 3-3M5 10l-2 2 2 2'
];
const buttons = ['Aleatório', 'Anterior', 'Reproduzir', 'Próxima', 'Repetir'].map((name, i) =>
  `<button aria-label="${name}" ${i === 2 ? 'data-testid="control-button-playpause"' : ''}><svg viewBox="0 0 16 16" width="18" height="18"><path d="${paths[i]}" fill="${i === 2 ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>`).join('');
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#121212;color:white;font:14px system-ui}main{padding:48px;color:#a7a7a7}h1{color:#fff;font-size:32px}p{max-width:620px;line-height:1.6}.label{font-size:11px;letter-spacing:2px;color:#888}
footer{position:fixed;bottom:0;left:0;width:100%;height:92px;background:#000;display:flex;align-items:center;padding:0 20px;gap:32px}.song{display:flex;gap:12px;align-items:center;flex:0 0 210px}.cover{width:52px;height:52px;background:linear-gradient(135deg,#555,#242424);border-radius:5px;display:grid;place-items:center;font-size:20px}.song small{display:block;color:#999;font-size:11px;margin-top:5px}.main-nowPlayingBar-center{flex:1;min-width:0}.player-controls{width:100%}.player-controls__buttons{display:flex;gap:16px;align-items:center;justify-content:center;margin-bottom:8px}button{background:none;border:0;color:#b3b3b3;width:30px;height:30px;display:inline-grid;place-items:center;cursor:pointer}button:hover{color:#fff}[data-testid=control-button-playpause]{background:#fff;color:#111;border-radius:50%;width:34px;height:34px}button svg{pointer-events:none}.playback-bar{display:flex;align-items:center;gap:8px}.progress-bar{height:4px;background:#888;flex:1}.volume{flex:0 0 130px;display:flex;gap:10px;align-items:center;font-size:12px;color:#aaa}.volume i{width:80px;height:4px;background:#aaa;border-radius:8px}
@media(max-width:850px){footer{gap:16px;padding:0 16px}.song{flex-basis:140px}.volume{flex-basis:64px}.volume i{width:44px}.cover{width:40px;height:40px}.song strong{font-size:11px}.song small{font-size:10px}}
</style><body><main><div class="label">GENRE4ALL · FIXTURE DE VALIDAÇÃO</div><h1>Leitura da faixa, do início ao fim.</h1><p>Envelope de teste com introdução, crescimento, trechos de maior intensidade e pausas. Dados sintéticos conhecidos para verificar a renderização; não representa uma música do Spotify.</p></main><footer><div class="song"><div class="cover">♪</div><div><strong>Waveform study</strong><small>Fixture · 124 BPM</small></div></div><div class="main-nowPlayingBar-center"><div class="player-controls"><div class="player-controls__buttons">${buttons}</div><div class="playback-bar"><span data-testid="playback-position">0:00</span><div class="progress-bar" data-testid="progress-bar"></div><span data-testid="playback-duration">6:00</span></div></div></div><div class="volume">◖<i></i></div></footer></body></html>`;

async function fixture(page) {
  await page.route('http://genre4all.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://genre4all.test/');
  await page.evaluate(() => {
    window.metrics = { reads: 0, geometry: 0, paints: 0, requests: 0, seeks: [], clicks: [] };
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (...args) { metrics.geometry++; return rect.apply(this, args); };
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) { metrics.paints++; return clear.apply(this, args); };
    window.position = 126000; window.playing = false; window.offline = false; window.listeners = new Map(); window.waiting = new Map();
    const sections = [0, 40, 80, 160, 220, 250, 320, 360].slice(0, -1).map((start, i, all) => ({ start, duration: (all[i + 1] ?? 360) - start, confidence: .9 }));
    const segments = Array.from({ length: 2880 }, (_, i) => {
      const t = i / 8;
      const db = t < 40 ? -29 : t < 80 ? -29 + (t - 40) * .5 : t < 160 ? -5 : t < 220 ? -32 : t < 250 ? -30 + (t - 220) * .75 : t < 320 ? -4 : -10 - (t - 320) * .6;
      return { start: t, duration: .125, loudness_start: db - 12, loudness_max: db + (i % 4 === 0 ? 1 : -5), loudness_max_time: .018, loudness_end: db - 14 };
    });
    window.analysis = { track: { duration: 360, tempo: 124, key: 5, mode: 0 }, segments, sections };
    window.Spicetify = {
      Platform: { History: { location: { pathname: '/playlist/fixture' }, listen() { return () => {}; } } },
      Player: {
        data: { item: { uri: 'spotify:track:wavefixture' } }, isPlaying: () => playing,
        getDuration: () => 360000, getProgress: () => { metrics.reads++; return position; },
        seek: ratio => { metrics.seeks.push(ratio); position = ratio * 360000; },
        addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
        removeEventListener: (name, fn) => listeners.get(name)?.delete(fn)
      },
      getAudioData: async uri => { metrics.requests++; if (offline) throw Error('offline'); if (uri.endsWith('slow')) return new Promise(resolve => waiting.set(uri, resolve)); return analysis; },
      CosmosAsync: { get: async () => { throw Error('offline'); } }
    };
    window.emit = name => listeners.get(name)?.forEach(fn => fn());
    document.querySelectorAll('.player-controls__buttons button').forEach(button => button.addEventListener('click', () => metrics.clicks.push(button.ariaLabel)));
  });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await fixture(page);
    await page.addScriptTag({ path: path.join(root, 'Genre4all.js') });
    await page.evaluate(() => Genre4all.setPlayerWaveform(true));
    await page.waitForFunction(() => document.querySelector('.g4a-meta-bpm')?.textContent === '124 bpm');
    await page.locator('.g4a-waveform-track').screenshot({ path: path.join(output, 'waveform-white.png') });
    assert.equal(await page.locator('.g4a-meta-key').textContent(), 'F minor');
    assert.equal(await page.locator('.g4a-waveform-status').textContent(), '');
    assert.equal(await page.locator('.g4a-waveform-canvas').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2]) return false;
      return true;
    }), true, 'all waveform pixels are monochrome');
    const wave = page.locator('.g4a-waveform-track'), box = await wave.boundingBox();
    await page.mouse.click(box.x + box.width * .25, box.y + box.height / 2);
    assert.ok(Math.abs(await page.evaluate(() => metrics.seeks.at(-1)) - .25) < .01);
    await wave.press('ArrowRight');
    assert.ok(Math.abs(await page.evaluate(() => position) - 95000) < 700);
    await wave.press('Home'); assert.equal(await page.evaluate(() => position), 0);
    await wave.press('End'); assert.equal(await page.evaluate(() => position), 360000);
    await page.mouse.move(box.x + box.width * .15, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * .7, box.y + box.height / 2, { steps: 10 }); await page.mouse.up();
    assert.ok(Math.abs(await page.evaluate(() => metrics.seeks.at(-1)) - .7) < .01);
    await page.mouse.move(box.x + box.width * .35, box.y + 20);
    await page.waitForFunction(() => document.querySelector('.g4a-waveform-tooltip').textContent.includes('Trecho 3'));
    const idleStart = await page.evaluate(() => ({ ...metrics }));
    await page.waitForTimeout(650);
    const idleEnd = await page.evaluate(() => ({ ...metrics }));
    assert.ok(idleEnd.reads - idleStart.reads <= 2, 'stationary hover does not run a frame loop');
    const geometryBefore = await page.evaluate(() => metrics.geometry);
    await page.mouse.move(80, 100); await page.mouse.move(700, 100, { steps: 40 });
    const geometryAfter = await page.evaluate(() => metrics.geometry);
    assert.equal(geometryAfter, geometryBefore, 'unrelated pointer moves do not measure player layout');

    await page.locator('.g4a-island-sensor').hover();
    await page.waitForFunction(() => document.querySelector('[data-g4a-island-host]').classList.contains('g4a-island-open'));
    await page.waitForTimeout(550);
    const island = page.locator('[data-g4a-island-controls]'), islandBox = await island.boundingBox();
    const gap = await page.evaluate(() => document.querySelector('[data-g4a-island-host]').getBoundingClientRect().top - document.querySelector('[data-g4a-island-controls]').getBoundingClientRect().bottom);
    assert.ok(gap >= 13, 'island floats above the waveform with a clear gap');
    const delays = await island.locator('button').evaluateAll(nodes => nodes.map(b => parseFloat(b.style.getPropertyValue('--g4a-enter-delay'))));
    assert.ok(delays[2] < delays[1] && delays[1] < delays[0], 'center button leads the stagger');
    await wave.evaluate(el => el.blur());
    await page.screenshot({ path: path.join(output, 'player-desktop.png') });
    await page.getByRole('button', { name: 'Reproduzir', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => metrics.clicks), ['Reproduzir']);
    await page.mouse.move(40, 100); await page.waitForTimeout(450);
    assert.equal(await island.evaluate(el => getComputedStyle(el).opacity), '0', 'pointer click does not trap island open');
    await page.getByRole('button', { name: 'Anterior', exact: true }).focus();
    await page.waitForTimeout(450);
    assert.equal(await island.evaluate(el => getComputedStyle(el).opacity), '1', 'keyboard can reveal native controls');
    await page.getByRole('button', { name: 'Anterior', exact: true }).press('Escape');
    assert.equal(await wave.evaluate(el => el === document.activeElement), true);

    // No repaints in a hidden tab, then recover on visibilitychange.
    await page.evaluate(() => { window.hiddenFixture = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => hiddenFixture }); document.dispatchEvent(new Event('visibilitychange')); });
    const hiddenPaints = await page.evaluate(() => metrics.paints);
    await page.waitForTimeout(1050); assert.equal(await page.evaluate(() => metrics.paints), hiddenPaints);
    await page.evaluate(() => { hiddenFixture = false; position = 180000; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => document.querySelector('.g4a-meta-time-current').textContent === '3:00');
    // Late analysis cannot overwrite the next song.
    await page.evaluate(() => { Spicetify.Player.data.item.uri = 'spotify:track:slow'; emit('songchange'); });
    await page.waitForFunction(() => waiting.has('spotify:track:slow'));
    await page.evaluate(() => { offline = true; Spicetify.Player.data.item.uri = 'spotify:track:offline'; emit('songchange'); });
    await page.waitForFunction(() => document.querySelector('.g4a-waveform-status').textContent === 'Análise indisponível');
    await page.evaluate(() => waiting.get('spotify:track:slow')(analysis));
    await page.waitForTimeout(80); assert.equal(await page.locator('.g4a-meta-bpm').textContent(), '-- bpm');
    await wave.press('Home'); assert.equal(await page.evaluate(() => position), 0, 'offline seek still works');
    await page.screenshot({ path: path.join(output, 'player-unavailable.png') });
    await page.evaluate(() => { offline = false; Spicetify.Player.data.item.uri = 'spotify:track:wavefixture'; emit('songchange'); });
    await page.waitForFunction(() => document.querySelector('.g4a-meta-bpm').textContent === '124 bpm');

    // Spotify remounts its player; native nodes are not moved or cloned by the extension.
    await page.evaluate(() => {
      const center = document.querySelector('.main-nowPlayingBar-center');
      const replacement = center.cloneNode(true);
      replacement.querySelector('.g4a-waveform-player')?.remove(); replacement.querySelector('.g4a-island-sensor')?.remove();
      center.replaceWith(replacement); emit('onplaypause');
    });
    await page.waitForFunction(() => document.querySelectorAll('.g4a-waveform-player').length === 1);
    await page.locator('.g4a-island-sensor').hover(); await page.waitForTimeout(450);
    assert.equal(await page.locator('[data-g4a-island-controls]').evaluate(el => getComputedStyle(el).opacity), '1');
    await page.setViewportSize({ width: 720, height: 600 });
    await page.locator('.g4a-island-sensor').hover(); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(output, 'player-compact.png') });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'compact player does not overflow');
    assert.ok((await wave.boundingBox()).width > 160, 'waveform stays legible at compact width');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await page.locator('[data-g4a-island-controls] button').first().evaluate(el => getComputedStyle(el).transitionDuration);
    assert.ok(duration.split(',').every(value => parseFloat(value) <= .001));
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => Genre4all.setPlayerWaveform(false));
      assert.equal(await page.locator('.g4a-island-sensor,.g4a-waveform-player,[data-g4a-island-controls]').count(), 0);
      assert.equal(await page.evaluate(() => [...listeners.values()].reduce((sum, set) => sum + set.size, 0)), 2, 'only the two runtime listeners remain');
      await page.evaluate(() => Genre4all.setPlayerWaveform(true));
      await page.waitForFunction(() => !!document.querySelector('.g4a-waveform-player'));
    }
    assert.equal(await page.locator('.g4a-island-sensor').count(), 1);
    assert.equal(await page.evaluate(() => [...listeners.values()].reduce((sum, set) => sum + set.size, 0)), 4);
    await page.evaluate(() => Genre4all.close());
    assert.equal(await page.locator('.g4a-waveform-player,[data-g4a-island-host]').count(), 0);
    assert.equal(await page.evaluate(() => [...listeners.values()].reduce((sum, set) => sum + set.size, 0)), 0);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'player-validation.json'), JSON.stringify({ idleHoverReads: idleEnd.reads - idleStart.reads, unrelatedPointerLayoutReads: geometryAfter - geometryBefore, gap, buttonDelaysMs: delays, desktopIsland: islandBox, errors }, null, 2));
    console.log('Player browser checks passed: monochrome waveform, sections, seeking, keyboard, native controls, island, offline fallback, stale analysis, visibility, remount, compact width, reduced motion and teardown.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
