/* Standalone Spicetify integration. No Sort Play globals, buttons or settings are used. */
async function startGenre4all() {
  'use strict';
  const KEY = 'genre4all-visible-v1';
  const ORDER_KEY = 'genre4all-order-offset-v1';
  const COLUMNS_KEY = 'genre4all-column-order-v1';
  const ROW = '.main-trackList-trackListHeaderRow,.main-trackList-trackListRow,[role="row"]';
  const ROOT = '.main-trackList-trackList,[data-testid="tracklist"],[role="grid"]';
  const CELL = '[role="columnheader"],[role="gridcell"],[class*="main-trackList-rowSection"]';
  const CONFIG_ICON = '<svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2v9.5a2.5 2.5 0 1 1-1.5-2.3V4.3L6 5.9v7.6a2.5 2.5 0 1 1-1.5-2.3V2.7L14 1v1zm-9.5 9.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm8-2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>';
  const lifecycle = new AbortController(), roots = new Map(), layouts = new Map(), rowCache = new WeakMap();
  let closed = false, frame = null, preferences = null, view = null, service = null, profileMenuItem = null;
  let visible = true, orderOffset = 0, columnOrder = [], metadataClient = null, metadataTransport = null, MetadataServiceClass = null, lastDiscovery = 0, unlisten = null;
  try {
    visible = localStorage.getItem(KEY) !== 'false';
    orderOffset = Math.max(0, parseInt(localStorage.getItem(ORDER_KEY) || '0', 10) || 0);
    const savedColumns = JSON.parse(localStorage.getItem(COLUMNS_KEY) || '[]');
    if (Array.isArray(savedColumns)) columnOrder = savedColumns.filter(k => typeof k === 'string' && k);
  } catch { /* Session preference still works. */ }
  const context = () => globalThis.Spicetify?.Platform?.History?.location?.pathname || location.pathname;
  const api = {
    version: '1.13.0',
    get visible() { return visible; },
    get orderOffset() { return orderOffset; },
    get columnOrder() { return [...columnOrder]; },
    get playerWaveform() { return typeof Genre4allPlayerWaveform !== 'undefined' ? Genre4allPlayerWaveform.enabled : false; },
    setVisible,
    setOrderOffset,
    setColumnOrder,
    setPlayerWaveform: val => { if (typeof Genre4allPlayerWaveform !== 'undefined') Genre4allPlayerWaveform.setEnabled(val); },
    openConfig: showPreferences,
    sync: schedule,
    close,
    diagnostics: () => ({ version: api.version, visible, orderOffset, columnOrder: [...columnOrder], playerWaveform: api.playerWaveform, context: context(), roots: roots.size, rows: layouts.size, service: service?.stats(), view: view?.stats(), metadataAvailable: !!metadataClient })
  };
  // One instance even if Marketplace and a manual installation both load the file.
  globalThis.Genre4all?.close?.();
  globalThis.Genre4all = api;

  if (!customElements.get('genre4all-column')) {
    customElements.define('genre4all-column', class extends HTMLElement {
      constructor() { super(); this.semantics = this.attachInternals?.(); }
      connectedCallback() {
        if (this.semantics) {
          this.semantics.role = this.dataset.kind === 'header' ? 'columnheader' : 'gridcell';
          this.semantics.ariaLabel = 'Gênero';
        }
      }
    });
  }
  const style = document.createElement('style');
  style.id = 'genre4all-runtime-style';
  style.textContent = `
    /* Role lives in ElementInternals: other extensions' [role=gridcell] scans ignore our shell. */
    .g4a-root :is(.g4a-row,[data-g4a-row],:has(> genre4all-column)):not([data-g4a-measure]) { grid-template-columns:var(--g4a-tracks) !important; min-width:var(--g4a-total) !important; }
    .g4a-root :is(.g4a-row,[data-g4a-row],:has(> genre4all-column)):not([data-g4a-measure]) > :not([aria-colspan]):not([class*="FullWidthCell"]):not([class*="trackListRowFullWidthCell"]):not(.PoSfoROJK6lwVe6ZtR0U) { grid-column:auto !important; grid-row:1 !important; min-width:0; }
    .g4a-root :is(.g4a-row,[data-g4a-row],:has(> genre4all-column)):not([data-g4a-measure]) > [data-g4a-position] { grid-column:var(--g4a-position,auto) !important; grid-row:1 !important; min-width:0; }
    .g4a-root :is(.g4a-row,[data-g4a-row],:has(> genre4all-column)):not([data-g4a-measure]) > :is([aria-colspan],[class*="FullWidthCell"],[class*="trackListRowFullWidthCell"],.PoSfoROJK6lwVe6ZtR0U) { grid-column:1 / -1 !important; grid-row:auto !important; width:100% !important; min-width:0 !important; }
    .g4a-root :is(.main-trackList-trackListHeader,.rrn0EjHTu7eCxn9G0Rrc,[class*="trackListHeader"]):is(.main-trackList-trackListHeaderStuck,.iPo4a2lbrsxW9Iedav3h,[class*="trackListHeaderStuck"]) { background-color:var(--spice-main,var(--background-base,#121212)) !important; }
    genre4all-column { display:flex; align-items:center; min-width:0; overflow:hidden; box-sizing:border-box; }
    genre4all-column[data-kind=data] { overflow:visible; }
    genre4all-column[data-kind=header] { position:relative; justify-content:flex-start; justify-self:stretch; width:100%; height:100%; color:var(--text-subdued,var(--spice-subtext,#b3b3b3)); font-size:0.875rem; font-weight:400; line-height:normal; cursor:grab; user-select:none; }
    .g4a-root:not([data-sp-native-layout]) [role="columnheader"][data-g4a-col-key] { cursor:grab; user-select:none; }
    genre4all-column[data-kind=header].g4a-header-dragging,[role="columnheader"].g4a-header-dragging { cursor:grabbing !important; opacity:.75; z-index:3; }
    genre4all-column .g4a-genre-host { width:100%; }
    .g4a-header-label { min-width:0; margin-inline-end:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    [data-g4a-prev-sep] { display:flex; align-items:center; }
    .g4a-header-sep { cursor:col-resize; flex:0 0 8px; width:8px; height:50%; margin-inline-start:auto; user-select:none; touch-action:none; }
    .g4a-row:hover .g4a-header-sep,.g4a-row:focus-within .g4a-header-sep,html.g4a-resizing .g4a-header-sep { background:linear-gradient(rgba(var(--spice-rgb-text,255,255,255),.302),rgba(var(--spice-rgb-text,255,255,255),.302)) 50%/1px 100% no-repeat; }
    html.g4a-resizing,html.g4a-resizing * { cursor:col-resize !important; user-select:none !important; }
    html.g4a-reordering,html.g4a-reordering * { cursor:grabbing !important; user-select:none !important; }
    [data-g4a-measure] > genre4all-column,[data-g4a-measure] [data-g4a-sep] { display:none !important; }
    .g4a-root[data-g4a-overflow].g4a-root { overflow-x:auto !important; }
    .g4a-root[data-g4a-overflow] > div:has([role="columnheader"]),.g4a-root[data-sp-native-layout] > div:has([role="columnheader"]) { margin-inline:0 !important; padding-inline:0 !important; }
    .g4a-root[data-sp-native-layout] [data-sp-layout-position="native:end"] > .sp-layout-resize { display:none !important; }
    .g4a-root[data-sp-native-layout] .sp-layout-resize::after { top:25% !important; bottom:25% !important; left:5.5px !important; width:1px !important; border-radius:0 !important; background:rgba(var(--spice-rgb-text,255,255,255),.302) !important; opacity:0 !important; }
    .g4a-root[data-sp-native-layout] .g4a-row:hover .sp-layout-resize::after,.g4a-root[data-sp-native-layout] .g4a-row:focus-within .sp-layout-resize::after,.g4a-root[data-sp-native-layout] .sp-layout-resize:hover::after,.g4a-root[data-sp-native-layout] .sp-layout-resize:focus-visible::after { opacity:1 !important; }
    .g4a-root[data-sp-native-layout] .sort-play-column-header { justify-content:flex-start !important; text-align:left !important; font-size:0.875rem !important; font-weight:400 !important; }
    .g4a-menu-button,.g4a-profile-button { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; min-height:40px; padding:12px 16px; border:0; border-radius:2px; color:var(--text-base,#eee); background:transparent; text-align:left; font:inherit; cursor:pointer; }
    .g4a-profile-button { justify-content:flex-start; }
    .g4a-menu-button:hover,.g4a-menu-button:focus-visible,.g4a-profile-button:hover,.g4a-profile-button:focus-visible { background:#ffffff1a; outline-offset:-2px; }
    .g4a-menu-button[aria-checked=true] { color:var(--text-positive,#1ed760); }
    .g4a-menu-button svg,.g4a-profile-button svg { width:16px; height:16px; flex:none; fill:currentColor; }
    .g4a-preferences { position:fixed; inset:0; margin:auto; padding:24px; max-width:460px; width:calc(100vw - 40px); max-height:calc(100vh - 40px); overflow-y:auto; box-sizing:border-box; border:1px solid #555; border-radius:10px; color:var(--spice-text,#fff); background:var(--spice-main,#181818); font:14px/1.45 sans-serif; box-shadow:0 20px 50px rgba(0,0,0,.65); }
    .g4a-preferences::backdrop { background:#000a; }
    .g4a-preferences h2 { margin:0 0 14px; font:700 18px/1.3 sans-serif; display:flex; align-items:center; justify-content:space-between; }
    .g4a-preferences h3 { margin:16px 0 8px; font:600 12px/1.2 sans-serif; text-transform:uppercase; letter-spacing:.06em; color:var(--spice-subtext,#b3b3b3); }
    .g4a-preferences label { display:flex; gap:10px; margin:10px 0; align-items:center; cursor:pointer; }
    .g4a-preferences input[type="checkbox"] { accent-color:#1ed760; }
    .g4a-preferences-field { display:flex; flex-direction:column; gap:5px; margin:10px 0 14px; }
    .g4a-preferences-field span { font-size:12px; color:var(--spice-subtext,#ccc); }
    .g4a-preferences-input { width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #555; border-radius:5px; background:#121212; color:var(--spice-text,#fff); font:13px/1.3 monospace,sans-serif; }
    .g4a-preferences-input:focus { border-color:#1ed760; outline:none; }
    .g4a-preferences-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:18px; justify-content:flex-end; }
    .g4a-preferences button { padding:8px 14px; color:inherit; background:transparent; border:1px solid #aaa; border-radius:4px; cursor:pointer; font:inherit; }
    .g4a-preferences button:hover { background:#ffffff14; }

    /* Player Waveform & Apple-style Dynamic Island */
    .g4a-waveform-player { display:flex; align-items:center; gap:12px; width:100%; height:46px; position:relative; user-select:none; box-sizing:border-box; }
    .g4a-waveform-meta { display:flex; flex-direction:column; justify-content:center; width:86px; min-width:86px; flex-shrink:0; font-family:var(--font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif); line-height:1.35; text-align:left; user-select:none; }
    .g4a-meta-time { font-size:11px; font-weight:700; color:var(--spice-text,#ffffff); font-variant-numeric:tabular-nums; letter-spacing:-0.01em; }
    .g4a-meta-bpm { font-size:11px; font-weight:500; color:var(--spice-subtext,rgba(255,255,255,0.72)); white-space:nowrap; }
    .g4a-meta-key { font-size:11px; font-weight:500; color:var(--spice-subtext,rgba(255,255,255,0.72)); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .g4a-waveform-track { position:relative; flex:1; height:42px; min-width:120px; cursor:pointer; display:flex; align-items:center; }
    .g4a-waveform-canvas { width:100%; height:100%; display:block; }
    .g4a-waveform-tooltip { position:absolute; top:-26px; transform:translateX(-50%); background:rgba(18,18,18,0.92); color:#fff; padding:2px 7px; border-radius:4px; font-size:10.5px; font-weight:600; pointer-events:none; white-space:nowrap; box-shadow:0 4px 12px rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.15); font-variant-numeric:tabular-nums; opacity:0; transition:opacity 0.15s ease; z-index:100; }
    .g4a-waveform-tooltip.visible { opacity:1; }
    .g4a-badge-experimental { font-size:10px; font-weight:700; padding:2px 6px; border-radius:10px; background:#e91429; color:#fff; letter-spacing:0.04em; }

    [data-g4a-player-waveform="true"] .playback-bar > :is([data-testid="playback-position"],[data-testid="playback-duration"],.EwWvIxEwsX4OCTm8USco) { display:none !important; }
    [data-g4a-player-waveform="true"] .playback-bar :is([data-testid="progress-bar"],.progress-bar,.x-progressBar-progressBar) { display:none !important; }
    [data-g4a-player-waveform="true"] .main-nowPlayingBar-center { position:relative !important; display:flex !important; flex-direction:column !important; justify-content:center !important; overflow:visible !important; }
    [data-g4a-player-waveform="true"] .player-controls { position:absolute !important; left:50% !important; bottom:calc(100% + 8px) !important; transform:translateX(-50%) translateY(8px) scale(0.92) !important; opacity:0 !important; pointer-events:none !important; background:rgba(22,22,24,0.88) !important; backdrop-filter:blur(24px) saturate(190%) !important; -webkit-backdrop-filter:blur(24px) saturate(190%) !important; border:1px solid rgba(255,255,255,0.14) !important; border-radius:9999px !important; padding:4px 14px !important; margin-bottom:0 !important; box-shadow:0 16px 36px rgba(0,0,0,0.65), 0 2px 10px rgba(0,0,0,0.4) !important; z-index:1000 !important; transition:transform 0.42s cubic-bezier(0.16,1,0.3,1), opacity 0.32s cubic-bezier(0.16,1,0.3,1), box-shadow 0.42s ease !important; }
    [data-g4a-player-waveform="true"] .main-nowPlayingBar-center:hover .player-controls, [data-g4a-player-waveform="true"] .main-nowPlayingBar-center:focus-within .player-controls, [data-g4a-player-waveform="true"] .main-nowPlayingBar-center.g4a-island-pinned .player-controls { opacity:1 !important; pointer-events:auto !important; transform:translateX(-50%) translateY(0) scale(1) !important; box-shadow:0 20px 45px rgba(0,0,0,0.75), 0 4px 14px rgba(0,0,0,0.5) !important; }
  `;
  document.head.append(style);

  const normalize = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  function node(tag, text, attrs = {}) {
    const n = document.createElement(tag); if (text != null) n.textContent = text;
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
    return n;
  }
  function ownProperty(n, name, value) {
    if (n.style.getPropertyValue(name) !== value) n.style.setProperty(name, value);
  }
  function schedule() { if (!closed && frame === null) frame = requestAnimationFrame(sync); }
  function invalidateLayouts(resetWeights = false, resetOrder = false) {
    for (const rootState of roots.values()) {
      rootState.measured = null;
      if (resetOrder) {
        rootState.midOrder = null;
        rootState.headerForeign = null;
        rootState.midOrderCount = -1;
      }
      if (resetWeights) rootState.weights = null;
    }
    for (const state of layouts.values()) state.appliedKey = null;
  }
  function clearRootStyles(root) {
    root.classList.remove('g4a-root');
    root.removeAttribute('data-g4a-overflow');
    root.style.removeProperty('--g4a-tracks');
    root.style.removeProperty('--g4a-total');
  }
  function setVisible(value) {
    visible = !!value;
    try { localStorage.setItem(KEY, String(visible)); } catch { /* Keep the current session usable. */ }
    if (!visible) {
      view?.reset();
      for (const row of [...layouts.keys()]) releaseRow(row);
      for (const root of roots.keys()) clearRootStyles(root);
    }
    invalidateLayouts(false, true);
    updateMenus(); schedule();
  }
  function setOrderOffset(value) {
    const next = Math.max(0, Math.floor(Number(value) || 0));
    orderOffset = next;
    try { localStorage.setItem(ORDER_KEY, String(orderOffset)); } catch { /* Keep the current session usable. */ }
    if (columnOrder.length) {
      const withoutGenre = columnOrder.filter(k => k !== '__genre__');
      const idx = Math.max(0, Math.min(withoutGenre.length, withoutGenre.length - orderOffset));
      withoutGenre.splice(idx, 0, '__genre__');
      columnOrder = withoutGenre;
      try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(columnOrder)); } catch { /* Keep session usable. */ }
    }
    invalidateLayouts(true, true);
    sync();
  }
  function setColumnOrder(order) {
    if (!Array.isArray(order)) return;
    columnOrder = [...new Set(order.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()))];
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(columnOrder)); } catch { /* Keep session usable. */ }
    const genreIdx = columnOrder.indexOf('__genre__');
    if (genreIdx >= 0) {
      orderOffset = Math.max(0, (columnOrder.length - 1) - genreIdx);
      try { localStorage.setItem(ORDER_KEY, String(orderOffset)); } catch { /* Keep session usable. */ }
    }
    invalidateLayouts(false, true);
    sync();
  }

  // Adapted from Sort-Play-2 getWebpackService/getMetadataClient; scoped to this extension.
  function resolveTransport() {
    const platform = globalThis.Spicetify?.Platform;
    return platform?.ProductStateAPI?.productStateApi?.transport || platform?.Transport || platform?.PlayerAPI?._queue?._client?._transport || null;
  }
  function getMetadataClient() {
    const currentTransport = resolveTransport();
    if (metadataClient && (!currentTransport || metadataTransport === currentTransport)) return metadataClient;
    if (MetadataServiceClass && currentTransport) {
      metadataTransport = currentTransport;
      metadataClient = new MetadataServiceClass(currentTransport);
      return metadataClient;
    }
    if (Date.now() - lastDiscovery < 5000) return null;
    lastDiscovery = Date.now();
    const chunk = window.rspackChunk ?? window.webpackChunkclient_web ?? window.rspackChunkclient_web;
    if (!chunk) return null;
    let req;
    try {
      const ret = chunk.push([[Symbol('genre4all')], {}, r => { req = r; return r; }]);
      if (!req && typeof ret === 'function') req = ret;
      if (!req?.m) return null;
      const allIds = Object.keys(req.m);
      const matchedIds = allIds.filter(id => {
        try {
          const src = String(req.m[id] || '');
          return src.includes('MetadataService') || src.includes('mdata_esperanto');
        } catch { return false; }
      });
      const scanIds = matchedIds.length ? matchedIds : (allIds.length <= 200 ? allIds : []);
      for (const id of scanIds) {
        let exports; try { exports = req(id); } catch { continue; }
        const candidates = [exports];
        if (exports && (typeof exports === 'object' || typeof exports === 'function')) {
          for (const key of Object.keys(exports)) { try { candidates.push(exports[key]); } catch { /* Lazy export. */ } }
        }
        const MetadataService = candidates.find(c => c?.SERVICE_ID === 'spotify.mdata_esperanto.proto.MetadataService');
        if (!MetadataService) continue;
        MetadataServiceClass = MetadataService;
        if (!currentTransport) return null;
        metadataTransport = currentTransport;
        metadataClient = new MetadataService(currentTransport);
        return metadataClient;
      }
    } catch (error) { console.warn('[Genre4all] MetadataService indisponível.', error); }
    return null;
  }

  const validUri = uri => typeof uri === 'string' && /^spotify:(track|local):/.test(uri);
  const URI_SEARCH_KEYS = ['item', 'track', 'data', 'value', 'content', 'node', 'spec', '_path', 'props', 'children'];
  const SKIP_HOST_TAGS = new Set(['svg', 'path', 'img', 'button', 'input']);
  function directUriFromProps(p) {
    if (!p || typeof p !== 'object') return null;
    const c = p.uri || p.item?.uri || p.track?.uri || p.data?.uri || p.value?.uri || p.children?.props?.item?.uri || p.children?.props?.track?.uri || p.children?.props?.uri;
    return validUri(c) ? c : null;
  }
  function computeUri(row, rowProps, firstProps, fiber, dataUri, fallbackHref) {
    for (const props of [rowProps, firstProps]) {
      const fast = directUriFromProps(props); if (fast) return fast;
    }
    const first = row.firstElementChild;
    const firstFiberKey = first ? (first.__g4aFiberKey ?? (first.__g4aFiberKey = Object.keys(first).find(k => k.startsWith('__reactFiber$')) || '')) : '';
    const fibers = [fiber, firstFiberKey ? first[firstFiberKey] : null].filter(Boolean);
    for (const startFiber of fibers) {
      for (let f = startFiber, i = 0; f && i < 8; f = f.return, i++) {
        const fast = directUriFromProps(f.memoizedProps) || directUriFromProps(f.pendingProps);
        if (fast) return fast;
      }
    }
    function find(rootVal, maxDepth = 8) {
      if (!rootVal || typeof rootVal !== 'object') return null;
      const seen = new Set();
      function walk(value, depth) {
        if (!value || typeof value !== 'object' || depth <= 0 || seen.has(value) || seen.size > 140) return null;
        if (typeof value.type === 'string' && SKIP_HOST_TAGS.has(value.type)) return null;
        seen.add(value);
        if (validUri(value.uri)) return value.uri;
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const uri = walk(value[i], depth - 1); if (uri) return uri;
          }
          return null;
        }
        for (const key of URI_SEARCH_KEYS) if (key in value) {
          const uri = walk(value[key], depth - 1); if (uri) return uri;
        }
        return null;
      }
      return walk(rootVal, maxDepth);
    }
    // React identity wins over a stale DOM link in a recycled row.
    for (const props of [rowProps, firstProps]) {
      const uri = find(props); if (uri) return uri;
    }
    for (const startFiber of fibers) {
      for (let f = startFiber, i = 0; f && i < 8; f = f.return, i++) {
        const uri = find(f.pendingProps) || find(f.memoizedProps); if (uri) return uri;
      }
    }
    if (validUri(dataUri)) return dataUri;
    const href = fallbackHref || row.querySelector('a[href*="/track/"]')?.getAttribute('href');
    const id = href?.match(/\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/)?.[1];
    return id ? `spotify:track:${id}` : null;
  }
  function getRowMeta(row) {
    const propsKey = row.__g4aPropsKey ?? (row.__g4aPropsKey = Object.keys(row).find(k => k.startsWith('__reactProps$')) || '');
    const fiberKey = row.__g4aFiberKey ?? (row.__g4aFiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber$')) || '');
    const first = row.firstElementChild;
    const firstPropsKey = first ? (first.__g4aPropsKey ?? (first.__g4aPropsKey = Object.keys(first).find(k => k.startsWith('__reactProps$')) || '')) : '';
    const rowProps = propsKey ? row[propsKey] : null;
    const firstProps = first && firstPropsKey ? first[firstPropsKey] : null;
    const fiber = fiberKey ? row[fiberKey] : null;
    const fiberProps = fiber?.memoizedProps || fiber?.pendingProps || null;
    const rowIndex = row.getAttribute('aria-rowindex') || '';
    const dataUri = row.dataset.uri || '';
    const itemUri = rowProps?.item?.uri || rowProps?.children?.props?.item?.uri || firstProps?.item?.uri || fiberProps?.item?.uri || '';
    const href = !rowProps && !firstProps && !fiberProps && !dataUri ? (row.querySelector('a[href*="/track/"]')?.getAttribute('href') || '') : '';
    const cached = rowCache.get(row);
    if (cached && cached.rowProps === rowProps && cached.firstProps === firstProps && cached.fiberProps === fiberProps
      && cached.rowIndex === rowIndex && cached.dataUri === dataUri && cached.itemUri === itemUri && cached.href === href) {
      return cached;
    }
    const resolvedUri = validUri(itemUri) ? itemUri : computeUri(row, rowProps, firstProps, fiber, dataUri, href);
    const uri = resolvedUri || (cached && cached.rowIndex && cached.rowIndex === rowIndex ? cached.uri : null);
    const prevTrack = cached && cached.uri === uri && cached.track?.uri === uri ? cached.track : null;
    const entry = { rowProps, firstProps, fiberProps, rowIndex, dataUri, itemUri, href, uri, track: prevTrack };
    rowCache.set(row, entry);
    return entry;
  }
  function getUri(row) { return getRowMeta(row).uri; }
  function track(row) {
    const meta = getRowMeta(row);
    if (!meta.uri) return { uri: null };
    if (!meta.track || meta.track.uri !== meta.uri) meta.track = Genre4allColumn.trackFromRow(row, meta.uri);
    return meta.track;
  }

  function makeStorage() {
    const memory = new Map();
    let disk;
    try { disk = Genre4allTransport.createIndexedDBStorage(); } catch { /* Memory cache fallback. */ }
    let failed = !disk;
    async function use(method, space, key, value) {
      if (method === 'set') memory.set(space + ':' + key, value);
      if (method === 'remove') memory.delete(space + ':' + key);
      if (method === 'clear') for (const k of memory.keys()) if (k.startsWith(space + ':')) memory.delete(k);
      if (!failed) {
        try { return await disk[method](space, key, value); }
        catch { failed = true; console.warn('[Genre4all] Armazenamento persistente indisponível; usando cache temporário.'); }
      }
      if (method === 'get') return memory.get(space + ':' + key);
      if (method === 'entries') return [...memory].filter(([k]) => k.startsWith(space + ':')).map(([k,v]) => [k.slice(space.length + 1),v]);
    }
    return Object.fromEntries(['get','set','remove','clear','entries'].map(method => [method, (...args) => use(method, ...args)]).concat([['close', () => disk?.close().catch(() => {})]]));
  }
  const storage = makeStorage();
  function showPreferences() {
    preferences?.remove();
    const cfg = service?.getConfig() || {};
    const d = node('dialog', null, { class: 'g4a-preferences', 'aria-label': 'Genre4all config' });
    d.append(node('h2', 'Genre4all config'));

    d.append(node('h3', 'Fontes e Chaves de API (Discogs → MusicBrainz → Spotify)'));
    for (const [providerKey, providerLabel] of [
      ['discogs', 'Priorizar Discogs (Moldura Branca)'],
      ['musicbrainz', 'Usar MusicBrainz + Spotify (Moldura Roxo/Laranja)'],
      ['spotify', 'Usar Spotify (Complementar / Fallback)']
    ]) {
      const row = node('label', providerLabel);
      const input = node('input', null, { type: 'checkbox', 'data-g4a-provider': providerKey });
      input.checked = cfg.enabled?.[providerKey] !== false;
      input.addEventListener('change', () => {
        service?.configure({ enabled: { [providerKey]: input.checked } })
          .catch(() => Spicetify.showNotification?.('Genre4all: não foi possível salvar a preferência.', true));
      });
      row.prepend(input);
      d.append(row);
    }

    const discogsField = node('div', null, { class: 'g4a-preferences-field' });
    discogsField.append(node('span', 'Chave da API do Discogs (Personal Access Token ou key:secret)'));
    const discogsInput = node('input', null, {
      type: 'password',
      class: 'g4a-preferences-input',
      name: 'discogsToken',
      'data-g4a-field': 'discogsToken',
      placeholder: 'Cole seu token do Discogs (discogs.com/settings/developers)',
      autocomplete: 'off'
    });
    discogsInput.value = cfg.discogsToken || '';
    discogsField.append(discogsInput);
    d.append(discogsField);

    const mbField = node('div', null, { class: 'g4a-preferences-field' });
    mbField.append(node('span', 'Chave / Token da API do MusicBrainz (opcional)'));
    const mbInput = node('input', null, {
      type: 'password',
      class: 'g4a-preferences-input',
      name: 'musicbrainzToken',
      'data-g4a-field': 'musicbrainzToken',
      placeholder: 'Opcional (MusicBrainz já funciona sem chave)',
      autocomplete: 'off'
    });
    mbInput.value = cfg.musicbrainzToken || '';
    mbField.append(mbInput);
    d.append(mbField);

    const saveTokens = () => {
      const current = service?.getConfig() || {};
      const nextDiscogs = discogsInput.value.trim();
      const nextMb = mbInput.value.trim();
      if (nextDiscogs !== (current.discogsToken || '') || nextMb !== (current.musicbrainzToken || '')) {
        return service?.configure({ discogsToken: nextDiscogs, musicbrainzToken: nextMb })
          .catch(() => Spicetify.showNotification?.('Genre4all: não foi possível salvar a chave de API.', true));
      }
      return Promise.resolve();
    };
    discogsInput.addEventListener('change', saveTokens);
    mbInput.addEventListener('change', saveTokens);

    d.append(node('h3', 'Exibição'));
    for (const [key, label] of [['colors','Cores nos gêneros'],['showGenres','Mostrar gêneros principais'],['showStyles','Mostrar subgêneros e estilos']]) {
      const row = node('label', label), input = node('input', null, { type: 'checkbox' });
      input.checked = !!service?.getConfig()?.[key];
      input.addEventListener('change', () => service?.configure({ [key]: input.checked }).catch(() => Spicetify.showNotification?.('Genre4all: não foi possível salvar a preferência.', true)));
      row.prepend(input); d.append(row);
    }

    d.append(node('h3', 'Player & Soundwave'));
    const waveField = node('div', null, { class: 'g4a-preferences-field' });
    const waveLabel = node('label', null, { style: 'display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0;' });
    const waveInput = node('input', null, { type: 'checkbox', style: 'margin-top:3px;' });
    waveInput.checked = typeof Genre4allPlayerWaveform !== 'undefined' ? Genre4allPlayerWaveform.enabled : false;
    waveInput.addEventListener('change', () => {
      if (typeof Genre4allPlayerWaveform !== 'undefined') {
        Genre4allPlayerWaveform.setEnabled(waveInput.checked);
      }
    });
    const waveTextWrap = node('div', null, { style: 'display:flex;flex-direction:column;gap:3px;' });
    const waveTitleRow = node('div', null, { style: 'display:flex;align-items:center;gap:8px;' });
    waveTitleRow.append(node('span', 'Onda sonora no player (Soundwave)', { style: 'font-weight:600;font-size:13.5px;color:#fff;' }));
    waveTitleRow.append(node('span', 'EXPERIMENTAL', { class: 'g4a-badge-experimental' }));
    const waveDesc = node('span', 'Substitui a barra de progresso por uma soundwave interativa estilo Beatport com kicks e drops nítidos, metadados (tempo, BPM e Tom) e controles em ilha dinâmica Apple style.', { style: 'font-size:12px;color:var(--spice-subtext,#b3b3b3);line-height:1.4;' });
    waveTextWrap.append(waveTitleRow, waveDesc);
    waveLabel.append(waveInput, waveTextWrap);
    waveField.append(waveLabel);
    d.append(waveField);
    d.append(node('h3', 'Cache leve (armazenamento rápido)'));
    const cacheInfo = node('div', null, { class: 'g4a-preferences-field', 'data-g4a-cache-info': '' });
    const updateCacheCount = () => {
      const count = service?.stats()?.providerCache ?? 0;
      cacheInfo.textContent = '';
      cacheInfo.append(node('span', `Registros em cache local (TXT / IndexedDB): ${count}`));
    };
    updateCacheCount();
    d.append(cacheInfo);

    const actions = node('div', null, { class: 'g4a-preferences-actions' });
    const refresh = node('button', 'Atualizar gêneros', { type: 'button' });
    const clearCacheBtn = node('button', 'Limpar cache', { type: 'button', 'data-g4a-action': 'clear-cache' });
    const done = node('button', 'Fechar', { type: 'button' });
    const dismiss = () => {
      saveTokens();
      d.close(); d.remove();
      if (preferences === d) preferences = null;
    };
    refresh.addEventListener('click', () => {
      saveTokens().finally(() => {
        dismiss();
        service?.clearCache().catch(() => {});
      });
    });
    clearCacheBtn.addEventListener('click', () => {
      saveTokens()
        .then(() => service?.clearCache())
        .then(() => {
          updateCacheCount();
          clearCacheBtn.textContent = 'Cache limpo!';
          globalThis.Spicetify?.showNotification?.('Genre4all: cache limpo com sucesso.');
        })
        .catch(() => globalThis.Spicetify?.showNotification?.('Genre4all: falha ao limpar cache.', true));
    });
    done.addEventListener('click', dismiss);
    d.addEventListener('cancel', e => { e.preventDefault(); dismiss(); });
    for (const type of ['keydown', 'keyup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'contextmenu']) d.addEventListener(type, e => e.stopPropagation());
    actions.append(refresh, clearCacheBtn, done);
    d.append(actions);
    document.body.append(d); preferences = d; d.showModal(); done.focus();
  }

  function isFullWidthCell(c) {
    if (!c || c.nodeType !== 1) return false;
    return c.hasAttribute('aria-colspan')
      || c.matches('[class*="trackListRowFullWidthCell"],[class*="FullWidthCell"],[class*="fullWidth"],[data-testid="tracklist-row-full-width"],.PoSfoROJK6lwVe6ZtR0U');
  }
  function cells(container, checkComputed = false) {
    return [...container.children].filter(c => {
      if (c.tagName === 'GENRE4ALL-COLUMN' || isFullWidthCell(c) || !c.matches(CELL) || c.style.display === 'none' || c.hidden) return false;
      return !checkComputed || getComputedStyle(c).display !== 'none';
    });
  }
  function visualCells(container) {
    return [...container.children]
      .filter(c => !isFullWidthCell(c) && (c.matches(CELL) || c.tagName === 'GENRE4ALL-COLUMN') && c.style.display !== 'none' && !c.hidden && getComputedStyle(c).display !== 'none')
      .sort((a, b) => (parseInt(a.style.getPropertyValue('--g4a-position'), 10) || 0) - (parseInt(b.style.getPropertyValue('--g4a-position'), 10) || 0));
  }
  function hasDirectCells(el) {
    if (!el) return false;
    for (const c of el.children) {
      if (c.tagName !== 'GENRE4ALL-COLUMN' && !isFullWidthCell(c) && !c.hidden && c.style.display !== 'none' && c.matches(CELL)) return true;
    }
    return false;
  }
  function rowContainer(row) {
    if (hasDirectCells(row)) return row;
    for (const child of row.children) {
      if (hasDirectCells(child)) return child;
    }
    return null;
  }
  function colKeyForHeader(cell, m) {
    if (cell.tagName === 'GENRE4ALL-COLUMN') return '__genre__';
    const typeAttr = cell.getAttribute('data-column-type') || cell.querySelector('[data-column-type]')?.getAttribute('data-column-type');
    if (typeAttr) return normalize(typeAttr).trim();
    const textEl = cell.querySelector('[data-encore-id="text"], span');
    const raw = normalize((textEl ? textEl.textContent : cell.textContent) || cell.getAttribute('aria-label') || '').trim();
    return raw || `col-${m}`;
  }
  function buildMidOrder(foreignHeader, minInsert, endIndex, fallbackKeys = null) {
    const midCount = Math.max(0, endIndex - minInsert);
    const seenKeys = new Set();
    const items = [];
    for (let m = 0; m < midCount; m++) {
      const cell = foreignHeader ? foreignHeader[minInsert + m] : null;
      if (cell && (!cell || cell.tagName === 'GENRE4ALL-COLUMN')) continue;
      let k = cell ? colKeyForHeader(cell, m) : (fallbackKeys?.[m] || `col-${m}`);
      if (k === '__genre__') continue;
      if (seenKeys.has(k)) k = `${k}#${m}`;
      seenKeys.add(k);
      items.push({ type: 'native', index: minInsert + m, key: k });
    }
    const genreDefaultIdx = Math.max(0, Math.min(items.length, items.length - orderOffset));
    items.splice(genreDefaultIdx, 0, { type: 'genre', index: -1, key: '__genre__' });
    if (columnOrder.length >= 2) {
      const rank = new Map(columnOrder.map((k, idx) => [k, idx]));
      const matchedSlots = [];
      const matchedItems = [];
      items.forEach((item, idx) => {
        if (rank.has(item.key)) {
          matchedSlots.push(idx);
          matchedItems.push(item);
        }
      });
      if (matchedItems.length >= 2) {
        matchedItems.sort((a, b) => rank.get(a.key) - rank.get(b.key));
        matchedSlots.forEach((slotIdx, i) => { items[slotIdx] = matchedItems[i]; });
      }
    }
    return items;
  }

  function attachResize(root, rootState) {
    const resolvePair = sep => {
      const headerCell = sep.closest('[role="columnheader"],genre4all-column[data-kind="header"]');
      const container = headerCell?.parentElement;
      if (!container || !layouts.has(container)) return null;
      const all = visualCells(container);
      const end = all.find(c => c.matches('.main-trackList-rowSectionEnd,[data-sp-layout-position="native:end"]')) || all[all.length - 1];
      const endIndex = all.indexOf(end);
      const flexStart = endIndex > 2 ? 1 : 0;
      const flexCells = all.slice(flexStart, endIndex);
      const k = flexCells.indexOf(headerCell);
      return k >= 0 && flexCells.length >= 2 ? { flexCells, k } : null;
    };
    const adjust = (startWidths, k, dx) => {
      const next = [...startWidths];
      const a = k < next.length - 1 ? k : k - 1, b = a + 1;
      const sign = k < next.length - 1 ? 1 : -1;
      const minA = a === 0 ? 120 : 80, minB = 80;
      const delta = Math.max(minA - startWidths[a], Math.min(startWidths[b] - minB, sign * dx));
      next[a] = startWidths[a] + delta;
      next[b] = startWidths[b] - delta;
      return next;
    };
    const startHeaderInteraction = e => {
      if (!visible || root.hasAttribute('data-sp-native-layout') || e.button !== 0 || rootState.activeDrag) return;
      const sep = e.target.closest?.('[role="separator"]:not(.sp-layout-resize)');
      if (sep && root.contains(sep)) {
        const pair = resolvePair(sep); if (!pair) return;
        e.preventDefault(); e.stopImmediatePropagation();
        rootState.activeDrag = 'resize';
        const startWidths = pair.flexCells.map(c => c.getBoundingClientRect().width || 120);
        const startX = e.clientX;
        document.documentElement.classList.add('g4a-resizing');
        const move = ev => {
          rootState.weights = adjust(startWidths, pair.k, ev.clientX - startX);
          rootState.measured = null;
          schedule();
        };
        const up = () => {
          rootState.activeDrag = null;
          document.documentElement.classList.remove('g4a-resizing');
          window.removeEventListener('mousemove', move, true);
          window.removeEventListener('mouseup', up, true);
        };
        window.addEventListener('mousemove', move, true);
        window.addEventListener('mouseup', up, true);
        return;
      }
      const headerCell = e.target.closest?.('genre4all-column[data-kind="header"],[role="columnheader"]');
      if (!headerCell || !root.contains(headerCell)) return;
      const container = headerCell.parentElement;
      if (!container || !layouts.has(container)) return;
      const all = visualCells(container);
      const end = all.find(c => c.matches('.main-trackList-rowSectionEnd,[data-sp-layout-position="native:end"]')) || all[all.length - 1];
      const allEnd = all.indexOf(end);
      const minSlot = Math.min(2, Math.max(0, allEnd - 1));
      const initialSlot = all.indexOf(headerCell);
      if (initialSlot < minSlot || initialSlot >= allEnd) return;
      rootState.activeDrag = 'reorder';
      const startX = e.clientX;
      let dragging = false;
      const clearNativeTransforms = () => {
        for (const w of container.querySelectorAll('[data-tracklist-draggable-column],[class*="columnHeaderMotionWrapper"]')) {
          if (w.style.transform) w.style.transform = '';
        }
      };
      const move = ev => {
        if (!dragging && Math.abs(ev.clientX - startX) > 5) {
          dragging = true;
          headerCell.classList.add('g4a-header-dragging');
          document.documentElement.classList.add('g4a-reordering');
          clearNativeTransforms();
        }
        if (!dragging) return;
        clearNativeTransforms();
        const curAll = visualCells(container);
        const curEnd = curAll.find(c => c.matches('.main-trackList-rowSectionEnd,[data-sp-layout-position="native:end"]')) || curAll[curAll.length - 1];
        const curAllEnd = curAll.indexOf(curEnd);
        const curMinSlot = Math.min(2, Math.max(0, curAllEnd - 1));
        const fromSlot = curAll.indexOf(headerCell);
        if (fromSlot < curMinSlot || fromSlot >= curAllEnd) return;
        let bestSlot = fromSlot, bestDist = Infinity;
        for (let s = curMinSlot; s < curAllEnd; s++) {
          const rect = curAll[s].getBoundingClientRect();
          const dist = Math.abs(ev.clientX - (rect.left + rect.right) / 2);
          if (dist < bestDist) { bestDist = dist; bestSlot = s; }
        }
        if (bestSlot !== fromSlot) {
          const midCells = curAll.slice(curMinSlot, curAllEnd);
          const keys = midCells.map((c, idx) => c.dataset.g4aColKey || colKeyForHeader(c, idx));
          const fromIdx = fromSlot - curMinSlot;
          const toIdx = bestSlot - curMinSlot;
          const [movedKey] = keys.splice(fromIdx, 1);
          keys.splice(toIdx, 0, movedKey);
          if (Array.isArray(rootState.weights) && rootState.weights.length === curAllEnd - (curAllEnd > 2 ? 1 : 0)) {
            const weightOffset = curMinSlot - (curAllEnd > 2 ? 1 : 0);
            const nextWeights = [...rootState.weights];
            const [movedW] = nextWeights.splice(weightOffset + fromIdx, 1);
            nextWeights.splice(weightOffset + toIdx, 0, movedW);
            rootState.weights = nextWeights;
          }
          const preserved = columnOrder.filter(k => !keys.includes(k));
          columnOrder = [...keys, ...preserved];
          try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(columnOrder)); } catch { /* Keep session usable. */ }
          const genreIdx = keys.indexOf('__genre__');
          if (genreIdx >= 0) {
            orderOffset = Math.max(0, (keys.length - 1) - genreIdx);
            try { localStorage.setItem(ORDER_KEY, String(orderOffset)); } catch { /* Keep session usable. */ }
          }
          invalidateLayouts(false, true);
          sync();
        }
      };
      const up = () => {
        rootState.activeDrag = null;
        window.removeEventListener('mousemove', move, true);
        window.removeEventListener('mouseup', up, true);
        if (dragging) {
          headerCell.classList.remove('g4a-header-dragging');
          document.documentElement.classList.remove('g4a-reordering');
          clearNativeTransforms();
          const suppressClick = clickEv => { clickEv.preventDefault(); clickEv.stopImmediatePropagation(); };
          headerCell.addEventListener('click', suppressClick, true);
          setTimeout(() => headerCell.removeEventListener('click', suppressClick, true), 0);
        }
      };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    };
    root.addEventListener('mousedown', startHeaderInteraction, { capture: true, signal: rootState.events.signal });
    root.addEventListener('keydown', e => {
      if (!visible || root.hasAttribute('data-sp-native-layout') || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
      const sep = e.target.closest?.('[role="separator"]:not(.sp-layout-resize)');
      if (!sep || !root.contains(sep)) return;
      const pair = resolvePair(sep); if (!pair) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const startWidths = pair.flexCells.map(c => c.getBoundingClientRect().width || 120);
      rootState.weights = adjust(startWidths, pair.k, e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 10 : -10);
      rootState.measured = null;
      schedule();
    }, { capture: true, signal: rootState.events.signal });
  }
  function releaseRow(row) {
    const state = layouts.get(row); if (!state) return;
    view?.release(state.host); state.shell.remove(); state.prevSep?.remove();
    state.prevHost?.removeAttribute('data-g4a-prev-sep');
    layouts.delete(row);
    row.classList.remove('g4a-row'); row.removeAttribute('data-g4a-row'); row.removeAttribute('data-g4a-measure');
    row.style.removeProperty('--g4a-tracks'); row.style.removeProperty('--g4a-total');
    for (const c of state.positions) {
      c.removeAttribute('data-g4a-position');
      c.removeAttribute('data-g4a-col-key');
      c.style.removeProperty('--g4a-position');
    }
  }
  function measureGrid(container, foreign, endIndex, minInsert, midOrder, isNativeLayout, rootState) {
    container.setAttribute('data-g4a-measure', '');
    const computed = getComputedStyle(container);
    const gap = parseFloat(computed.columnGap) || 0;
    const padding = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
    const raw = computed.gridTemplateColumns.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/).map(parseFloat);
    const baseWidths = raw.length === foreign.length && raw.every(Number.isFinite) ? raw : foreign.map(c => c.getBoundingClientRect().width || 120);
    container.removeAttribute('data-g4a-measure');
    const width = 176;
    let widths;
    if (!isNativeLayout) {
      const flexStart = endIndex > 1 ? 1 : 0;
      const flexCount = Math.max(1, endIndex - flexStart);
      const nativeFlexWidths = baseWidths.slice(flexStart, flexStart + flexCount);
      const flexSum = nativeFlexWidths.reduce((a, b) => a + b, 0);
      const avail = Math.max(0, flexSum - gap);
      const baseGenre = Math.min(176, Math.max(110, flexSum / (flexCount + 1)));
      const orderedMidWidths = midOrder.map(item => item.type === 'genre' ? baseGenre : (baseWidths[item.index] ?? 120));
      const leadingFlex = minInsert > flexStart ? baseWidths.slice(flexStart, minInsert) : [];
      const defaultWeights = [...leadingFlex, ...orderedMidWidths];
      const weights = rootState?.weights?.length === defaultWeights.length ? rootState.weights : defaultWeights;
      const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
      const mins = weights.map((_, k) => k === 0 ? 120 : 80);
      const minSum = mins.reduce((a, b) => a + b, 0);
      let alloc = weights.map((w, k) => Math.max(mins[k], avail * (w / weightSum)));
      const allocSum = alloc.reduce((a, b) => a + b, 0);
      if (avail > minSum && allocSum > avail) {
        const extra = alloc.reduce((s, v, k) => s + Math.max(0, v - mins[k]), 0);
        if (extra > 0) alloc = alloc.map((v, k) => v > mins[k] ? mins[k] + (v - mins[k]) * ((extra - (allocSum - avail)) / extra) : v);
      }
      widths = [
        ...baseWidths.slice(0, flexStart),
        ...alloc,
        ...baseWidths.slice(endIndex)
      ];
    } else {
      widths = [...baseWidths];
      widths.splice(endIndex, 0, width);
    }
    const total = Math.ceil(widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1) + padding);
    const template = widths.map(w => `${Math.max(0, w)}px`).join(' ');
    return { total, template };
  }
  function layout(row, header, root, rootState) {
    const container = rowContainer(row); if (!container) return;
    let state = layouts.get(container);
    if (!state) {
      if (getComputedStyle(container).display !== 'grid') return;
      const shell = node('genre4all-column', null, { 'data-kind': header ? 'header' : 'data' });
      const label = header ? node('span', 'Gênero', { class: 'g4a-header-label standalone-ellipsis-one-line', 'data-encore-id': 'text' }) : null;
      const sep = header ? node('div', null, { role: 'separator', 'aria-orientation': 'horizontal', 'aria-hidden': 'true', 'data-skip-in-keyboard-nav': 'true', class: 'g4a-header-sep' }) : null;
      const host = header ? null : node('div', null, { class: 'g4a-data' });
      if (header) shell.append(label, sep); else shell.append(host);
      state = { shell, label, sep, host, prevSep: null, prevHost: null, positions: new Set(), root, appliedKey: null };
      layouts.set(container, state);
    }
    const isNativeLayout = root.hasAttribute('data-sp-native-layout');
    const foreign = cells(container, header || isNativeLayout || !rootState.measured);
    if (!foreign.length) return;
    const end = foreign.find(c => c.matches('.main-trackList-rowSectionEnd,[data-sp-layout-position="native:end"]')) || foreign[foreign.length - 1];
    const endIndex = foreign.indexOf(end);
    const minInsert = Math.min(2, endIndex);
    let midOrder;
    if (isNativeLayout) {
      midOrder = [];
      for (let i = minInsert; i < endIndex; i++) midOrder.push({ type: 'native', index: i, key: `col-${i}` });
      midOrder.push({ type: 'genre', index: -1, key: '__genre__' });
    } else if (header || !rootState.midOrder || rootState.midOrderCount !== endIndex - minInsert) {
      if (header) {
        rootState.headerForeign = foreign;
        rootState.headerColKeys = foreign.slice(minInsert, endIndex).map((c, idx) => colKeyForHeader(c, idx));
      }
      midOrder = buildMidOrder(header ? foreign : rootState.headerForeign, minInsert, endIndex, rootState.headerColKeys);
      if (header || !rootState.midOrder) {
        rootState.midOrder = midOrder;
        rootState.midOrderCount = endIndex - minInsert;
      }
    } else {
      midOrder = rootState.midOrder;
    }
    const orderSignature = midOrder.map(item => `${item.type}:${item.index}:${item.key}`).join('|');
    const rootWidth = root.clientWidth || 0;
    const inlineGrid = container.style.gridTemplateColumns || '';
    const spTracks = root.style.getPropertyValue('--sp-layout-tracks') || container.style.getPropertyValue('--sp-layout-tracks') || '';
    const weightsKey = rootState.weights ? rootState.weights.map(w => Math.round(w)).join(',') : '';
    const measureKey = `${isNativeLayout}|${rootWidth}|${foreign.length}|${endIndex}|${inlineGrid}|${spTracks}|${weightsKey}|${orderSignature}`;

    const midCells = midOrder.map(item => item.type === 'genre' ? state.shell : foreign[item.index]).filter(Boolean);
    const all = [...foreign.slice(0, minInsert), ...midCells, ...foreign.slice(endIndex)];
    const genreVisualIdx = all.indexOf(state.shell);
    const insertDomRef = foreign[Math.min(endIndex, Math.max(minInsert, genreVisualIdx))] || end;
    if (state.shell.parentElement !== container || state.shell.nextElementSibling !== insertDomRef) {
      container.insertBefore(state.shell, insertDomRef);
    }

    if (header) {
      midOrder.forEach(item => {
        const targetCell = item.type === 'genre' ? state.shell : foreign[item.index];
        if (targetCell && targetCell.dataset.g4aColKey !== item.key) targetCell.dataset.g4aColKey = item.key;
      });
      const sampleText = container.querySelector('[role="columnheader"] [data-encore-id="text"]');
      if (sampleText && state.label) {
        const cls = `${sampleText.className} g4a-header-label standalone-ellipsis-one-line`.trim();
        if (state.label.className !== cls) state.label.className = cls;
      }
      const sampleSep = container.querySelector('[role="columnheader"] [role="separator"]:not(.sp-layout-resize):not([data-g4a-sep])');
      const sepClass = `${sampleSep?.className || ''} g4a-header-sep`.trim();
      if (state.sep && state.sep.className !== sepClass) state.sep.className = sepClass;
      const prev = endIndex >= 2 && !isNativeLayout ? foreign[endIndex - 1] : null;
      const prevHost = prev ? (prev.querySelector('[data-tracklist-draggable-column]') || prev) : null;
      if (state.prevHost && state.prevHost !== prevHost) {
        state.prevSep?.remove(); state.prevSep = null;
        state.prevHost.removeAttribute('data-g4a-prev-sep'); state.prevHost = null;
      }
      if (prevHost && !prev.querySelector('[role="separator"]:not(.sp-layout-resize):not([data-g4a-sep])')) {
        if (!state.prevSep) state.prevSep = node('div', null, { role: 'separator', 'aria-orientation': 'horizontal', 'aria-hidden': 'true', 'data-skip-in-keyboard-nav': 'true', 'data-g4a-sep': '', class: sepClass });
        if (state.prevSep.className !== sepClass) state.prevSep.className = sepClass;
        if (state.prevSep.parentElement !== prevHost) prevHost.append(state.prevSep);
        if (!prevHost.hasAttribute('data-g4a-prev-sep')) prevHost.setAttribute('data-g4a-prev-sep', '');
        state.prevHost = prevHost;
      } else if (state.prevSep) {
        state.prevSep.remove(); state.prevSep = null;
        state.prevHost?.removeAttribute('data-g4a-prev-sep'); state.prevHost = null;
      }
    }

    if (!rootState.measured) rootState.measuredMap?.clear();
    let measured = rootState.measured?.key === measureKey
      ? rootState.measured
      : (rootState.measuredMap?.get(measureKey) || null);
    if (!measured) {
      const m = measureGrid(container, foreign, endIndex, minInsert, midOrder, isNativeLayout, rootState);
      measured = { key: measureKey, total: m.total, template: m.template };
      rootState.measured = measured;
      if (!rootState.measuredMap) rootState.measuredMap = new Map();
      if (rootState.measuredMap.size >= 12) rootState.measuredMap.delete(rootState.measuredMap.keys().next().value);
      rootState.measuredMap.set(measureKey, measured);
    }

    if (!inlineGrid || !root.style.getPropertyValue('--g4a-tracks')) {
      ownProperty(root, '--g4a-tracks', measured.template);
      ownProperty(root, '--g4a-total', `${measured.total}px`);
    }
    ownProperty(container, '--g4a-tracks', measured.template);
    ownProperty(container, '--g4a-total', `${measured.total}px`);
    rootState.maxTotal = Math.max(rootState.maxTotal || 0, measured.total);
    for (const c of state.positions) if (!all.includes(c)) {
      c.removeAttribute('data-g4a-position');
      c.style.removeProperty('--g4a-position');
      state.positions.delete(c);
    }
    const fullWidth = container.querySelector('[aria-colspan],[class*="FullWidthCell"],[class*="trackListRowFullWidthCell"],.PoSfoROJK6lwVe6ZtR0U');
    if (fullWidth && (fullWidth.hasAttribute('data-g4a-position') || fullWidth.style.getPropertyValue('--g4a-position'))) {
      fullWidth.removeAttribute('data-g4a-position');
      fullWidth.style.removeProperty('--g4a-position');
      state.positions.delete(fullWidth);
    }
    all.forEach((c, i) => {
      if (!c.hasAttribute('data-g4a-position')) c.setAttribute('data-g4a-position', '');
      ownProperty(c, '--g4a-position', String(i + 1));
      state.positions.add(c);
    });
    const colIdx = String(genreVisualIdx + 1);
    if (state.shell.getAttribute('aria-colindex') !== colIdx) state.shell.setAttribute('aria-colindex', colIdx);
    if (!container.classList.contains('g4a-row')) container.classList.add('g4a-row');
    if (!container.hasAttribute('data-g4a-row')) container.setAttribute('data-g4a-row', '');
    state.appliedKey = measureKey;
  }

  function columnMenu(menu) {
    if (!menu.isConnected || menu.closest('.g4a-preferences,.g4a-genre-dialog')) return false;
    const text = normalize(menu.textContent || '');
    const items = [...menu.querySelectorAll('[role="menuitemcheckbox"],[role="checkbox"],input[type="checkbox"],button[aria-checked]')].filter(n => !n.closest('[data-g4a-menu-item]'));
    const labels = [...menu.querySelectorAll('button,[role="menuitem"]')].filter(n => !n.closest('[data-g4a-menu-item]')).map(n => normalize(n.textContent || '').trim());
    const known = labels.filter(label => /^(forma de onda|waveform|album|adicionada em|date added|added date|data de lancamento|release date|duracao|duration|bpm|tom|key)$/.test(label));
    // textContent joins adjacent menu labels without whitespace in Spotify.
    return (items.length >= 2 && (/(colunas|columns)/.test(text) || /(album|duration|duracao|added|adicionada|release date|data de lancamento)/.test(text)))
      || (known.length >= 2 && /(colunas|columns)/.test(text))
      || (known.length >= 3 && labels.some(label => /^(duration|duracao|waveform|forma de onda)$/.test(label)));
  }
  function profileMenu(menu) {
    if (!menu.isConnected || menu.closest('.g4a-preferences,.g4a-genre-dialog') || columnMenu(menu)) return false;
    const labels = [...menu.querySelectorAll('button,a,[role="menuitem"],[role="menuitemcheckbox"]')].filter(n => !n.closest('[data-g4a-profile-item]')).map(n => normalize(n.textContent || '').trim());
    if (labels.some(l => l.includes('genre4all config'))) return false;
    const known = labels.filter(l => /^(conta|account|perfil|profile|configuracoes|settings|sair|log out|experimental features|home config|spicy lyrics settings|private session|sessao particular|suporte|support)$/.test(l));
    return known.length >= 2;
  }
  function updateMenus() {
    for (const item of document.querySelectorAll('[data-g4a-menu-item]')) {
      const button = item.querySelector('button'); if (!button) continue;
      button.setAttribute('aria-checked', String(visible));
      item.querySelector('svg').style.visibility = visible ? 'visible' : 'hidden';
    }
  }
  function injectMenus() {
    for (const menu of document.querySelectorAll('[role="menu"],.main-contextMenu-menu')) {
      if (columnMenu(menu) && !menu.querySelector('[data-g4a-menu-item]')) {
        const item = node(menu.tagName === 'UL' || menu.tagName === 'OL' ? 'li' : 'div', null, { 'data-g4a-menu-item': '', role: 'presentation' });
        const sample = menu.querySelector('button[role="menuitemcheckbox"],button[aria-checked],button');
        const button = node('button', null, { type: 'button', class: `${sample?.className || ''} g4a-menu-button`, role: 'menuitemcheckbox', 'aria-checked': String(visible), tabindex: '0', title: 'Genre4all — mostrar ou ocultar a coluna de gênero' });
        button.append(node('span', 'Gênero'));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 10.69l6.47-6.47a.75.75 0 0 1 1.06 0z'); svg.append(path); button.append(svg);
        button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setVisible(!visible); });
        button.addEventListener('keydown', e => {
          if (!['ArrowUp','ArrowDown','Home','End'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const options = [...menu.querySelectorAll('button,[role="menuitem"],[role="menuitemcheckbox"]')].filter(n => !n.disabled && n.getBoundingClientRect().height > 0);
          const index = options.indexOf(button);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
          options[next]?.focus();
        });
        item.append(button); menu.append(item);
      } else if (profileMenu(menu) && !menu.querySelector('[data-g4a-profile-item]')) {
        const item = node(menu.tagName === 'UL' || menu.tagName === 'OL' ? 'li' : 'div', null, { 'data-g4a-profile-item': '', role: 'presentation' });
        const sample = menu.querySelector('button[role="menuitem"],button');
        const button = node('button', null, { type: 'button', class: `${sample?.className || ''} g4a-profile-button`, role: 'menuitem', tabindex: '-1' });
        const iconHolder = node('span'); iconHolder.innerHTML = CONFIG_ICON;
        if (iconHolder.firstElementChild) button.append(iconHolder.firstElementChild);
        button.append(node('span', 'Genre4all config'));
        button.addEventListener('click', e => {
          e.preventDefault(); e.stopPropagation();
          menu.remove();
          showPreferences();
        });
        item.append(button);
        const anchor = [...menu.children].find(c => /spicy lyrics|home config|experimental/i.test(c.textContent || ''));
        if (anchor?.nextSibling) menu.insertBefore(item, anchor.nextSibling);
        else if (menu.firstElementChild) menu.insertBefore(item, menu.firstElementChild);
        else menu.append(item);
      }
    }
    updateMenus();
  }

  // Observe native changes and virtualization; ignore our rendering, menu writes and unrelated player animations.
  const IGNORE_MUTATION_SELECTOR = 'genre4all-column,[data-g4a-menu-item],[data-g4a-profile-item],[data-g4a-sep],.g4a-genre-fan,.g4a-preferences,.g4a-waveform-player';
  const RELEVANT_ATTR_SELECTOR = `${ROOT},${ROW},${CELL},[role="menu"],.main-contextMenu-menu`;
  const observer = new MutationObserver(records => {
    if (document.documentElement.classList.contains('g4a-reordering')) return;
    if (records.some(m => {
      const target = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!target || target.closest?.(IGNORE_MUTATION_SELECTOR)) return false;
      const inRelevant = !!target.closest?.(`${ROOT},[role="menu"],.main-contextMenu-menu`);
      if (m.type === 'childList') {
        return [...m.addedNodes, ...m.removedNodes].some(n => {
          if (n.nodeType !== 1 || n.matches(IGNORE_MUTATION_SELECTOR)) return false;
          if (inRelevant) return true;
          return n.matches?.(`${ROOT},${ROW},[role="menu"],.main-contextMenu-menu`) || !!n.querySelector?.(`${ROOT},${ROW},[role="menu"],.main-contextMenu-menu`);
        });
      }
      if (!inRelevant) return false;
      if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
        return !!target.matches?.(RELEVANT_ATTR_SELECTOR) || !!target.parentElement?.matches?.(ROW);
      }
      return true;
    })) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-rowindex','data-uri','href','style','class'] });
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { invalidateLayouts(false, false); schedule(); }) : null;

  function sync() {
    frame = null; if (closed) return;
    try {
      injectMenus();
      const found = new Set();
      for (const root of document.querySelectorAll(ROOT)) {
        if (!root.querySelector('.main-trackList-trackListRow,[role="row"] [role="gridcell"]')) continue;
        // The closest grid owns the rows; nested containers must not produce duplicate cells.
        const rows = [...root.querySelectorAll(ROW)].filter(row => row.closest(ROOT) === root);
        if (!rows.length) continue;
        found.add(root);
        let rootState = roots.get(root);
        if (!rootState) {
          rootState = { events: new AbortController(), weights: null, measured: null, midOrder: null, midOrderCount: -1, headerForeign: null, headerColKeys: null, maxTotal: 0, activeDrag: null };
          roots.set(root, rootState);
          attachResize(root, rootState);
          resize?.observe(root);
        }
        rootState.maxTotal = 0;
        root.classList.toggle('g4a-root', visible);
        if (visible) {
          const headerRows = [], dataRows = [];
          for (const row of rows) {
            if (row.querySelector('[role="columnheader"]')) headerRows.push(row);
            else if (getUri(row) || row.querySelector('genre4all-column') || layouts.has(row)) dataRows.push(row);
          }
          for (const row of headerRows) layout(row, true, root, rootState);
          for (const row of dataRows) layout(row, false, root, rootState);
          if (rootState.maxTotal > (root.clientWidth || rootState.maxTotal) + 2) {
            if (!root.hasAttribute('data-g4a-overflow')) root.setAttribute('data-g4a-overflow', '');
          } else if (root.hasAttribute('data-g4a-overflow')) {
            root.removeAttribute('data-g4a-overflow');
          }
          view?.sync(root, [{ type: 'genre', dataSelector: '.g4a-data' }]);
        } else {
          clearRootStyles(root);
        }
      }
      for (const [row, state] of layouts) if (!row.isConnected || !found.has(state.root) || !row.contains(state.shell)) releaseRow(row);
      for (const [root, rootState] of roots) if (!found.has(root)) {
        rootState.events.abort(); roots.delete(root);
        clearRootStyles(root);
        resize?.unobserve(root);
      }
      view?.prune();
    } catch (error) { console.error('[Genre4all] Falha ao atualizar coluna.', error); }
    // Only synchronous writes from this pass are discarded. Async results remain observable.
    observer.takeRecords();
  }
  function close() {
    if (closed) return;
    closed = true; lifecycle.abort(); observer.disconnect(); resize?.disconnect(); unlisten?.();
    try { globalThis.Spicetify?.Player?.removeEventListener?.('onplaypause', schedule); } catch {}
    try { globalThis.Spicetify?.Player?.removeEventListener?.('songchange', schedule); } catch {}
    try { profileMenuItem?.deregister?.(); } catch { /* Ignore menu cleanup errors. */ }
    if (frame !== null) cancelAnimationFrame(frame);
    for (const row of [...layouts.keys()]) releaseRow(row);
    for (const [root, rootState] of roots) {
      rootState.events.abort();
      clearRootStyles(root);
    }
    roots.clear();
    view?.close(); service?.close(); storage.close(); preferences?.remove();
    Genre4allPlayerWaveform?.teardown?.();
    document.querySelectorAll('[data-g4a-menu-item],[data-g4a-profile-item]').forEach(n => n.remove()); style.remove();
    if (globalThis.Genre4all === api) delete globalThis.Genre4all;
  }
  window.addEventListener('pagehide', close, { once: true, signal: lifecycle.signal });
  window.addEventListener('resize', () => { invalidateLayouts(false, false); schedule(); }, { signal: lifecycle.signal });
  // React may replace metadata on a recycled DOM node without any attribute mutation.
  const recheck = setInterval(() => { if (!document.hidden) schedule(); }, 1500);
  lifecycle.signal.addEventListener('abort', () => clearInterval(recheck), { once: true });
  while (!closed && !globalThis.Spicetify?.Platform) await new Promise(resolve => setTimeout(resolve, 250));
  if (closed) return;
  try {
    globalThis.Spicetify?.Player?.addEventListener?.('onplaypause', schedule);
    globalThis.Spicetify?.Player?.addEventListener?.('songchange', schedule);
  } catch {}
  try {
    if (globalThis.Spicetify?.Menu?.Item) {
      profileMenuItem = new Spicetify.Menu.Item('Genre4all config', false, () => showPreferences(), CONFIG_ICON);
      profileMenuItem.register();
    }
  } catch { /* Fallback DOM injection handles profile menu. */ }
  service = Genre4allGenres.createService({
    storage,
    discogs: Genre4allTransport.createDiscogsAdapter(Genre4allGenres, () => service?.getConfig()),
    musicbrainz: Genre4allTransport.createMusicBrainzAdapter(Genre4allGenres, () => service?.getConfig()),
    spotify: Genre4allTransport.createSpotifyAdapter(Genre4allGenres, getMetadataClient),
    validateSpotifyGenre: Genre4allCatalog.validate,
    formatSpotifyGenres: Genre4allCatalog.format
  });
  view = Genre4allColumn.createController(service, {
    getUri, getTrack: track, getContext: context, isEnabled: cell => visible && cell.matches('.g4a-data'),
    onConfigure: showPreferences,
    describe: result => ({
      DISCOGS_TOKEN_REQUIRED: 'Configure sua chave de API do Discogs em Genre4all config.',
      DISCOGS_AUTH_FAILED: 'Chave de API do Discogs inválida ou sem permissão.',
      SPOTIFY_METADATA_UNAVAILABLE: 'O serviço de metadados está indisponível nesta versão do Spotify. Atualize Spicetify/Spotify e tente novamente.',
      SPOTIFY_TIMEOUT: 'O Spotify não respondeu a tempo. Use Atualizar gêneros.',
      SPOTIFY_TRACK_REQUIRED: 'Gêneros disponíveis para faixas do catálogo do Spotify.',
      SPOTIFY_EXTENSION_MISSING: 'Esta versão do Spotify não disponibilizou os metadados de gênero.'
    }[result.errorCode] || result.errorCode || 'Não foi possível obter gêneros para esta faixa.')
  });
  service.ready.catch(error => console.warn('[Genre4all] Falha ao iniciar cache.', error));
  unlisten = Spicetify.Platform.History?.listen?.(() => { view.reset(); invalidateLayouts(false, true); schedule(); });
  schedule();
  Genre4allPlayerWaveform?.init?.();
}
if (typeof document !== 'undefined') startGenre4all().catch(error => console.error('[Genre4all] Falha na inicialização.', error));
