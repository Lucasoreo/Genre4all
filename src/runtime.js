/* Standalone Spicetify integration. No Sort Play globals, buttons or settings are used. */
async function startGenre4all() {
  'use strict';
  const KEY = 'genre4all-visible-v1';
  const ROW = '.main-trackList-trackListHeaderRow,.main-trackList-trackListRow,[role="row"]';
  const ROOT = '.main-trackList-trackList,[data-testid="tracklist"],[role="grid"]';
  const CELL = '[role="columnheader"],[role="gridcell"],[class*="main-trackList-rowSection"]';
  const lifecycle = new AbortController(), roots = new Map(), layouts = new Map();
  let closed = false, frame = null, preferences = null, view = null, service = null;
  let visible = true, metadataClient = null, lastDiscovery = 0, unlisten = null;
  try { visible = localStorage.getItem(KEY) !== 'false'; } catch { /* Session preference still works. */ }
  const context = () => globalThis.Spicetify?.Platform?.History?.location?.pathname || location.pathname;
  const api = { version: '0.1.0-test', get visible() { return visible; }, setVisible, sync: schedule, close, diagnostics: () => ({ version: api.version, visible, context: context(), roots: roots.size, rows: layouts.size, service: service?.stats(), view: view?.stats(), metadataAvailable: !!metadataClient }) };
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
    .g4a-root .g4a-row:not([data-g4a-measure]) { grid-template-columns:var(--g4a-tracks) !important; min-width:var(--g4a-total) !important; }
    .g4a-root .g4a-row:not([data-g4a-measure]) > [data-g4a-position] { grid-column:var(--g4a-position) !important; min-width:0; }
    genre4all-column { display:flex; align-items:center; min-width:0; overflow:hidden; box-sizing:border-box; }
    genre4all-column[data-kind=header] { height:100%; color:var(--text-subdued,var(--spice-subtext,#b3b3b3)); font-size:14px; }
    genre4all-column .g4a-genre-host { width:100%; }
    [data-g4a-measure] > genre4all-column { display:none !important; }
    .g4a-root.g4a-root { overflow-x:auto !important; }
    .g4a-menu-button { display:flex; align-items:center; justify-content:space-between; gap:20px; width:100%; min-height:40px; padding:12px 16px; border:0; border-radius:2px; color:var(--text-base,#eee); background:transparent; text-align:left; font:inherit; cursor:pointer; }
    .g4a-menu-button:hover,.g4a-menu-button:focus-visible { background:#ffffff1a; outline-offset:-2px; }
    .g4a-menu-button[aria-checked=true] { color:var(--text-positive,#1ed760); }
    .g4a-menu-button svg { width:16px; height:16px; flex:none; fill:currentColor; }
    .g4a-preferences { position:fixed; inset:0; margin:auto; padding:24px; max-width:420px; width:calc(100vw - 40px); box-sizing:border-box; border:1px solid #777; border-radius:8px; color:var(--spice-text,#fff); background:var(--spice-main,#181818); font:14px/1.5 sans-serif; }
    .g4a-preferences::backdrop { background:#0009; }
    .g4a-preferences label { display:flex; gap:10px; margin:14px 0; align-items:center; }
    .g4a-preferences input { accent-color:#1ed760; }
    .g4a-preferences button { padding:8px 14px; color:inherit; background:transparent; border:1px solid #aaa; border-radius:4px; cursor:pointer; }
  `;
  document.head.append(style);

  function node(tag, text, attrs = {}) {
    const n = document.createElement(tag); if (text != null) n.textContent = text;
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
    return n;
  }
  function ownProperty(n, name, value) {
    if (n.style.getPropertyValue(name) !== value) n.style.setProperty(name, value);
  }
  function schedule() { if (!closed && frame === null) frame = requestAnimationFrame(sync); }
  function setVisible(value) {
    visible = !!value;
    try { localStorage.setItem(KEY, String(visible)); } catch { /* Keep the current session usable. */ }
    if (!visible) { view?.reset(); for (const row of [...layouts.keys()]) releaseRow(row); }
    updateMenus(); schedule();
  }

  // Adapted from Sort-Play-2 getWebpackService/getMetadataClient; scoped to this extension.
  function getMetadataClient() {
    if (metadataClient) return metadataClient;
    if (Date.now() - lastDiscovery < 3000) return null;
    lastDiscovery = Date.now();
    const chunk = window.rspackChunk ?? window.webpackChunkclient_web ?? window.rspackChunkclient_web;
    if (!chunk) return null;
    let req;
    try {
      const ret = chunk.push([[Symbol('genre4all')], {}, r => { req = r; return r; }]);
      if (!req && typeof ret === 'function') req = ret;
      if (!req?.m) return null;
      for (const id of Object.keys(req.m)) {
        let exports; try { exports = req(id); } catch { continue; }
        const candidates = [exports];
        if (exports && (typeof exports === 'object' || typeof exports === 'function')) {
          for (const key of Object.keys(exports)) { try { candidates.push(exports[key]); } catch { /* Lazy export. */ } }
        }
        const MetadataService = candidates.find(c => c?.SERVICE_ID === 'spotify.mdata_esperanto.proto.MetadataService');
        if (!MetadataService) continue;
        const platform = Spicetify.Platform;
        const transport = platform.ProductStateAPI?.productStateApi?.transport || platform.Transport || platform.PlayerAPI?._queue?._client?._transport;
        if (!transport) return null;
        metadataClient = new MetadataService(transport);
        return metadataClient;
      }
    } catch (error) { console.warn('[Genre4all] MetadataService indisponível.', error); }
    return null;
  }
  function getUri(row) {
    const seen = new Set();
    const valid = uri => typeof uri === 'string' && /^spotify:(track|local):/.test(uri);
    function find(value, depth = 10) {
      if (!value || typeof value !== 'object' || !depth || seen.has(value) || seen.size > 300) return null;
      seen.add(value);
      if (valid(value.uri)) return value.uri;
      for (const key of Object.keys(value)) if (['children','props','value','item','track','data','content','node','spec','_path'].includes(key) || /^\d+$/.test(key)) {
        const uri = find(value[key], depth - 1); if (uri) return uri;
      }
      return null;
    }
    // React identity wins over a stale DOM link in a recycled row.
    for (const element of [row, row.firstElementChild].filter(Boolean)) {
      const props = Object.keys(element).find(k => k.startsWith('__reactProps$'));
      const uri = find(element[props]); if (uri) return uri;
      const fiberKey = Object.keys(element).find(k => k.startsWith('__reactFiber$'));
      for (let f = element[fiberKey], i = 0; f && i < 8; f = f.return, i++) {
        const uri = find(f.pendingProps) || find(f.memoizedProps); if (uri) return uri;
      }
    }
    if (valid(row.dataset.uri)) return row.dataset.uri;
    const href = row.querySelector('a[href*="/track/"]')?.getAttribute('href');
    const id = href?.match(/\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/)?.[1];
    return id ? `spotify:track:${id}` : null;
  }
  function track(row) { return Genre4allColumn.trackFromRow(row, getUri(row)); }

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
    const d = node('dialog', null, { class: 'g4a-preferences', 'aria-label': 'Genre4all — aparência' });
    d.append(node('h2', 'Genre4all'));
    for (const [key, label] of [['colors','Cores nos gêneros'],['showGenres','Mostrar gêneros principais'],['showStyles','Mostrar subgêneros e estilos']]) {
      const row = node('label', label), input = node('input', null, { type: 'checkbox' });
      input.checked = service.getConfig()[key];
      input.addEventListener('change', () => service.configure({ [key]: input.checked }).catch(() => Spicetify.showNotification?.('Genre4all: não foi possível salvar a preferência.', true)));
      row.prepend(input); d.append(row);
    }
    const done = node('button', 'Fechar', { type: 'button' });
    const dismiss = () => { d.close(); d.remove(); if (preferences === d) preferences = null; };
    done.addEventListener('click', dismiss); d.addEventListener('cancel', e => { e.preventDefault(); dismiss(); });
    d.append(done); document.body.append(d); preferences = d; d.showModal();
  }

  function cells(container) { return [...container.children].filter(c => c.matches(CELL) && getComputedStyle(c).display !== 'none'); }
  function rowContainer(row) {
    if (cells(row).length) return row;
    if (row.children.length === 1 && cells(row.firstElementChild).length) return row.firstElementChild;
    return null;
  }
  function releaseRow(row) {
    const state = layouts.get(row); if (!state) return;
    view?.release(state.host); state.shell.remove(); layouts.delete(row);
    row.classList.remove('g4a-row'); row.removeAttribute('data-g4a-measure');
    row.style.removeProperty('--g4a-tracks'); row.style.removeProperty('--g4a-total');
    for (const c of state.positions) { c.removeAttribute('data-g4a-position'); c.style.removeProperty('--g4a-position'); }
  }
  function layout(row, header, root) {
    const container = rowContainer(row); if (!container || getComputedStyle(container).display !== 'grid') return;
    let state = layouts.get(container);
    if (!state) {
      const shell = node('genre4all-column', header ? 'Gênero' : null, { 'data-kind': header ? 'header' : 'data', title: 'Genre4all' });
      const host = header ? null : node('div', null, { class: 'g4a-data' });
      if (host) shell.append(host);
      state = { shell, host, positions: new Set(), root };
      layouts.set(container, state);
    }
    const foreign = cells(container); if (!foreign.length) return;
    const end = foreign.find(c => c.matches('.main-trackList-rowSectionEnd')) || foreign[foreign.length - 1];
    if (state.shell.parentElement !== container || state.shell.nextElementSibling !== end) container.insertBefore(state.shell, end);
    // Temporarily disable only our CSS to read the latest native/Sort Play layout.
    container.setAttribute('data-g4a-measure', '');
    const computed = getComputedStyle(container);
    const gap = parseFloat(computed.columnGap) || 0;
    const padding = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
    const raw = computed.gridTemplateColumns.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/).map(parseFloat);
    let widths = raw.length === foreign.length && raw.every(Number.isFinite) ? raw : foreign.map(c => c.getBoundingClientRect().width || 120);
    // Preserve named line positions by assigning our own numeric positions via separate properties.
    const width = 176;
    if (!root.hasAttribute('data-sp-native-layout')) {
      const title = foreign.findIndex(c => c.classList.contains('main-trackList-rowSectionStart'));
      const index = title >= 0 ? title : Math.min(1, widths.length - 1);
      widths[index] = Math.max(140, widths[index] - width - gap);
    }
    const insert = foreign.indexOf(end);
    widths.splice(insert, 0, width);
    const all = [...foreign]; all.splice(insert, 0, state.shell);
    const total = Math.ceil(widths.reduce((a,b) => a + b, 0) + gap * Math.max(0, widths.length - 1) + padding);
    const template = widths.map(w => `${Math.max(0,w)}px`).join(' ');
    ownProperty(container, '--g4a-tracks', template); ownProperty(container, '--g4a-total', `${total}px`);
    for (const c of state.positions) if (!all.includes(c)) { c.removeAttribute('data-g4a-position'); c.style.removeProperty('--g4a-position'); state.positions.delete(c); }
    all.forEach((c, i) => {
      if (!c.hasAttribute('data-g4a-position')) c.setAttribute('data-g4a-position', '');
      ownProperty(c, '--g4a-position', String(i + 1)); state.positions.add(c);
    });
    if (state.shell.getAttribute('aria-colindex') !== String(insert + 1)) state.shell.setAttribute('aria-colindex', String(insert + 1));
    container.classList.add('g4a-row'); container.removeAttribute('data-g4a-measure');
  }

  const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
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
  function updateMenus() {
    for (const item of document.querySelectorAll('[data-g4a-menu-item]')) {
      const button = item.querySelector('button'); if (!button) continue;
      button.setAttribute('aria-checked', String(visible));
      item.querySelector('svg').style.visibility = visible ? 'visible' : 'hidden';
    }
  }
  function injectMenus() {
    for (const menu of document.querySelectorAll('[role="menu"],.main-contextMenu-menu')) {
      if (!columnMenu(menu) || menu.querySelector('[data-g4a-menu-item]')) continue;
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
    }
    updateMenus();
  }

  // Observe native changes and virtualization; ignore our rendering and menu writes.
  const observer = new MutationObserver(records => {
    if (records.some(m => {
      if (m.target.closest?.('genre4all-column,[data-g4a-menu-item],.g4a-genre-dialog,.g4a-preferences')) return false;
      return m.type !== 'childList' || [...m.addedNodes, ...m.removedNodes].some(n => n.nodeType === 1 && !n.matches('genre4all-column,[data-g4a-menu-item]'));
    })) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-rowindex','data-uri','href','style','class'], characterData: true });
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;

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
        if (!roots.has(root)) { roots.set(root, {}); resize?.observe(root); }
        root.classList.toggle('g4a-root', visible);
        if (visible) {
          for (const row of rows) {
            const header = !!row.querySelector('[role="columnheader"]');
            if (header || getUri(row)) layout(row, header, root);
          }
          view?.sync(root, [{ type: 'genre', dataSelector: '.g4a-data' }]);
        }
      }
      for (const [row, state] of layouts) if (!row.isConnected || !found.has(state.root) || !row.contains(state.shell)) releaseRow(row);
      for (const root of roots.keys()) if (!found.has(root)) { roots.delete(root); root.classList.remove('g4a-root'); resize?.unobserve(root); }
      view?.prune();
    } catch (error) { console.error('[Genre4all] Falha ao atualizar coluna.', error); }
    // Only synchronous writes from this pass are discarded. Async results remain observable.
    observer.takeRecords();
  }
  function close() {
    if (closed) return;
    closed = true; lifecycle.abort(); observer.disconnect(); resize?.disconnect(); unlisten?.();
    if (frame !== null) cancelAnimationFrame(frame);
    for (const row of [...layouts.keys()]) releaseRow(row);
    for (const root of roots.keys()) root.classList.remove('g4a-root'); roots.clear();
    view?.close(); service?.close(); storage.close(); preferences?.remove();
    document.querySelectorAll('[data-g4a-menu-item]').forEach(n => n.remove()); style.remove();
    if (globalThis.Genre4all === api) delete globalThis.Genre4all;
  }
  window.addEventListener('pagehide', close, { once: true, signal: lifecycle.signal });
  window.addEventListener('resize', schedule, { signal: lifecycle.signal });
  // React may replace metadata on a recycled DOM node without any attribute mutation.
  const recheck = setInterval(() => { if (!document.hidden) schedule(); }, 1500);
  lifecycle.signal.addEventListener('abort', () => clearInterval(recheck), { once: true });
  while (!closed && !globalThis.Spicetify?.Platform) await new Promise(resolve => setTimeout(resolve, 250));
  if (closed) return;
  service = Genre4allGenres.createService({ storage, spotify: Genre4allTransport.createSpotifyAdapter(Genre4allGenres, getMetadataClient), validateSpotifyGenre: Genre4allCatalog.validate, formatSpotifyGenres: Genre4allCatalog.format });
  view = Genre4allColumn.createController(service, {
    getUri, getTrack: track, getContext: context, isEnabled: cell => visible && cell.matches('.g4a-data'),
    onConfigure: showPreferences,
    describe: result => ({ SPOTIFY_METADATA_UNAVAILABLE: 'O serviço de metadados está indisponível nesta versão do Spotify. Atualize Spicetify/Spotify e tente novamente.', SPOTIFY_TIMEOUT: 'O Spotify não respondeu a tempo. Use Atualizar gêneros desta faixa.', SPOTIFY_TRACK_REQUIRED: 'Gêneros disponíveis para faixas do catálogo do Spotify.', SPOTIFY_EXTENSION_MISSING: 'Esta versão do Spotify não disponibilizou os metadados de gênero.' }[result.errorCode] || result.errorCode || 'O Spotify não retornou gêneros para esta faixa.')
  });
  service.ready.catch(error => console.warn('[Genre4all] Falha ao iniciar cache.', error));
  unlisten = Spicetify.Platform.History?.listen?.(() => { view.reset(); schedule(); });
  schedule();
}
if (typeof document !== 'undefined') startGenre4all().catch(error => console.error('[Genre4all] Falha na inicialização.', error));
