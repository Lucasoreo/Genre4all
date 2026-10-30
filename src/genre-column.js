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
if (typeof module !== 'undefined' && module.exports) module.exports = Genre4allColumn;
