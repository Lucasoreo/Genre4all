/* Native extra-column view. All genre data and request caching belong to genre-service.js. */
const Genre4allColumn = (() => {
  'use strict';
  const PALETTE = Object.freeze(['#f2b8d5', '#d6baf5', '#e9c5f2', '#c9bdf2', '#f4c4e1', '#dfb8df', '#e1ccf5', '#f6c9d4']);
  const INK = '#291c35';
  const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  function colorFor(key, colors = true) {
    let hash = 2166136261;
    for (const char of normalize(key)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
    return colors ? PALETTE[(hash >>> 0) % PALETTE.length] : '#ddd5e5';
  }
  const NAMES = { spotify: 'Spotify' };
  const SCOPES = { recording: 'Gravação / faixa (Spotify Metadata)' };
  const STATES = { queued: 'Aguardando', loading: 'Carregando…', success: 'Gêneros', empty: 'Sem gêneros', no_match: 'Sem correspondência', not_configured: 'Configurar gêneros', unsupported: 'Indisponível', rate_limited: 'Limite da fonte', error: 'Falha nos gêneros', cancelled: 'Cancelado', expired: 'Gêneros expirados' };
  const stateLabel = r => r.result?.reason === 'SOURCES_DISABLED' ? 'Fontes desativadas' : STATES[r.state] || STATES.error;
  function trackFromRow(row, uri, legacy) {
    if (legacy?.uri === uri && (legacy.name || legacy.title || legacy.metadata?.title)) return legacy;
    const titleCell = row.querySelector('[data-sp-layout-position="native:title"], .main-trackList-rowSectionStart, [role="gridcell"][aria-colindex="2"]');
    const title = (row.querySelector('.main-trackList-rowTitle, [data-testid="tracklist-row-title"], [data-testid="internal-track-link"]')
      || titleCell?.querySelector('[data-encore-id="text"][dir="auto"]'))?.textContent?.trim();
    const artists = [...row.querySelectorAll('a[href*="/artist/"]')].map(a => ({ name: a.textContent.trim() })).filter(a => a.name);
    const album = row.querySelector('a[href*="/album/"]')?.textContent?.trim();
    const duration = row.querySelector('.main-trackList-rowSectionEnd, [data-sp-layout-position="native:end"], [role="gridcell"]:last-of-type')?.textContent?.match(/\b(\d{1,2}):(\d{2})\b/u);
    const fromDOM = { uri, ...(title ? { name: title } : {}), artists: [...new Map(artists.map(a => [a.name, a])).values()], ...(album ? { album: { name: album } } : {}),
      ...(duration ? { duration_ms: (Number(duration[1]) * 60 + Number(duration[2])) * 1000 } : {}) };
    if (title && artists.length) return fromDOM;
    const seen = new Set();
    function find(value, depth = 10) {
      if (!value || typeof value !== 'object' || depth <= 0 || seen.has(value) || seen.size >= 300) return null;
      seen.add(value);
      if (value.uri === uri && typeof (value.name || value.title) === 'string') {
        const source = Array.isArray(value.artists) ? value.artists : value.artists?.items;
        const artists = (source || []).map(a => ({ name: typeof a === 'string' ? a : a.name || a.profile?.name || a.artist?.profile?.name })).filter(a => a.name);
        if (artists.length) return { ...value, uri, name: value.name || value.title, artists, album: value.album || value.albumOfTrack,
          duration_ms: value.duration_ms || value.duration?.totalMilliseconds || value.duration?.milliseconds };
      }
      for (const k of Object.keys(value)) if (['children', 'props', 'value', 'item', 'track', 'data', 'content', 'node'].includes(k) || /^\d+$/u.test(k)) {
        const found = find(value[k], depth - 1); if (found) return found;
      }
      return null;
    }
    const propsKey = Object.keys(row).find(k => k.startsWith('__reactProps$'));
    const fromProps = find(row[propsKey]); if (fromProps) return fromProps;
    const fiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber$'));
    let fiber = row[fiberKey];
    for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
      const found = find(fiber.memoizedProps) || find(fiber.pendingProps); if (found) return found;
      const parentUri = fiber.return?.memoizedProps?.uri;
      if (parentUri?.startsWith('spotify:track:') && parentUri !== uri) break;
    }
    return fromDOM;
  }
  function sourceLink(result) {
    try {
      const url = new URL(result.sourceUrl);
      const host = { spotify: 'open.spotify.com' }[result.selectedProvider || result.provider];
      return host && url.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.port ? url.href : null;
    } catch { return null; }
  }
  const CSS = `
    .g4a-genre-gridcell { min-width:0 !important; overflow:hidden; }
    .g4a-genre-host { display:flex !important; align-items:center; gap:4px; width:100%; min-width:0; max-width:100%; height:32px; max-height:32px; overflow:hidden; font:12px/1.2 sans-serif; }
    .g4a-genre-scroll { display:flex; align-items:center; gap:4px; flex:1 1 0; min-width:0; height:32px; overflow-x:auto; overflow-y:hidden; white-space:nowrap; scrollbar-width:thin; scrollbar-color:#bfa7d0 transparent; overscroll-behavior-x:contain; }
    .g4a-genre-scroll::-webkit-scrollbar { height:5px; }
    .g4a-genre-scroll::-webkit-scrollbar-thumb { background:#bfa7d0; border-radius:4px; }
    .g4a-genre-chip { display:inline-flex; align-items:center; flex:none; height:22px; box-sizing:border-box; border-radius:4px; padding:2px 6px; font:500 12px/18px sans-serif; white-space:nowrap; color:${INK} !important; background:var(--g4a-genre-color,#ddd5e5); text-shadow:none; }
    .g4a-genre-state { color:var(--spice-subtext,#ddd); white-space:nowrap; font-size:12px; }
    .g4a-genre-host .g4a-genre-detail { flex:none; width:24px; height:26px; min-height:0; padding:0; border:1px solid currentColor; border-radius:4px; color:var(--spice-text,#fff); background:var(--spice-main,#181818); cursor:pointer; font:700 16px/20px sans-serif; }
    .g4a-genre-host :focus-visible, .g4a-genre-dialog :focus-visible { outline:2px solid #7850a0; outline-offset:-2px; box-shadow:inset 0 0 0 4px #fff; }
    .g4a-genre-dialog { position:fixed; inset:0; margin:auto; width:min(520px,calc(100vw - 32px)); max-height:80vh; overflow:auto; padding:20px; border:1px solid #867292; border-radius:8px; background:var(--spice-main,#181818); color:var(--spice-text,#fff); font:14px/1.5 sans-serif; box-sizing:border-box; overflow-wrap:anywhere; }
    .g4a-genre-dialog::backdrop { background:#0009; }
    .g4a-genre-dialog h2 { font:700 19px/1.3 sans-serif; margin:0 0 12px; }
    .g4a-genre-dialog p { margin:8px 0; }
    .g4a-genre-dialog ul { display:flex; flex-wrap:wrap; gap:6px; padding:0; list-style:none; }
    .g4a-genre-dialog .g4a-genre-chip { height:auto; white-space:normal; overflow-wrap:anywhere; }
    .g4a-genre-dialog button { font:inherit; padding:5px 10px; margin:6px 8px 0 0; border:1px solid currentColor; border-radius:4px; color:inherit; background:transparent; cursor:pointer; }
    .g4a-genre-dialog a { color:var(--spice-text,#fff); text-decoration:underline; }
    @media (forced-colors:active) { .g4a-genre-chip { forced-color-adjust:none; background:Canvas; color:CanvasText !important; border:1px solid CanvasText; } .g4a-genre-host :focus-visible, .g4a-genre-dialog :focus-visible { outline:2px solid Highlight; box-shadow:none; } }
  `;
  function createController(service, options) {
    const doc = options.document || document, win = doc.defaultView;
    const records = new Map(), lifecycle = new AbortController();
    let active = 0, frame = null, closed = false, dialog = null;
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
    function expire(r) {
      if (['success', 'empty', 'no_match'].includes(r.state) && r.result?.expiresAt && r.result.expiresAt <= Date.now()) r.state = 'expired';
    }
    function chip(label, tag = 'span') {
      const n = node(tag, label.label, tag === 'li' ? {} : { role: 'listitem' }); n.className = 'g4a-genre-chip';
      n.style.setProperty('--g4a-genre-color', colorFor(label.key, service.getConfig().colors));
      n.title = (label.kinds || [label.kind]).includes('style') ? 'Estilo' : 'Gênero'; return n;
    }
    function render(r) {
      if (!valid(r)) return;
      expire(r);
      const focused = doc.activeElement, restore = r.cell.contains(focused) ? focused?.className : null;
      r.cell.replaceChildren(); r.cell.classList.add('g4a-genre-host'); r.cell.dataset.genreState = r.state;
      r.cell.setAttribute('aria-busy', String(r.state === 'loading'));
      const viewport = node('div', null, { class: 'g4a-genre-scroll', tabindex: '0', role: r.state === 'success' ? 'list' : 'group', 'aria-label': r.state === 'success' ? 'Gêneros e estilos; setas esquerda/direita para rolar, Enter para detalhes' : stateLabel(r) });
      if (r.state === 'success') for (const label of r.result.labels) viewport.append(chip(label));
      else viewport.append(node('span', stateLabel(r), { class: 'g4a-genre-state' }));
      viewport.addEventListener('keydown', e => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
          e.preventDefault(); e.stopPropagation();
          if (e.key === 'Home' || e.key === 'End') viewport.scrollLeft = e.key === 'Home' ? 0 : viewport.scrollWidth;
          else viewport.scrollLeft += e.key === 'ArrowLeft' ? -80 : 80;
        } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); showDetails(r); }
      });
      viewport.addEventListener('wheel', e => {
        if (e.deltaX || e.shiftKey) {
          e.stopPropagation();
          if (e.shiftKey && !e.deltaX && viewport.scrollWidth > viewport.clientWidth) { viewport.scrollLeft += e.deltaY; e.preventDefault(); }
        }
      }, { passive: false });
      const detail = node('button', '⋯', { type: 'button', class: 'g4a-genre-detail', 'aria-label': `Detalhes dos gêneros: ${stateLabel(r)}` });
      detail.addEventListener('click', () => showDetails(r));
      detail.addEventListener('keydown', e => { if (e.key !== 'Tab') e.stopPropagation(); });
      r.cell.append(viewport, detail);
      if (restore) r.cell.querySelector(restore.includes('g4a-genre-detail') ? 'button' : '.g4a-genre-scroll')?.focus({ preventScroll: true });
    }
    function closeDetails(restore = true) {
      if (!dialog) return;
      const current = dialog; dialog = null; current.element.close(); current.element.remove();
      if (restore && valid(current.record)) current.record.cell.querySelector('button')?.focus({ preventScroll: true });
    }
    function showDetails(r) {
      if (!valid(r)) return;
      expire(r);
      closeDetails(false);
      const d = node('dialog', null, { class: 'g4a-genre-dialog', 'aria-label': 'Detalhes dos gêneros' });
      const result = r.result, identity = service.identityFor(r.track);
      const headingText = identity.title ? `${identity.title}${identity.artists.length ? ' — ' + identity.artists.join(', ') : ''}` : identity.uri;
      d.append(node('h2', 'Detalhes dos gêneros'), node('p', headingText), node('p', stateLabel(r)));
      if (result) {
        d.append(node('p', `Fonte: ${NAMES[result.selectedProvider || result.provider] || 'Nenhuma fonte selecionada'}`));
        d.append(node('p', `Registro: ${result.entityType || '—'} · ${result.entityId || '—'}`));
        d.append(node('p', `Escopo: ${SCOPES[result.entityType] || 'Não determinado'}`));
        d.append(node('p', `Versão: ${identity.version}. ${result.match?.explanation || 'Correspondência confirmada por URI do Spotify.'}`));
        if (r.state === 'success') { const list = node('ul', null, { 'aria-label': 'Lista completa de gêneros e estilos' }); for (const label of result.labels) list.append(chip(label, 'li')); d.append(list); }
        const url = sourceLink(result); if (url) d.append(node('a', 'Abrir registro na fonte', { href: url, target: '_blank', rel: 'noopener noreferrer' }));
        if (r.state !== 'success') d.append(node('p', options.describe?.(result) || result.errorCode || result.reason || 'Nenhum gênero retornado.'));
        if (result.retryAt) d.append(node('p', `Nova tentativa após: ${new Date(result.retryAt).toLocaleString()}`));
      }
      const close = node('button', 'Fechar', { type: 'button' }); close.addEventListener('click', () => closeDetails()); d.append(close);
      const refresh = node('button', 'Atualizar gêneros desta faixa', { type: 'button' });
      refresh.disabled = r.state === 'loading' || (result?.retryAt > Date.now());
      refresh.addEventListener('click', () => {
        closeDetails();
        if (valid(r)) service.refresh(r.track, { signal: r.events.signal }).catch(() => {});
      }); d.append(refresh);
      const configure = node('button', 'Aparência dos gêneros', { type: 'button' });
      configure.addEventListener('click', () => { closeDetails(false); if (valid(r)) options.onConfigure?.(r.track); }); d.append(configure);
      d.addEventListener('cancel', e => { e.preventDefault(); closeDetails(); });
      for (const type of ['keydown', 'keyup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'contextmenu']) d.addEventListener(type, e => e.stopPropagation());
      doc.body.append(d); dialog = { element: d, record: r }; d.showModal(); close.focus();
    }
    function release(cell) {
      const r = records.get(cell); if (!r) return;
      records.delete(cell); r.events?.abort(); r.task?.abort(); clearTimeout(r.expiry);
      if (dialog?.record === r) closeDetails(false);
      if (![...records.values()].some(other => other.row === r.row)) observer?.unobserve(r.row);
      cell.replaceChildren(); cell.classList.remove('g4a-genre-host'); delete cell.dataset.genreState; cell.removeAttribute('aria-busy');
      if (r.gridcell && ![...records.values()].some(other => other.gridcell === r.gridcell)) r.gridcell.classList.remove('g4a-genre-gridcell');
    }
    function prune() { for (const r of records.values()) if (!valid(r)) release(r.cell); }
    function schedule() { if (!closed && frame === null) frame = win.requestAnimationFrame(pump); }
    function pump() {
      frame = null; prune();
      const candidates = [...records.values()].filter(r => r.visible && r.state === 'queued');
      candidates.sort((a, b) => Math.abs(a.row.getBoundingClientRect().top) - Math.abs(b.row.getBoundingClientRect().top));
      for (const r of candidates) { if (active >= 4) break; start(r); }
    }
    async function start(r) {
      if (!valid(r) || r.task) return;
      clearTimeout(r.expiry); r.state = 'loading'; r.result = null; render(r);
      const task = new AbortController(); r.task = task; active++;
      try {
        const result = await service.resolve(r.track, { signal: task.signal });
        if (!valid(r) || task.signal.aborted || result.configVersion !== r.revision) return;
        r.result = result; r.state = result.status;
        const expirable = ['success', 'empty', 'no_match'].includes(result.status);
        if (expirable && result.expiresAt && result.expiresAt <= Date.now()) r.state = 'expired';
        render(r);
        if (dialog?.record === r) showDetails(r);
        if (expirable && result.expiresAt > Date.now()) r.expiry = setTimeout(() => {
          if (!valid(r)) return;
          r.state = 'expired'; render(r); if (dialog?.record === r) closeDetails(false);
        }, Math.min(result.expiresAt - Date.now(), 2147483647));
      } catch { if (valid(r) && !task.signal.aborted) { r.result = { status: 'error', errorCode: 'GENRE_VIEW_FAILED' }; r.state = 'error'; render(r); } }
      finally { if (r.task === task) r.task = null; active--; if (valid(r) && r.state === 'loading' && task.signal.aborted) r.state = 'queued'; schedule(); }
    }
    const observer = typeof win.IntersectionObserver === 'function' ? new win.IntersectionObserver(entries => {
      for (const entry of entries) for (const r of records.values()) if (r.row === entry.target) {
        r.visible = entry.isIntersecting;
        if (!r.visible && r.task) { r.task.abort(); r.state = 'queued'; render(r); }
      }
      schedule();
    }, { rootMargin: '56px 0px' }) : null;
    function sync(container, configs) {
      if (closed || !container) return;
      const desired = new Set();
      for (const row of container.querySelectorAll('.main-trackList-trackListRow, [role="row"]')) {
        if (row.querySelector('[role="columnheader"]')) continue;
        for (const config of configs.filter(c => c.type === 'genre')) {
          const cell = row.querySelector(config.dataSelector); if (!cell || cell.closest('.main-trackList-trackListRow, [role="row"]') !== row) continue;
          const uri = options.getUri(row); if (!uri) continue;
          desired.add(cell);
          const track = options.getTrack(row), identityKey = service.identityFor(track).key;
          const previous = records.get(cell);
          if (previous && valid(previous) && previous.identityKey === identityKey && previous.cell.firstChild) continue;
          release(cell);
          const gridcell = cell.closest('[role="gridcell"]'); gridcell?.classList.add('g4a-genre-gridcell');
          const safeTrack = track?.uri === uri ? track : { uri };
          const rect = row.getBoundingClientRect();
          const initialVisible = rect.height > 0 && rect.bottom > -56 && rect.top < (win.innerHeight || 800) + 56;
          const r = { cell, row, track: safeTrack, identityKey, uri, context: options.getContext(), revision: service.revision, state: 'queued', result: null, visible: initialVisible, gridcell, events: new AbortController() };
          records.set(cell, r);
          for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu']) {
            const stop = e => e.stopPropagation(); cell.addEventListener(type, stop, { signal: r.events.signal });
          }
          cell.addEventListener('keyup', e => { if ([' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) e.stopPropagation(); }, { signal: r.events.signal });
          render(r); observer?.observe(row);
        }
      }
      for (const r of records.values()) if (container.contains(r.cell) && !desired.has(r.cell)) release(r.cell);
      prune(); fallbackVisibility(); schedule();
    }
    const unsubscribe = service.onChange(() => {
      for (const r of [...records.values()]) {
        if (r.revision !== service.revision) {
          r.task?.abort(); clearTimeout(r.expiry); r.revision = service.revision; r.state = 'queued'; r.result = null;
          if (dialog?.record === r) closeDetails(false);
        }
        render(r);
      }
      prune(); schedule();
    });
    function fallbackVisibility() {
      if (observer) return;
      for (const r of records.values()) { const rect = r.row.getBoundingClientRect(); r.visible = rect.height > 0 && rect.bottom > 0 && rect.top < win.innerHeight; }
      schedule();
    }
    if (!observer) { doc.addEventListener('scroll', fallbackVisibility, { capture: true, passive: true, signal: lifecycle.signal }); win.addEventListener('resize', fallbackVisibility, { signal: lifecycle.signal }); }
    function recheckExpiry() {
      if (doc.hidden || closed) return;
      for (const r of records.values()) if (r.result) {
        render(r);
        if (r.state === 'expired' && dialog?.record === r) closeDetails(false);
      }
      prune();
    }
    doc.addEventListener('visibilitychange', recheckExpiry, { signal: lifecycle.signal });
    win.addEventListener('focus', recheckExpiry, { signal: lifecycle.signal });
    function reset() { for (const cell of [...records.keys()]) release(cell); }
    function close() { reset(); closed = true; unsubscribe(); observer?.disconnect(); lifecycle.abort(); if (frame !== null) win.cancelAnimationFrame(frame); style.remove(); }
    return { sync, prune, reset, release, close, stats: () => ({ cells: records.size, active, observers: observer && !closed ? 1 : 0 }) };
  }
  return { PALETTE, INK, colorFor, sourceLink, trackFromRow, createController };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Genre4allColumn;
