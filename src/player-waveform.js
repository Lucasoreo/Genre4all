/* Genre4all Beatport-style Player Waveform with Apple-style Dynamic Island controls */
const Genre4allPlayerWaveform = (() => {
  'use strict';

  const STORAGE_KEY = 'genre4all-player-waveform-v1';
  const PITCH_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const CAMELOT_MAJOR = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
  const CAMELOT_MINOR = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];

  const analysisCache = new Map();
  let enabled = false;
  let active = false;
  let mountedElement = null;
  let animFrame = null;
  let currentTrackUri = null;
  let currentAnalysis = null;
  let isDragging = false;
  let dragRatio = 0;
  let hoverRatio = null;

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

    const bpm = 126;
    const beatIntervalSec = 60 / bpm;
    const dt = (durSec || 180) / barCount;

    for (let i = 0; i < barCount; i++) {
      const progress = i / barCount;
      const t = i * dt;

      let energy = 0.3;
      if (progress < 0.15) {
        energy = 0.25 + progress * 1.6;
      } else if (progress < 0.30) {
        energy = 0.45 + (progress - 0.15) * 2.3;
      } else if (progress < 0.55) {
        energy = 0.85 + Math.sin((progress - 0.30) * 12) * 0.08;
      } else if (progress < 0.70) {
        energy = 0.22 + Math.sin((progress - 0.55) * 8) * 0.08;
      } else if (progress < 0.82) {
        energy = 0.45 + (progress - 0.70) * 3.8;
      } else {
        energy = 0.88 - (progress - 0.82) * 2.4;
      }

      const beatPhase = (t % beatIntervalSec) / beatIntervalSec;
      const isKick = beatPhase < 0.22;
      const kickBoost = isKick ? 0.32 : -0.06;

      const noise = (Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453) % 1;
      const amp = energy * (0.75 + Math.abs(noise) * 0.25) + (energy > 0.4 ? kickBoost : 0);
      bars[i] = Math.max(0.08, Math.min(1.0, amp));
    }

    return bars;
  }

  function generateWaveformBars(durationMs, segments, beats, sections, barCount = 180) {
    if (barCount <= 0) barCount = 180;
    const bars = new Float32Array(barCount);
    const durSec = (durationMs || 180000) / 1000;
    if (durSec <= 0) return bars;

    const dt = durSec / barCount;
    if (!segments || segments.length === 0) {
      return generateProceduralBars(durSec, barCount);
    }

    let segIdx = 0;
    let beatIdx = 0;

    for (let i = 0; i < barCount; i++) {
      const t0 = i * dt;
      const t1 = (i + 1) * dt;
      const tMid = (t0 + t1) / 2;

      let maxLoudness = -60;
      while (segIdx < segments.length && segments[segIdx].start + segments[segIdx].duration < t0) {
        segIdx++;
      }
      let s = segIdx;
      while (s < segments.length && segments[s].start <= t1) {
        const seg = segments[s];
        if (seg.loudness_max > maxLoudness) maxLoudness = seg.loudness_max;
        s++;
      }

      if (maxLoudness === -60 && s > 0 && s < segments.length) {
        maxLoudness = segments[s - 1].loudness_max;
      }

      const norm = Math.max(0, Math.min(1, (maxLoudness + 45) / 45));
      let amp = 0.08 + Math.pow(norm, 1.3) * 0.72;

      while (beatIdx < beats.length && beats[beatIdx].start < t0 - 0.05) {
        beatIdx++;
      }
      let hasBeat = false;
      let b = beatIdx;
      while (b < beats.length && beats[b].start <= t1 + 0.05) {
        const dist = Math.abs(beats[b].start - tMid);
        if (dist <= dt * 0.65) {
          hasBeat = true;
          break;
        }
        b++;
      }

      if (hasBeat) {
        amp = Math.min(1.0, amp * 1.28 + 0.08);
      }

      bars[i] = Math.max(0.06, Math.min(1.0, amp));
    }

    return bars;
  }

  function parseAudioAnalysis(raw, trackUri) {
    const duration = (raw.track?.duration || 0) * 1000;
    const tempo = raw.track?.tempo ? Math.round(raw.track.tempo) : null;
    const key = raw.track?.key ?? null;
    const mode = raw.track?.mode ?? null;
    const keyLabel = formatMusicalKey(key, mode);

    const segments = Array.isArray(raw.segments) ? raw.segments : [];
    const beats = Array.isArray(raw.beats) ? raw.beats : [];
    const sections = Array.isArray(raw.sections) ? raw.sections : [];

    return {
      trackUri,
      duration,
      tempo,
      key,
      mode,
      keyLabel,
      segments,
      beats,
      sections,
      bars: generateWaveformBars(duration, segments, beats, sections, 180)
    };
  }

  async function fetchAudioAnalysis(trackUri) {
    if (!trackUri) return null;
    const cached = analysisCache.get(trackUri);
    if (cached) return cached;

    const id = trackUri.replace(/^spotify:track:/, '');
    let raw = null;

    if (typeof Spicetify !== 'undefined' && typeof Spicetify.getAudioData === 'function') {
      try {
        raw = await Spicetify.getAudioData(trackUri);
      } catch { /* Fallback to CosmosAsync */ }
    }

    if (!raw && typeof Spicetify !== 'undefined' && Spicetify.CosmosAsync?.get) {
      try {
        raw = await Spicetify.CosmosAsync.get(`https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/${id}?format=json`);
      } catch { /* Offline / unavailable */ }
    }

    if (raw && raw.track) {
      const parsed = parseAudioAnalysis(raw, trackUri);
      analysisCache.set(trackUri, parsed);
      return parsed;
    }

    return null;
  }

  function renderWaveform(ctx, width, height, bars, progressRatio, hoverRatioVal) {
    ctx.clearRect(0, 0, width, height);
    if (!bars || bars.length === 0) return;

    const barWidth = 2.4;
    const barGap = 1.6;
    const step = barWidth + barGap;
    const count = Math.max(40, Math.floor(width / step));
    const centerY = height / 2;
    const maxAmp = (height / 2) - 3;

    for (let i = 0; i < count; i++) {
      const x = i * step + (step - barWidth) / 2;
      const sampleIdx = Math.floor((i / count) * bars.length);
      const amp = bars[sampleIdx] || 0.1;
      const barH = Math.max(2.5, amp * maxAmp);

      const isPlayed = (x / width) <= progressRatio;
      ctx.fillStyle = isPlayed ? 'rgba(255, 255, 255, 0.96)' : 'rgba(255, 255, 255, 0.26)';

      const top = centerY - barH;
      const totalH = barH * 1.85;
      const radius = barWidth / 2;

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, top, barWidth, totalH, radius);
      } else {
        ctx.rect(x, top, barWidth, totalH);
      }
      ctx.fill();
    }

    // Playhead line and glowing caps
    const playheadX = Math.round(progressRatio * width);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playheadX, 2);
    ctx.lineTo(playheadX, height - 2);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(playheadX, 3, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(playheadX, height - 3, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Hover scrubber indicator
    if (hoverRatioVal != null && hoverRatioVal >= 0 && hoverRatioVal <= 1) {
      const hoverX = Math.round(hoverRatioVal * width);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function injectWaveformUI(playbackBar) {
    if (!playbackBar || playbackBar.querySelector('.g4a-waveform-player')) return;

    const root = document.createElement('div');
    root.className = 'g4a-waveform-player';

    const meta = document.createElement('div');
    meta.className = 'g4a-waveform-meta';

    const timeEl = document.createElement('div');
    timeEl.className = 'g4a-meta-time';
    timeEl.title = 'Tempo decorrido / Duração total';
    timeEl.textContent = '0:00 / 0:00';

    const bpmEl = document.createElement('div');
    bpmEl.className = 'g4a-meta-bpm';
    bpmEl.title = 'Batidas por minuto (Tempo)';
    bpmEl.textContent = '-- BPM';

    const keyEl = document.createElement('div');
    keyEl.className = 'g4a-meta-key';
    keyEl.title = 'Tom musical';
    keyEl.textContent = '--';

    meta.append(timeEl, bpmEl, keyEl);

    const track = document.createElement('div');
    track.className = 'g4a-waveform-track';

    const canvas = document.createElement('canvas');
    canvas.className = 'g4a-waveform-canvas';

    const tooltip = document.createElement('div');
    tooltip.className = 'g4a-waveform-tooltip';

    track.append(canvas, tooltip);
    root.append(meta, track);

    // Event listeners for seek & scrub interaction
    const updateScrub = e => {
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return ratio;
    };

    track.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      isDragging = true;
      track.setPointerCapture?.(e.pointerId);
      dragRatio = updateScrub(e);
      if (typeof Spicetify !== 'undefined' && Spicetify.Player?.seek) {
        Spicetify.Player.seek(dragRatio);
      }
    });

    track.addEventListener('pointermove', e => {
      const ratio = updateScrub(e);
      hoverRatio = ratio;

      const dur = currentAnalysis?.duration || (typeof Spicetify !== 'undefined' ? Spicetify.Player?.getDuration() : 0) || 180000;
      const hoverMs = Math.round(ratio * dur);
      tooltip.textContent = formatTime(hoverMs);
      tooltip.style.left = `${Math.round(ratio * 100)}%`;
      tooltip.classList.add('visible');

      if (isDragging) {
        dragRatio = ratio;
        if (typeof Spicetify !== 'undefined' && Spicetify.Player?.seek) {
          Spicetify.Player.seek(ratio);
        }
      }
    });

    const stopScrub = () => {
      isDragging = false;
      hoverRatio = null;
      tooltip.classList.remove('visible');
    };

    track.addEventListener('pointerup', stopScrub);
    track.addEventListener('pointercancel', stopScrub);
    track.addEventListener('pointerleave', () => {
      if (!isDragging) {
        hoverRatio = null;
        tooltip.classList.remove('visible');
      }
    });

    playbackBar.append(root);
    mountedElement = root;
  }

  function syncPlayer() {
    if (!enabled) {
      teardown();
      return;
    }

    const playbackBar = document.querySelector('.main-nowPlayingBar-center .playback-bar, .playback-bar');
    const centerContainer = document.querySelector('.main-nowPlayingBar-center');

    if (!playbackBar || !centerContainer) {
      if (active) animFrame = requestAnimationFrame(syncPlayer);
      return;
    }

    document.documentElement.setAttribute('data-g4a-player-waveform', 'true');
    injectWaveformUI(playbackBar);

    // Keep dynamic island pinned if music is paused
    const isPlaying = typeof Spicetify !== 'undefined' ? Spicetify.Player?.isPlaying?.() : false;
    centerContainer.classList.toggle('g4a-island-pinned', !isPlaying || isDragging);

    const trackUri = typeof Spicetify !== 'undefined' ? (Spicetify.Player?.data?.item?.uri || '') : '';
    const durMs = typeof Spicetify !== 'undefined' ? (Spicetify.Player?.getDuration?.() || 0) : 0;
    const progressMs = typeof Spicetify !== 'undefined' ? (Spicetify.Player?.getProgress?.() || 0) : 0;
    const progressRatio = isDragging ? dragRatio : (durMs > 0 ? Math.max(0, Math.min(1, progressMs / durMs)) : 0);

    // Update track metadata on song change
    if (trackUri && trackUri !== currentTrackUri) {
      currentTrackUri = trackUri;
      currentAnalysis = {
        trackUri,
        duration: durMs,
        tempo: null,
        keyLabel: '--',
        bars: generateProceduralBars(durMs / 1000, 180, trackUri)
      };

      fetchAudioAnalysis(trackUri).then(res => {
        if (res && res.trackUri === currentTrackUri) {
          currentAnalysis = res;
        }
      });
    }

    // Update metadata DOM labels
    if (mountedElement) {
      const timeEl = mountedElement.querySelector('.g4a-meta-time');
      const bpmEl = mountedElement.querySelector('.g4a-meta-bpm');
      const keyEl = mountedElement.querySelector('.g4a-meta-key');

      if (timeEl) timeEl.textContent = `${formatTime(progressMs)} / ${formatTime(durMs)}`;
      if (bpmEl) bpmEl.textContent = currentAnalysis?.tempo ? formatBpm(currentAnalysis.tempo) : '-- BPM';
      if (keyEl) keyEl.textContent = currentAnalysis?.keyLabel || '--';

      // Canvas render
      const canvas = mountedElement.querySelector('.g4a-waveform-canvas');
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);

        if (w > 0 && h > 0) {
          if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
          }
          const ctx = canvas.getContext('2d');
          ctx.save();
          ctx.scale(dpr, dpr);
          const bars = currentAnalysis?.bars || generateProceduralBars(durMs / 1000, 180, trackUri || 'default');
          renderWaveform(ctx, w, h, bars, progressRatio, hoverRatio);
          ctx.restore();
        }
      }
    }

    if (active) animFrame = requestAnimationFrame(syncPlayer);
  }

  function start() {
    if (active || typeof window === 'undefined' || typeof document === 'undefined') return;
    active = true;
    animFrame = requestAnimationFrame(syncPlayer);

    if (typeof Spicetify !== 'undefined' && Spicetify.Player?.addEventListener) {
      Spicetify.Player.addEventListener('songchange', syncPlayer);
      Spicetify.Player.addEventListener('onplaypause', syncPlayer);
    }
  }

  function teardown() {
    active = false;
    if (animFrame && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    if (typeof document !== 'undefined') {
      document.documentElement.removeAttribute('data-g4a-player-waveform');
      if (mountedElement) {
        mountedElement.remove();
        mountedElement = null;
      }
      const center = document.querySelector('.main-nowPlayingBar-center');
      if (center) center.classList.remove('g4a-island-pinned');
    }

    if (typeof Spicetify !== 'undefined' && Spicetify.Player?.removeEventListener) {
      Spicetify.Player.removeEventListener('songchange', syncPlayer);
      Spicetify.Player.removeEventListener('onplaypause', syncPlayer);
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
    generateWaveformBars,
    generateProceduralBars,
    parseAudioAnalysis,
    fetchAudioAnalysis,
    renderWaveform
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { Genre4allPlayerWaveform };
