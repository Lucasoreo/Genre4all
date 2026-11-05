/* Genre4all Beatport-style Player Waveform with Apple-style Dynamic Island controls */
const Genre4allPlayerWaveform = (() => {
  'use strict';

  const STORAGE_KEY = 'genre4all-player-waveform-v1';
  const PITCH_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
  const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];
  const MAX_CACHE_ENTRIES = 64;
  const ANALYSIS_BARS = 1024;
  const EMPTY_BARS = new Float32Array(180).fill(0.035);
  const pendingAnalysis = new Map();

  const analysisCache = new Map();
  let enabled = false;
  let active = false;
  let mountedElement = null;
  let mountedRefs = null;
  let resizeObs = null;
  let animFrame = null;
  let pollTimer = null;
  let islandHideTimer = null;
  let currentTrackUri = null;
  let currentAnalysis = null;
  let isDragging = false;
  let dragRatio = 0;
  let hoverRatio = null;
  let lastSeekAt = 0;
  let mountCleanup = null;
  let analysisRevision = 0;

  try {
    enabled = localStorage.getItem(STORAGE_KEY) === 'true';
  } catch { /* Fallback to default false */ }

  function formatMusicalKey(key, mode) {
    if (key == null || key < 0 || key > 11 || !Number.isInteger(key)) return '--';
    const pitch = PITCH_NAMES[key];
    const modeName = mode === 1 ? 'Major' : 'minor';
    return `${pitch} ${modeName}`;
  }

  function formatCamelot(key, mode) {
    if (key == null || key < 0 || key > 11 || !Number.isInteger(key)) return '';
    return mode === 1 ? CAMELOT_MAJOR[key] : CAMELOT_MINOR[key];
  }

  function formatBpm(tempo) {
    if (tempo == null || tempo <= 0 || !Number.isFinite(tempo)) return '-- BPM';
    return `${Math.round(tempo)} BPM`;
  }

  function formatTime(ms) {
    if (ms == null || !Number.isFinite(ms) || ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function generateProceduralBars(durSec, barCount = 180, seedStr = '') {
    const bars = new Float32Array(barCount);
    let hash = 2166136261;
    for (let i = 0; i < seedStr.length; i++) {
      hash ^= seedStr.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const seed = (hash >>> 0) / 4294967296;

    const bpm = 124 + Math.round(seed * 8);
    const beatIntervalSec = 60 / bpm;
    const dt = (durSec || 180) / barCount;

    for (let i = 0; i < barCount; i++) {
      const progress = i / barCount;
      const t = i * dt;

      // Realistic DJ/Beatport track arrangement: intro -> build -> drop 1 -> breakdown -> drop 2 -> outro
      let env = 0.28;
      if (progress < 0.08) {
        env = 0.16 + (progress / 0.08) * 0.24;
      } else if (progress < 0.16) {
        env = 0.40 + ((progress - 0.08) / 0.08) * 0.28;
      } else if (progress < 0.54) {
        env = 0.84 + Math.sin((progress - 0.16) * 28) * 0.07;
      } else if (progress < 0.71) {
        env = 0.22 + Math.sin((progress - 0.54) * 18) * 0.09;
      } else if (progress < 0.91) {
        env = 0.88 + Math.cos((progress - 0.71) * 24) * 0.06;
      } else {
        env = 0.45 * (1 - (progress - 0.91) / 0.09) + 0.10;
      }

      const beatPhase = (t % beatIntervalSec) / beatIntervalSec;
      const isKickSlot = (i % 2 === 0) || beatPhase < 0.26;
      const n1 = Math.abs((Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453) % 1);
      const n2 = Math.abs((Math.cos(i * 39.3467 + seed * 19.173) * 27183.1923) % 1);

      let amp;
      if (env > 0.62) {
        // High-energy drop section: sharp separation between kick spikes and off-beat bass body
        if (isKickSlot && n1 > 0.18) {
          amp = env * (0.86 + n2 * 0.14);
        } else {
          amp = env * (0.42 + n1 * 0.24);
        }
      } else {
        // Intro / breakdown / outro: lower threshold with subtle percussive peaks
        amp = env * (0.55 + n1 * 0.45);
      }
      bars[i] = Math.max(0.06, Math.min(1.0, amp));
    }

    return bars;
  }

  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  const barLength = count => Number.isFinite(count) && count > 0 ? clamp(Math.floor(count), 1, 4096) : 180;

  // Integrate the real segment attack/decay envelope. No fabricated beats or pixel noise.
  // Peaks preserve attacks; the energy-weighted body shows sustained vs. sparse passages.
  function buildWaveformEnvelope(durationMs, segments, barCount = 180) {
    const count = barLength(barCount);
    const peaks = new Float32Array(count), body = new Float32Array(count);
    const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;
    if (!duration || !Array.isArray(segments) || !segments.length) return { peaks, body, available: false };
    const valid = segments.filter(s => Number.isFinite(s.start) && Number.isFinite(s.duration) && s.duration > 0
      && s.start < duration && s.start + s.duration > 0 && Number.isFinite(s.loudness_max));
    if (!valid.length) return { peaks, body, available: false };
    if (valid.some((s, i) => i && s.start < valid[i - 1].start)) valid.sort((a, b) => a.start - b.start);
    const sorted = valid.map(s => s.loudness_max).sort((a, b) => a - b);
    // One gain for the entire song preserves quiet/loud section contrast.
    const ceiling = Math.max(-20, sorted[Math.ceil((sorted.length - 1) * .98)] + 1);
    const amplitude = db => db <= -60 ? 0 : clamp(Math.pow(10, (clamp(db, -80, 6) - ceiling) / 32));
    const dt = duration / count;
    function integrate(t0, t1, a0, a1) {
      if (t1 <= t0) return;
      const first = Math.max(0, Math.floor(t0 / dt)), last = Math.min(count - 1, Math.ceil(t1 / dt) - 1);
      for (let i = first; i <= last; i++) {
        const lo = Math.max(i * dt, t0, 0), hi = Math.min((i + 1) * dt, t1, duration);
        if (hi <= lo) continue;
        const v0 = a0 + (a1 - a0) * (lo - t0) / (t1 - t0);
        const v1 = a0 + (a1 - a0) * (hi - t0) / (t1 - t0);
        peaks[i] = Math.max(peaks[i], v0, v1);
        body[i] += (hi - lo) * (v0 * v0 + v0 * v1 + v1 * v1) / (3 * dt);
      }
    }
    for (let i = 0; i < valid.length; i++) {
      const s = valid[i];
      // Do not double-count overlapping segments.
      const end = Math.min(s.start + s.duration, valid[i + 1]?.start ?? duration, duration);
      if (end <= s.start) continue;
      const peakTime = s.start + clamp(Number.isFinite(s.loudness_max_time) ? s.loudness_max_time : s.duration * .2, 0, end - s.start);
      const start = amplitude(Number.isFinite(s.loudness_start) ? s.loudness_start : s.loudness_max - 6);
      const peak = amplitude(s.loudness_max);
      const finish = amplitude(Number.isFinite(s.loudness_end) ? s.loudness_end
        : Number.isFinite(valid[i + 1]?.loudness_start) ? valid[i + 1].loudness_start : s.loudness_max - 8);
      integrate(s.start, peakTime, start, peak);
      integrate(peakTime, end, peak, finish);
    }
    for (let i = 0; i < count; i++) body[i] = Math.min(peaks[i], Math.sqrt(body[i]));
    return { peaks, body, available: true };
  }

  function generateWaveformBars(durationMs, segments, beats, sections, barCount = 180) {
    return buildWaveformEnvelope(durationMs, segments, barCount).peaks;
  }

  function summarizeSections(sections, durationMs, body) {
    const duration = durationMs / 1000;
    if (!duration || !body?.length || !Array.isArray(sections)) return [];
    const valid = sections.filter(s => Number.isFinite(s.start) && s.start >= 0 && s.start < duration
      && Number.isFinite(s.duration) && s.duration > 0 && (!Number.isFinite(s.confidence) || s.confidence >= .3))
      .sort((a, b) => a.start - b.start).slice(0, 128);
    return valid.map((s, index) => {
      const end = Math.min(duration, s.start + s.duration, valid[index + 1]?.start ?? duration);
      const first = Math.floor(s.start / duration * body.length), last = Math.min(body.length, Math.ceil(end / duration * body.length));
      let sum = 0, early = 0, late = 0, earlyCount = 0, lateCount = 0;
      for (let i = first; i < last; i++) {
        sum += body[i];
        if (i < first + (last - first) / 3) { early += body[i]; earlyCount++; }
        if (i >= last - (last - first) / 3) { late += body[i]; lateCount++; }
      }
      const energy = sum / Math.max(1, last - first);
      const delta = late / Math.max(1, lateCount) - early / Math.max(1, earlyCount);
      const description = delta > .12 ? 'Energia crescente' : delta < -.12 ? 'Energia decrescente'
        : energy >= .6 ? 'Energia alta' : energy <= .28 ? 'Energia baixa' : 'Energia moderada';
      return { start: s.start, duration: end - s.start, energy, description, index: index + 1 };
    }).filter(s => s.duration > 0);
  }

  function parseAudioAnalysis(raw, trackUri) {
    const duration = Number.isFinite(raw?.track?.duration) && raw.track.duration > 0 ? raw.track.duration * 1000 : 0;
    const tempo = Number.isFinite(raw?.track?.tempo) && raw.track.tempo > 0 ? Math.round(raw.track.tempo) : null;
    const key = raw?.track?.key ?? null, mode = raw?.track?.mode ?? null;
    const segments = Array.isArray(raw?.segments) ? raw.segments : [];
    const beats = Array.isArray(raw?.beats) ? raw.beats : [];
    const sections = Array.isArray(raw?.sections) ? raw.sections : [];
    const envelope = buildWaveformEnvelope(duration, segments, ANALYSIS_BARS);
    return { trackUri, duration, tempo, key, mode, keyLabel: formatMusicalKey(key, mode),
      segments, beats, sections, bars: envelope.peaks, body: envelope.body, available: envelope.available,
      regions: envelope.available ? summarizeSections(sections, duration, envelope.body) : [] };
  }

  async function fetchAudioAnalysis(trackUri) {
    if (!/^spotify:track:[a-zA-Z0-9]+$/.test(trackUri || '')) return null;
    if (analysisCache.has(trackUri)) {
      const cached = analysisCache.get(trackUri);
      analysisCache.delete(trackUri); analysisCache.set(trackUri, cached);
      return cached;
    }
    if (pendingAnalysis.has(trackUri)) return pendingAnalysis.get(trackUri);
    const revision = analysisRevision;
    const request = (async () => {
      let raw = null;
      if (typeof Spicetify !== 'undefined' && typeof Spicetify.getAudioData === 'function') {
        try { raw = await Spicetify.getAudioData(trackUri); } catch { /* Try the existing alternate transport. */ }
      }
      if (!raw?.track && typeof Spicetify !== 'undefined' && Spicetify.CosmosAsync?.get) {
        try { raw = await Spicetify.CosmosAsync.get('https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/' + trackUri.slice(14) + '?format=json'); }
        catch { /* Keep seek available even without analysis. */ }
      }
      if (!raw?.track || revision !== analysisRevision) return null;
      const parsed = parseAudioAnalysis(raw, trackUri);
      const { segments, beats, sections, ...compact } = parsed;
      while (analysisCache.size >= MAX_CACHE_ENTRIES) analysisCache.delete(analysisCache.keys().next().value);
      analysisCache.set(trackUri, compact);
      return compact;
    })();
    pendingAnalysis.set(trackUri, request);
    try { return await request; }
    finally { if (pendingAnalysis.get(trackUri) === request) pendingAnalysis.delete(trackUri); }
  }

  // Static geometry is rasterized once per track/size, then progress only composites bitmaps.
  function drawBeatportWaveLayer(ctx, width, height, bars, isPlayed, model = {}) {
    ctx.clearRect(0, 0, width, height);
    const mid = height / 2, amplitude = Math.max(1, mid - 6);
    const duration = (model.duration || 0) / 1000;
    for (const section of model.regions || []) {
      const x = section.start / duration * width, end = (section.start + section.duration) / duration * width;
      ctx.fillStyle = 'rgba(255,255,255,' + (.025 + section.energy * .035) + ')';
      ctx.fillRect(x, 5, end - x, height - 10);
      ctx.fillStyle = isPlayed ? 'rgba(255,255,255,.44)' : 'rgba(255,255,255,.24)';
      ctx.fillRect(x + 1, 1, Math.max(0, end - x - 2), 2);
      if (x > 0) { ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(Math.round(x), 5, 1, height - 10); }
    }
    if (!bars?.length || model.available === false) {
      ctx.fillStyle = isPlayed ? '#ffffff' : '#656565';
      ctx.fillRect(0, mid, width, 1);
      return;
    }
    const cols = Math.max(1, Math.floor(width));
    const bodyHeights = new Float32Array(cols);
    ctx.fillStyle = isPlayed ? 'rgba(255,255,255,.78)' : 'rgba(255,255,255,.31)';
    ctx.beginPath();
    for (let x = 0; x < cols; x++) {
      const lo = Math.floor(x * bars.length / cols), hi = Math.max(lo + 1, Math.ceil((x + 1) * bars.length / cols));
      let peak = 0, sum = 0;
      for (let i = lo; i < hi && i < bars.length; i++) {
        peak = Math.max(peak, bars[i]);
        sum += model.body?.[i] ?? bars[i] * .65;
      }
      const peakHeight = Math.max(.5, peak * amplitude);
      bodyHeights[x] = Math.max(.5, Math.min(peak, sum / (hi - lo)) * amplitude);
      ctx.rect(x, mid - peakHeight, 1, peakHeight * 2);
    }
    ctx.fill();
    ctx.fillStyle = isPlayed ? '#ffffff' : '#999999';
    ctx.beginPath();
    for (let x = 0; x < cols; x++) ctx.rect(x, mid - bodyHeights[x], 1, bodyHeights[x] * 2);
    ctx.fill();
  }

  function renderWaveform(ctx, width, height, bars, progressRatio, hoverRatioVal, model = {}) {
    if (width <= 0 || height <= 0) return;
    ctx.clearRect(0, 0, width, height);
    const playheadX = clamp(Number(progressRatio) || 0) * width;
    const canvas = ctx.canvas;
    const dpr = canvas?.width && width ? canvas.width / width : 1;
    let cache = canvas?.__g4aWaveCache;
    if (canvas?.ownerDocument && (!cache || cache.bars !== bars || cache.body !== model.body || cache.regions !== model.regions
      || cache.available !== model.available || cache.w !== width || cache.h !== height || cache.dpr !== dpr)) {
      const playedCanvas = canvas.ownerDocument.createElement('canvas'), unplayedCanvas = canvas.ownerDocument.createElement('canvas');
      for (const [layer, played] of [[playedCanvas, true], [unplayedCanvas, false]]) {
        layer.width = Math.round(width * dpr); layer.height = Math.round(height * dpr);
        const layerCtx = layer.getContext('2d');
        layerCtx.scale(dpr, dpr);
        drawBeatportWaveLayer(layerCtx, width, height, bars, played, model);
      }
      cache = { bars, body: model.body, regions: model.regions, available: model.available, w: width, h: height, dpr, playedCanvas, unplayedCanvas };
      canvas.__g4aWaveCache = cache;
    }
    if (cache) {
      ctx.drawImage(cache.unplayedCanvas, 0, 0, width, height);
      if (playheadX > 0) ctx.drawImage(cache.playedCanvas, 0, 0, playheadX * dpr, height * dpr, 0, 0, playheadX, height);
    } else {
      drawBeatportWaveLayer(ctx, width, height, bars, false, model);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, playheadX, height); ctx.clip();
      drawBeatportWaveLayer(ctx, width, height, bars, true, model); ctx.restore();
    }
    const x = clamp(Math.round(playheadX), .5, width - .5);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, 4, 1, height - 8);
    if (hoverRatioVal != null) {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillRect(clamp(Math.round(hoverRatioVal * width), 0, width - 1), 0, 1, height);
    }
  }

  function scheduleSync() {
    if (!active || typeof window === 'undefined' || document.hidden) return;
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (animFrame !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      animFrame = requestAnimationFrame(syncPlayer);
    }
  }

  function resolveControlsElement(playbackBar, centerContainer) {
    const parent = playbackBar?.parentElement || centerContainer;
    if (!parent) return null;
    // Direct selector for Spotify's transport buttons row
    const direct = parent.querySelector('.player-controls__buttons, [data-testid="player-controls"] > .player-controls__buttons');
    if (direct && !direct.contains(playbackBar)) return direct;
    // Fallback: find the sibling of playbackBar that contains the play/pause button
    const searchRoot = centerContainer || parent;
    const playBtn = searchRoot.querySelector('[data-testid="control-button-playpause"], .main-playPauseButton-button');
    if (playBtn) {
      let node = playBtn;
      while (node && node.parentElement && node.parentElement !== parent && node.parentElement !== centerContainer) {
        if (node.parentElement.contains(playbackBar)) break;
        node = node.parentElement;
      }
      if (node && !node.contains(playbackBar)) return node;
    }
    for (const child of parent.children) {
      if (child !== playbackBar && !child.classList.contains('g4a-waveform-player') && !child.classList.contains('g4a-island-sensor') && child.querySelector?.('button')) {
        return child;
      }
    }
    return null;
  }

  function releaseMount() {
    mountCleanup?.();
    mountCleanup = null;
    resizeObs?.disconnect(); resizeObs = null;
    if (islandHideTimer !== null) { clearTimeout(islandHideTimer); islandHideTimer = null; }
    if (mountedRefs) {
      for (const [el, attr] of [[mountedRefs.islandHost, 'data-g4a-island-host'], [mountedRefs.centerContainer, 'data-g4a-island-center'], [mountedRefs.controlsEl, 'data-g4a-island-controls']]) {
        el?.removeAttribute(attr); el?.classList.remove('g4a-island-open');
      }
      mountedRefs.controlsEl?.querySelectorAll('button').forEach(button => button.style.removeProperty('--g4a-enter-delay'));
      mountedRefs.sensor?.remove();
    }
    mountedElement?.remove(); mountedElement = null; mountedRefs = null;
    isDragging = false; hoverRatio = null;
  }

  function injectWaveformUI(playbackBar, centerContainer) {
    const islandHost = playbackBar?.parentElement || centerContainer;
    if (!playbackBar || !islandHost) return;
    if (mountedElement?.isConnected && mountedElement.parentElement === playbackBar
      && mountedRefs?.controlsEl?.isConnected && mountedRefs.controlsEl.parentElement === islandHost
      && mountedRefs.centerContainer === centerContainer) return;
    const controlsEl = resolveControlsElement(playbackBar, centerContainer);
    if (mountedElement?.isConnected && mountedElement.parentElement === playbackBar && mountedRefs?.controlsEl === controlsEl
      && mountedRefs.centerContainer === centerContainer) return;
    releaseMount();
    islandHost.setAttribute('data-g4a-island-host', 'true');
    centerContainer?.setAttribute('data-g4a-island-center', 'true');
    controlsEl?.setAttribute('data-g4a-island-controls', 'true');

    const root = document.createElement('div'); root.className = 'g4a-waveform-player';
    const meta = document.createElement('div'); meta.className = 'g4a-waveform-meta';
    const timeEl = document.createElement('div'); timeEl.className = 'g4a-meta-time'; timeEl.title = 'Tempo decorrido / Duração total';
    const timeCurrentSpan = document.createElement('span'); timeCurrentSpan.className = 'g4a-meta-time-current'; timeCurrentSpan.textContent = '0:00';
    const timeTotalSpan = document.createElement('span'); timeTotalSpan.className = 'g4a-meta-time-total'; timeTotalSpan.textContent = ' / 0:00';
    timeEl.append(timeCurrentSpan, timeTotalSpan);
    const bpmEl = document.createElement('div'); bpmEl.className = 'g4a-meta-bpm'; bpmEl.title = 'Batidas por minuto'; bpmEl.textContent = '-- bpm';
    const keyEl = document.createElement('div'); keyEl.className = 'g4a-meta-key'; keyEl.title = 'Tom musical'; keyEl.textContent = '--';
    meta.append(timeEl, bpmEl, keyEl);
    const track = document.createElement('div'); track.className = 'g4a-waveform-track';
    track.tabIndex = 0; track.setAttribute('role', 'slider'); track.setAttribute('aria-label', 'Posição na música');
    track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', '0');
    const canvas = document.createElement('canvas'); canvas.className = 'g4a-waveform-canvas'; canvas.setAttribute('aria-hidden', 'true');
    const tooltip = document.createElement('div'); tooltip.className = 'g4a-waveform-tooltip'; tooltip.setAttribute('aria-hidden', 'true');
    const status = document.createElement('span'); status.className = 'g4a-waveform-status';
    track.append(canvas, tooltip, status); root.append(meta, track);
    const sensor = document.createElement('div'); sensor.className = 'g4a-island-sensor'; sensor.setAttribute('aria-hidden', 'true');
    islandHost.append(sensor); playbackBar.append(root);
    mountedElement = root;
    const events = new AbortController();
    const listen = (el, type, fn, options = {}) => el?.addEventListener(type, fn, { ...options, signal: events.signal });
    let pointerInside = false, keyboardFocus = false, cachedRect = null;
    const closeIsland = (force = false) => {
      if (!force && (pointerInside || keyboardFocus)) return;
      clearTimeout(islandHideTimer); islandHideTimer = null;
      islandHost.classList.remove('g4a-island-open');
      centerContainer?.classList.remove('g4a-island-open');
    };
    const openIsland = () => {
      clearTimeout(islandHideTimer); islandHideTimer = null;
      if (isDragging) return;
      islandHost.classList.add('g4a-island-open');
      centerContainer?.classList.add('g4a-island-open');
    };
    const scheduleClose = () => {
      if (islandHideTimer !== null) return;
      islandHideTimer = setTimeout(() => { islandHideTimer = null; closeIsland(); }, 180);
    };
    for (const el of [sensor, controlsEl]) {
      listen(el, 'pointerenter', () => { pointerInside = true; openIsland(); }, { passive: true });
      listen(el, 'pointerleave', () => { pointerInside = false; scheduleClose(); }, { passive: true });
    }
    listen(controlsEl, 'focusin', e => { keyboardFocus = e.target.matches?.(':focus-visible') || false; openIsland(); });
    listen(controlsEl, 'focusout', e => {
      if (!controlsEl.contains(e.relatedTarget)) { keyboardFocus = false; scheduleClose(); }
    });
    listen(controlsEl, 'pointerdown', () => { keyboardFocus = false; }, { passive: true });
    listen(controlsEl, 'click', e => {
      if (e.detail > 0 && controlsEl.contains(document.activeElement)) document.activeElement.blur();
    });
    listen(controlsEl, 'keydown', e => {
      if (e.key === 'Escape') { keyboardFocus = false; pointerInside = false; track.focus(); closeIsland(true); }
    });
    listen(window, 'blur', () => { pointerInside = false; keyboardFocus = false; closeIsland(true); });
    const staggerButtons = () => {
      const buttons = [...(controlsEl?.querySelectorAll('button') || [])], middle = (buttons.length - 1) / 2;
      buttons.forEach((button, i) => {
        const delay = Math.round(30 + Math.abs(i - middle) * 26 + (i > middle ? 12 : 0)) + 'ms';
        if (button.style.getPropertyValue('--g4a-enter-delay') !== delay) button.style.setProperty('--g4a-enter-delay', delay);
      });
    };
    staggerButtons();
    const controlsObserver = typeof MutationObserver === 'function' ? new MutationObserver(staggerButtons) : null;
    if (controlsEl) controlsObserver?.observe(controlsEl, { childList: true, subtree: true });
    mountCleanup = () => { events.abort(); controlsObserver?.disconnect(); };

    const getRect = force => {
      if (force || !cachedRect) cachedRect = track.getBoundingClientRect();
      return cachedRect;
    };
    const ratioAt = (e, force = false) => {
      const rect = getRect(force);
      return rect.width > 0 ? clamp((e.clientX - rect.left) / rect.width) : 0;
    };
    const durationMs = () => typeof Spicetify !== 'undefined' ? Spicetify.Player?.getDuration?.() || currentAnalysis?.duration || 0 : 0;
    const seek = ratio => { if (typeof Spicetify !== 'undefined') Spicetify.Player?.seek?.(clamp(ratio)); };
    listen(track, 'pointerenter', () => getRect(true), { passive: true });
    listen(track, 'pointerdown', e => {
      if (e.button !== 0 || !durationMs()) return;
      e.preventDefault(); track.focus({ preventScroll: true });
      isDragging = true; closeIsland(true); track.setPointerCapture?.(e.pointerId);
      dragRatio = ratioAt(e, true); lastSeekAt = Date.now(); seek(dragRatio); scheduleSync();
    });
    listen(track, 'pointermove', e => {
      const ratio = ratioAt(e); hoverRatio = ratio;
      const duration = durationMs(), seconds = ratio * duration / 1000;
      const region = currentAnalysis?.regions?.find(s => seconds >= s.start && seconds < s.start + s.duration);
      const text = formatTime(ratio * duration) + (region ? ' · Trecho ' + region.index + ' · ' + region.description : '');
      if (tooltip.textContent !== text) tooltip.textContent = text;
      const x = Math.round(ratio * (mountedRefs?.width || 1));
      tooltip.style.left = x + 'px';
      tooltip.style.setProperty('--g4a-tip-shift', ratio < .2 ? '0%' : ratio > .8 ? '-100%' : '-50%');
      tooltip.classList.add('visible');
      if (isDragging) { dragRatio = ratio; if (Date.now() - lastSeekAt >= 140) { lastSeekAt = Date.now(); seek(ratio); } }
      scheduleSync();
    }, { passive: true });
    const stopScrub = e => {
      if (isDragging) seek(dragRatio);
      isDragging = false; hoverRatio = null;
      if (track.hasPointerCapture?.(e.pointerId)) track.releasePointerCapture(e.pointerId);
      tooltip.classList.remove('visible'); scheduleSync();
    };
    listen(track, 'pointerup', stopScrub);
    listen(track, 'pointercancel', stopScrub);
    listen(track, 'lostpointercapture', () => { isDragging = false; hoverRatio = null; tooltip.classList.remove('visible'); scheduleSync(); });
    listen(track, 'pointerleave', () => { if (!isDragging) { hoverRatio = null; tooltip.classList.remove('visible'); scheduleSync(); } }, { passive: true });
    listen(track, 'keydown', e => {
      const duration = durationMs(); if (!duration) return;
      let position = typeof Spicetify !== 'undefined' ? Spicetify.Player?.getProgress?.() || 0 : 0;
      if (e.key === 'Home') position = 0;
      else if (e.key === 'End') position = duration;
      else if (['ArrowLeft', 'ArrowDown'].includes(e.key)) position -= e.shiftKey ? 10000 : 5000;
      else if (['ArrowRight', 'ArrowUp'].includes(e.key)) position += e.shiftKey ? 10000 : 5000;
      else return;
      e.preventDefault(); e.stopPropagation(); seek(position / duration); scheduleSync();
    });
    listen(window, 'resize', () => { cachedRect = null; }, { passive: true });
    const rect = track.getBoundingClientRect();
    mountedRefs = { playbackBar, centerContainer, islandHost, controlsEl, sensor, timeEl, timeCurrentSpan, timeTotalSpan, bpmEl, keyEl,
      track, canvas, ctx: canvas.getContext('2d'), tooltip, status, width: Math.floor(rect.width), height: Math.floor(rect.height),
      lastCurrentTime: '0:00', lastTotalTime: ' / 0:00', lastBpmText: '-- bpm', lastKeyText: '--',
      lastRenderKey: '', lastBarsRef: null, lastRegionsRef: null, closeIsland };
    if (typeof ResizeObserver === 'function') {
      resizeObs = new ResizeObserver(entries => {
        const cr = entries[entries.length - 1]?.contentRect;
        if (!mountedRefs || !cr) return;
        const width = Math.floor(cr.width), height = Math.floor(cr.height);
        if (width !== mountedRefs.width || height !== mountedRefs.height) {
          mountedRefs.width = width; mountedRefs.height = height; cachedRect = null; scheduleSync();
        }
      });
      resizeObs.observe(track);
    }
  }

  function syncPlayer() {
    animFrame = null;
    if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; }
    if (!enabled || !active) return;
    if (document.hidden) return;

    let playbackBar = mountedRefs?.playbackBar?.isConnected ? mountedRefs.playbackBar : null;
    let centerContainer = mountedRefs?.centerContainer?.isConnected ? mountedRefs.centerContainer : null;
    if (!playbackBar || !centerContainer) {
      playbackBar = document.querySelector('.main-nowPlayingBar-center .playback-bar, [data-testid="now-playing-bar"] .playback-bar, .playback-bar');
      centerContainer = playbackBar?.closest('.main-nowPlayingBar-center') || playbackBar?.parentElement;
    }
    if (!playbackBar || !centerContainer) {
      releaseMount();
      document.documentElement.removeAttribute('data-g4a-player-waveform');
      pollTimer = setTimeout(scheduleSync, 1000);
      return;
    }
    if (document.documentElement.getAttribute('data-g4a-player-waveform') !== 'true') document.documentElement.setAttribute('data-g4a-player-waveform', 'true');
    injectWaveformUI(playbackBar, centerContainer);
    const player = typeof Spicetify !== 'undefined' ? Spicetify.Player : null;
    const isPlaying = Boolean(player?.isPlaying?.());
    const trackUri = player?.data?.item?.uri || '';
    const durMs = player?.getDuration?.() || 0, progressMs = player?.getProgress?.() || 0;
    if (trackUri !== currentTrackUri) {
      currentTrackUri = trackUri;
      isDragging = false; hoverRatio = null;
      mountedRefs.tooltip.classList.remove('visible');
      currentAnalysis = { trackUri, duration: durMs, tempo: null, keyLabel: '--', bars: EMPTY_BARS, available: false,
        loading: /^spotify:track:[a-zA-Z0-9]+$/.test(trackUri) };
      const revision = analysisRevision;
      fetchAudioAnalysis(trackUri).then(result => {
        if (!active || revision !== analysisRevision || trackUri !== currentTrackUri) return;
        currentAnalysis = result || { ...currentAnalysis, loading: false };
        scheduleSync();
      });
    }
    const ratio = isDragging ? dragRatio : durMs > 0 ? clamp(progressMs / durMs) : 0;
    const refs = mountedRefs;
    if (refs) {
      const currentTime = formatTime(isDragging ? dragRatio * durMs : progressMs), totalTime = ' / ' + formatTime(durMs);
      if (refs.lastCurrentTime !== currentTime) { refs.lastCurrentTime = currentTime; refs.timeCurrentSpan.textContent = currentTime; }
      if (refs.lastTotalTime !== totalTime) { refs.lastTotalTime = totalTime; refs.timeTotalSpan.textContent = totalTime; }
      const bpm = currentAnalysis?.tempo ? Math.round(currentAnalysis.tempo) + ' bpm' : '-- bpm', key = currentAnalysis?.keyLabel || '--';
      if (refs.lastBpmText !== bpm) { refs.lastBpmText = bpm; refs.bpmEl.textContent = bpm; }
      if (refs.lastKeyText !== key) { refs.lastKeyText = key; refs.keyEl.textContent = key; }
      const status = currentAnalysis?.available ? '' : currentAnalysis?.loading ? 'Carregando análise…' : 'Análise indisponível';
      if (refs.status.textContent !== status) refs.status.textContent = status;
      const aria = currentTime + ' de ' + formatTime(durMs);
      if (refs.track.getAttribute('aria-valuetext') !== aria) {
        refs.track.setAttribute('aria-valuetext', aria); refs.track.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      }
      const w = refs.width, h = refs.height, dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const bars = currentAnalysis?.bars || EMPTY_BARS;
      const renderKey = w + '|' + h + '|' + dpr + '|' + Math.round(ratio * w) + '|' + (hoverRatio == null ? -1 : Math.round(hoverRatio * w));
      if (w > 0 && h > 0 && refs.ctx && (refs.lastRenderKey !== renderKey || refs.lastBarsRef !== bars || refs.lastRegionsRef !== currentAnalysis?.regions)) {
        refs.lastRenderKey = renderKey; refs.lastBarsRef = bars; refs.lastRegionsRef = currentAnalysis?.regions;
        if (refs.canvas.width !== Math.round(w * dpr) || refs.canvas.height !== Math.round(h * dpr)) {
          refs.canvas.width = Math.round(w * dpr); refs.canvas.height = Math.round(h * dpr);
        }
        refs.ctx.save(); refs.ctx.scale(dpr, dpr);
        renderWaveform(refs.ctx, w, h, bars, ratio, hoverRatio, currentAnalysis || { available: false });
        refs.ctx.restore();
      }
    }
    // Pixel-paced progress instead of an unconditional 60 FPS loop on hover.
    // Paused watchdog also recovers a replaced Spotify player and external seeks.
    const interval = isPlaying ? clamp(durMs / Math.max(1, refs?.width || 480) / 2, 120, 750) : 1000;
    pollTimer = setTimeout(scheduleSync, interval);
  }

  const onPlayerEvent = () => scheduleSync();
  const onVisibility = () => {
    if (document.hidden) {
      if (animFrame !== null) cancelAnimationFrame(animFrame);
      if (pollTimer !== null) clearTimeout(pollTimer);
      animFrame = null; pollTimer = null;
      isDragging = false; hoverRatio = null;
      mountedRefs?.tooltip.classList.remove('visible');
      mountedRefs?.closeIsland(true);
    } else scheduleSync();
  };

  function start() {
    if (!enabled || active || typeof window === 'undefined' || typeof document === 'undefined') return;
    active = true;
    document.addEventListener('visibilitychange', onVisibility);
    if (typeof Spicetify !== 'undefined' && Spicetify.Player?.addEventListener) {
      Spicetify.Player.addEventListener('songchange', onPlayerEvent);
      Spicetify.Player.addEventListener('onplaypause', onPlayerEvent);
    }
    scheduleSync();
  }

  function teardown() {
    active = false;
    analysisRevision++;
    pendingAnalysis.clear();
    currentTrackUri = null; currentAnalysis = null;
    if (animFrame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(animFrame);
    if (pollTimer !== null) clearTimeout(pollTimer);
    animFrame = null; pollTimer = null;
    releaseMount();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
      document.documentElement.removeAttribute('data-g4a-player-waveform');
    }
    if (typeof Spicetify !== 'undefined' && Spicetify.Player?.removeEventListener) {
      Spicetify.Player.removeEventListener('songchange', onPlayerEvent);
      Spicetify.Player.removeEventListener('onplaypause', onPlayerEvent);
    }
  }

  function setEnabled(val) {
    enabled = !!val;
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch { /* Storage fallback */ }
    if (enabled) {
      start();
    } else {
      teardown();
    }
  }

  function init() {
    if (enabled) start();
  }

  return {
    init,
    start,
    teardown,
    setEnabled,
    get enabled() { return enabled; },
    formatMusicalKey,
    formatCamelot,
    formatBpm,
    formatTime,
    buildWaveformEnvelope,
    summarizeSections,
    generateWaveformBars,
    generateProceduralBars,
    parseAudioAnalysis,
    fetchAudioAnalysis,
    renderWaveform
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { Genre4allPlayerWaveform };
