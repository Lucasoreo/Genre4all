/* Shared native tracklist layout. MIT, hoeci and contributors. No genre requests here. */
const SortPlayNativeLayout = (() => {
  'use strict';
  const STORAGE_KEY = 'sort-play-native-column-layout-v1';
  const CONTEXTS = Object.freeze({ playlist: 'Playlist', liked: 'Curtidas', search: 'Busca', local: 'Arquivos locais', album: 'Álbum', artist: 'Artista', recommendations: 'Recomendações' });
  const NATIVE = Object.freeze({
    index: { label: '#', min: 16, max: 16, initial: 16, fixed: true },
    title: { label: 'Título', min: 200, max: 1000, initial: 280 },
    album: { label: 'Álbum', min: 100, max: 700, initial: 180 },
    artist: { label: 'Artista', min: 100, max: 700, initial: 160 },
    added: { label: 'Adicionada em', min: 104, max: 400, initial: 144 },
    plays: { label: 'Reproduções', min: 72, max: 400, initial: 110 },
    tempo: { label: 'BPM nativo', min: 64, max: 400, initial: 80 },
    key: { label: 'Tom nativo', min: 64, max: 400, initial: 80 },
    end: { label: 'Duração / controles', min: 120, max: 400, initial: 144 }
  });
  const EXTRA_LABELS = { genre: 'Genre', tempo: 'BPM', key: 'Key', djInfo: 'DJ Info', playCount: 'Plays', popularity: 'Popularity', releaseDate: 'Rel. Date', trueReleaseDate: 'True Date', scrobbles: 'Scrobbles', personalScrobbles: 'My Scrobbles', lastScrobbled: 'Last Played', energy: 'Energy', danceability: 'Dance', valence: 'Valence' };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, Math.round(n)));
  const validId = id => /^native:(title|album|artist|added|plays|tempo|key|end)$/u.test(id) || /^extra:(playlist1|playlist2|album|artist):[a-zA-Z][a-zA-Z0-9]{0,39}$/u.test(id);
  const fresh = () => ({ version: 1, contexts: {} });
  function parseSaved(raw) {
    try {
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (value?.version !== 1) return fresh();
      const output = fresh();
      for (const context of Object.keys(CONTEXTS)) {
        const saved = value.contexts?.[context]; if (!saved || typeof saved !== 'object') continue;
        const widths = {};
        for (const [id, width] of Object.entries(saved.widths || {}).slice(0, 80)) if (validId(id) && Number.isFinite(width)) widths[id] = clamp(width, 64, 1000);
        output.contexts[context] = { gap: Number.isFinite(saved.gap) ? clamp(saved.gap, 0, 48) : 16, widths };
      }
      return output;
    } catch { return fresh(); }
  }
  function extra(slot, type) {
    const wide = type === 'genre' || type === 'djInfo';
    const label = EXTRA_LABELS[type] || type;
    const date = ['releaseDate', 'trueReleaseDate', 'lastScrobbled'].includes(type);
    return { id: `extra:${slot}:${type}`, label, controlLabel: `${label} — ${ { playlist1: 'extra 1', playlist2: 'extra 2', album: 'extra do álbum', artist: 'extra do artista' }[slot] || slot }`, min: date ? 104 : wide ? 100 : 64, max: wide ? 800 : 600, initial: type === 'genre' ? 200 : wide ? 160 : date ? 128 : 110, persist: true };
  }
  function native(type, ordinal) { return { id: 'native:' + type, ...NATIVE[type], persist: !NATIVE[type].fixed, ordinal }; }
  function compose(columns, saved = {}, available = 800, padding = 0) {
    const gap = Number.isFinite(saved.gap) ? clamp(saved.gap, 0, 48) : 16;
    const widths = columns.map(c => clamp(Number.isFinite(saved.widths?.[c.id]) ? saved.widths[c.id] : c.initial, c.min, c.max));
    const title = columns.findIndex(c => c.id === 'native:title');
    if (title >= 0 && !Number.isFinite(saved.widths?.['native:title'])) {
      const remaining = available - padding - gap * (columns.length - 1) - widths.reduce((sum, w, i) => sum + (i === title ? 0 : w), 0);
      widths[title] = clamp(remaining, columns[title].min, columns[title].max);
    }
    const total = widths.reduce((sum, w) => sum + w, 0) + Math.max(0, columns.length - 1) * gap + padding;
    const template = widths.map((width, i) => `[${i === 0 ? 'index' : i === 1 ? 'first' : i === widths.length - 1 ? 'last' : 'var' + (i - 1)}] ${width}px`).join(' ');
    return { widths, gap, total, template };
  }
  const ROWS = '.main-trackList-trackListHeaderRow, .main-trackList-trackListRow, .main-trackList-trackListRowGrid, [role="row"]';
  const CSS = `
    [data-sp-native-layout] { min-width:0 !important; max-width:100%; overflow-x:clip !important; overflow-y:visible; }
    [data-sp-native-layout] .sp-layout-grid { display:grid !important; grid-template-columns:var(--sp-layout-tracks) !important; column-gap:var(--sp-layout-gap) !important; width:100% !important; min-width:var(--sp-layout-total) !important; padding-left:var(--sp-layout-left) !important; padding-right:var(--sp-layout-right) !important; box-sizing:border-box !important; translate:calc(-1 * var(--sp-layout-offset,0px)) 0; }
    [data-sp-native-layout] .sp-layout-branch { min-width:var(--sp-layout-total) !important; box-sizing:border-box; }
    [data-sp-native-layout] .sp-layout-outer { display:block !important; }
    [data-sp-native-layout] [data-sp-layout-position] { min-width:0; grid-column:var(--sp-layout-position) !important; }
    [data-sp-native-layout] .sp-layout-heading { position:relative; overflow:visible; }
    [data-sp-native-layout] .sp-layout-heading [role="separator"]:not(.sp-layout-resize), [data-sp-native-layout] .sp-layout-heading [role="slider"] { display:none !important; }
    .sp-layout-resize { position:absolute; inset-block:0; right:-5px; width:12px; min-height:24px; z-index:4; cursor:col-resize; touch-action:none; user-select:none; background:transparent; border:0; padding:0; }
    .sp-layout-resize::after { content:''; position:absolute; top:15%; bottom:15%; left:5px; width:2px; border-radius:2px; background:var(--spice-subtext,#bbb); opacity:.5; }
    .sp-layout-resize:hover::after, .sp-layout-resize:focus-visible::after { opacity:1; }
    .sp-layout-resize:focus-visible { outline:2px solid #7850a0; outline-offset:-2px; box-shadow:inset 0 0 0 4px #fff; }
    .sp-layout-rec-header { height:32px; align-items:center; font:12px/1.2 sans-serif; color:var(--spice-subtext,#bbb); border-bottom:1px solid #666; }
    .sp-layout-rec-header > div { height:100%; display:flex; align-items:center; }
    .sp-layout-scrollbar { width:var(--sp-layout-viewport) !important; max-width:var(--sp-layout-viewport); min-width:0 !important; height:18px; overflow-x:auto; overflow-y:hidden; scrollbar-width:thin; scrollbar-color:var(--spice-subtext,#aaa) transparent; position:sticky; z-index:3; background:var(--spice-main,#181818); }
    .sp-layout-scrollbar[hidden] { display:none; }
    .sp-layout-scrollbar > div { width:var(--sp-layout-total); height:1px; pointer-events:none; }
    .sp-layout-scrollbar:focus-visible { outline:2px solid #7850a0; outline-offset:-2px; box-shadow:inset 0 0 0 4px #fff; }
    html.sp-layout-dragging, html.sp-layout-dragging * { cursor:col-resize !important; user-select:none !important; }
    @media(forced-colors:active) { .sp-layout-resize::after { background:CanvasText; } .sp-layout-resize:focus-visible,.sp-layout-scrollbar:focus-visible { outline-color:Highlight; box-shadow:none; } }
  `;
  function createController(options = {}) {
    const doc = options.document || document, win = doc.defaultView, storage = options.storage || win.localStorage;
    let saved; try { saved = parseSaved(storage.getItem(STORAGE_KEY)); } catch { saved = fresh(); }
    const roots = new Map(), subscribers = new Set(), lifecycle = new AbortController();
    let drag = null, resizeFrame = null, closed = false, lastError = '', nextRoot = 0, clearClickGuard = null;
    const style = doc.createElement('style'); style.id = 'sort-play-native-layout-style'; style.textContent = CSS; doc.head.append(style);
    const notify = () => { for (const fn of subscribers) fn(); };
    const preferences = context => saved.contexts[context] || { gap: 16, widths: {} };
    function edit(context) { return saved.contexts[context] ||= { gap: 16, widths: {} }; }
    function persist() {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(saved)); lastError = ''; }
      catch { lastError = 'Não foi possível salvar o layout neste cliente. Os ajustes atuais ainda estão visíveis.'; }
      notify();
    }
    function ownClass(state, node, name) {
      if (!state.classes.has(node)) state.classes.set(node, new Set());
      node.classList.add(name); state.classes.get(node).add(name);
    }
    function ownStyle(state, node, name, value) {
      let fields = state.styles.get(node); if (!fields) { fields = new Map(); state.styles.set(node, fields); }
      if (!fields.has(name)) fields.set(name, name.startsWith('--sp-layout-') ? ['', ''] : [node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]);
      if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
    }
    function ownAttr(state, node, name, value) {
      let fields = state.attrs.get(node); if (!fields) { fields = new Map(); state.attrs.set(node, fields); }
      if (!fields.has(name)) fields.set(name, { before: name.startsWith('data-sp-') ? null : node.getAttribute(name), last: value });
      fields.get(name).last = value;
      if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    }
    function apply(state) {
      const prefs = preferences(state.context);
      const layout = compose(state.columns, { ...prefs, widths: { ...prefs.widths, ...state.transient } }, state.available, state.padding.left + state.padding.right);
      state.layout = layout;
      ownStyle(state, state.root, '--sp-layout-tracks', layout.template);
      ownStyle(state, state.root, '--sp-layout-gap', layout.gap + 'px');
      ownStyle(state, state.root, '--sp-layout-total', layout.total + 'px');
      ownStyle(state, state.root, '--sp-layout-viewport', state.available + 'px');
      ownStyle(state, state.root, '--sp-layout-left', state.padding.left + 'px'); ownStyle(state, state.root, '--sp-layout-right', state.padding.right + 'px');
      if (state.scrollbar) {
        state.scrollbar.hidden = layout.total <= state.available;
        setScroll(state, state.scrollbar.scrollLeft);
      }
      for (const [handle, column] of state.handles) {
        const width = layout.widths[state.columns.indexOf(column)];
        handle.setAttribute('aria-valuenow', String(width)); handle.setAttribute('aria-valuetext', width + ' pixels');
      }
    }
    function applyContext(context) { for (const state of roots.values()) if (state.context === context) apply(state); notify(); }
    function columnFor(context, id) { for (const state of roots.values()) if (state.context === context) { const col = state.columns.find(c => c.id === id); if (col) return col; } return null; }
    function setWidth(context, id, value, commit = true) {
      const col = columnFor(context, id); if (!col || col.fixed || !Number.isFinite(Number(value))) return;
      if (drag) finishDrag(false);
      const width = clamp(Number(value), col.min, col.max);
      if (col.persist) edit(context).widths[id] = width;
      else { for (const state of roots.values()) if (state.context === context) state.transient[id] = width; }
      applyContext(context); if (commit && col.persist) persist();
    }
    function setGap(context, value) {
      if (!Object.hasOwn(CONTEXTS, context) || !Number.isFinite(Number(value))) return;
      if (drag) finishDrag(false);
      edit(context).gap = clamp(Number(value), 0, 48); applyContext(context); persist();
    }
    function restore(context) {
      if (drag) finishDrag(false);
      delete saved.contexts[context]; for (const state of roots.values()) if (state.context === context) state.transient = {};
      applyContext(context); persist();
    }
    function detect(cells, context, extras, rootId) {
      const columns = [], used = new Set(); let ordinal = 0;
      if (context === 'recommendations') columns.push(native('index', -1));
      for (const cell of cells) {
        const slot = slotFor(cell, context), type = extras[slot];
        let col;
        if (slot && type) col = extra(slot, type);
        else {
          // Own handles and native resize sliders contain numeric values; exclude
          // those controls when identifying the semantic native column.
          const semantic = cell.cloneNode(true); semantic.querySelectorAll('.sp-layout-resize,[role="slider"],[role="separator"]').forEach(n => n.remove());
          const text = (cell.getAttribute('data-testid') || '') + ' ' + (semantic.textContent || '');
          const name = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
          let kind = cell.classList.contains('main-trackList-rowSectionEnd') || ordinal === cells.filter(c => !slotFor(c, context)).length - 1 ? 'end' :
            ordinal === 0 ? context === 'recommendations' ? 'title' : 'index' : ordinal === 1 && context !== 'recommendations' ? 'title' :
            /\bbpm\b|\btempo\b/u.test(name) ? 'tempo' : /\btom\b|\bkey\b/u.test(name) ? 'key' : /album|release-title/u.test(name) || cell.querySelector('a[href*="/album/"]') ? 'album' : /artist|artista/u.test(name) || cell.querySelector('a[href*="/artist/"]') ? 'artist' : /date.add|added|adicionad/u.test(name) ? 'added' : /plays|play.count|reprodu/u.test(name) || ordinal === 2 && ['album', 'artist'].includes(context) ? 'plays' : null;
          if (kind && used.has(kind)) kind = null;
          if (kind) { col = native(kind, ordinal); used.add(kind); }
          else col = { id: `unknown:${rootId}:${ordinal}`, label: 'Coluna externa ' + ordinal, min: 80, max: 700, initial: 144, persist: false, ordinal };
          ordinal++;
        }
        columns.push(col);
      }
      return columns;
    }
    function slotFor(cell, context) {
      if (cell.matches('.sort-play-second-column,.sort-play-second-data-column,.sort-play-second-skeleton-col')) return 'playlist2';
      if (cell.matches('.sort-play-album-col-header,.sort-play-album-col,.sort-play-album-skeleton-col')) return 'album';
      if (cell.matches('.sort-play-artist-col-header,.sort-play-artist-col,.sort-play-artist-skeleton-col')) return 'artist';
      if (cell.matches('.sort-play-column,.sort-play-data-column,.sort-play-skeleton-col')) return context === 'album' ? 'album' : context === 'artist' ? 'artist' : 'playlist1';
      return null;
    }
    const visibleCells = row => row ? [...row.children].filter(c => c.style.display !== 'none' && (c.matches('[role="gridcell"],[role="columnheader"],[class*="main-trackList-rowSection"],[class*="sort-play-"][class*="skeleton-col"]'))) : [];
    function bindRow(state, row) {
      let container = row;
      if (!visibleCells(row).length && row.children.length === 1 && visibleCells(row.firstElementChild).length) {
        ownClass(state, row, 'sp-layout-outer'); container = row.firstElementChild;
      }
      const cells = visibleCells(container); if (!cells.length) return;
      ownClass(state, container, 'sp-layout-grid');
      for (let parent = container.parentElement; parent && parent !== state.root; parent = parent.parentElement) ownClass(state, parent, 'sp-layout-branch');
      let ordinal = 0;
      for (const cell of cells) {
        const slot = slotFor(cell, state.context);
        const generated = container === state.generatedHeader;
        let col;
        if (generated) col = state.columns[cells.indexOf(cell)];
        else if (slot) col = state.columns.find(c => c.id === `extra:${slot}:${state.extras[slot]}`);
        else {
          const kind = cell.classList.contains('main-trackList-rowSectionEnd') ? 'end' : cell.classList.contains('main-trackList-rowSectionStart') ? 'title' : cell.classList.contains('main-trackList-rowSectionIndex') && state.context !== 'recommendations' ? 'index' : null;
          col = kind ? state.columns.find(c => c.id === 'native:' + kind) : state.columns.find(c => c.ordinal === ordinal);
          ordinal++;
        }
        if (!col) continue;
        const index = state.columns.indexOf(col);
        const position = !generated && state.context === 'recommendations' && col.id === 'native:title' ? '1 / span 2' : `${index + 1} / span 1`;
        ownStyle(state, cell, '--sp-layout-position', position); ownAttr(state, cell, 'data-sp-layout-position', col.id);
        if (cell.matches('[role="gridcell"],[role="columnheader"]')) {
          ownAttr(state, cell, 'aria-colindex', position.startsWith('1 / span 2') ? '1' : String(index + 1));
          if (position.startsWith('1 / span 2')) ownAttr(state, cell, 'aria-colspan', '2');
        }
        if (cell.getAttribute('role') === 'columnheader' && !col.fixed) {
          ownClass(state, cell, 'sp-layout-heading');
          let handle = cell.querySelector(':scope > .sp-layout-resize');
          if (handle && handle.dataset.column !== col.id) { handle.remove(); handle = null; }
          if (!handle) {
            handle = doc.createElement('span'); handle.className = 'sp-layout-resize'; handle.dataset.column = col.id;
            handle.setAttribute('role', 'separator'); handle.tabIndex = 0; handle.setAttribute('aria-orientation', 'vertical');
            cell.append(handle);
          }
          handle.setAttribute('aria-label', `Largura de ${col.controlLabel || col.label} (${CONTEXTS[state.context]})`);
          handle.setAttribute('aria-valuemin', String(col.min)); handle.setAttribute('aria-valuemax', String(col.max));
          state.handles.set(handle, col);
        }
      }
    }
    function validState(state) { return state.root.isConnected && (!options.getContext || state.token === options.getContext()) && (!options.isEnabled || options.isEnabled(state.context)); }
    function setScroll(state, offset) {
      const max = Math.max(0, (state.layout?.total || 0) - state.available);
      const value = Math.max(0, Math.min(max, offset));
      if (state.scrollbar && Math.abs(state.scrollbar.scrollLeft - value) > .5) state.scrollbar.scrollLeft = value;
      ownStyle(state, state.root, '--sp-layout-offset', value + 'px');
    }
    function previewDrag() {
      if (!drag) return;
      const d = drag; if (d.frame !== null) win.cancelAnimationFrame(d.frame); d.frame = null;
      if (!validState(d.state) || !d.handle.isConnected) { finishDrag(false); return; }
      d.value = clamp(d.startWidth + (d.x - d.startX) * d.sign, d.col.min, d.col.max);
      if (d.col.persist) edit(d.state.context).widths[d.col.id] = d.value; else d.state.transient[d.col.id] = d.value;
      applyContext(d.state.context);
    }
    function finishDrag(commit) {
      if (!drag) return;
      const d = drag;
      if (d.frame !== null) { win.cancelAnimationFrame(d.frame); if (commit) previewDrag(); }
      if (!drag) return;
      drag = null; d.events.abort(); doc.documentElement.classList.remove('sp-layout-dragging');
      try { if (d.handle.hasPointerCapture(d.pointerId)) d.handle.releasePointerCapture(d.pointerId); } catch {}
      if (!commit || d.value === d.startWidth) {
        const widths = d.col.persist ? edit(d.state.context).widths : d.state.transient;
        if (d.before === undefined) delete widths[d.col.id]; else widths[d.col.id] = d.before;
        applyContext(d.state.context);
      } else if (d.value !== d.startWidth && d.col.persist) persist();
    }
    function guardGestureClick(state, pointerId) {
      clearClickGuard?.();
      const guard = new AbortController();
      let timer, frame;
      const cleanup = () => { guard.abort(); clearTimeout(timer); if (frame != null) win.cancelAnimationFrame(frame); if (clearClickGuard === cleanup) clearClickGuard = null; };
      clearClickGuard = cleanup;
      // After rollback/teardown, the pointer may be over a native cell instead of the removed handle.
      // Keep only this physical gesture's residual click from sorting/selecting that native cell.
      doc.addEventListener('click', e => {
        if (e.detail > 0 && e.composedPath().includes(state.root)) { e.preventDefault(); e.stopImmediatePropagation(); cleanup(); }
      }, { capture: true, signal: guard.signal });
      doc.addEventListener('pointerup', e => { if (e.pointerId === pointerId) frame = win.requestAnimationFrame(cleanup); }, { capture: true, signal: guard.signal });
      doc.addEventListener('pointerdown', e => { if (e.pointerId === pointerId) cleanup(); }, { capture: true, signal: guard.signal });
      timer = setTimeout(cleanup, 10000); // A lost window gesture may never deliver pointerup.
    }
    function beginDrag(state, handle, e) {
      if (e.button !== 0 || !state.handles.has(handle)) return;
      finishDrag(false); handle.focus({ preventScroll: true });
      const col = state.handles.get(handle), events = new AbortController();
      drag = { state, col, handle, events, pointerId: e.pointerId, startX: e.clientX, x: e.clientX, sign: win.getComputedStyle(state.root).direction === 'rtl' ? -1 : 1,
        startWidth: state.layout.widths[state.columns.indexOf(col)], value: state.layout.widths[state.columns.indexOf(col)], before: col.persist ? preferences(state.context).widths[col.id] : state.transient[col.id], frame: null };
      guardGestureClick(state, e.pointerId);
      doc.documentElement.classList.add('sp-layout-dragging');
      try { handle.setPointerCapture(e.pointerId); } catch {}
      doc.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault(); event.stopImmediatePropagation(); drag.x = event.clientX;
        if (drag.frame === null) drag.frame = win.requestAnimationFrame(previewDrag);
      }, { capture: true, passive: false, signal: events.signal });
      doc.addEventListener('pointerup', event => { if (event.pointerId === drag?.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); drag.x = event.clientX; previewDrag(); finishDrag(true); } }, { capture: true, signal: events.signal });
      doc.addEventListener('pointercancel', event => { if (event.pointerId === drag?.pointerId) { event.stopImmediatePropagation(); finishDrag(false); } }, { capture: true, signal: events.signal });
      handle.addEventListener('lostpointercapture', () => finishDrag(false), { signal: events.signal });
      win.addEventListener('blur', () => finishDrag(false), { signal: events.signal });
      doc.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finishDrag(false); } }, { capture: true, signal: events.signal });
    }
    function attachEvents(state) {
      for (const type of ['pointerdown', 'click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu', 'keydown', 'keyup']) state.root.addEventListener(type, e => {
        if (e.target.closest?.('.sp-layout-scrollbar')) {
          e.stopImmediatePropagation();
          if (type === 'keydown' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault(); setScroll(state, e.key === 'Home' ? 0 : e.key === 'End' ? state.layout.total : state.scrollbar.scrollLeft + (e.key === 'ArrowLeft' ? -80 : 80));
          }
          return;
        }
        const handle = e.target.closest?.('.sp-layout-resize'); if (!handle || !state.handles.has(handle)) return;
        e.stopImmediatePropagation();
        if (type === 'pointerdown') { e.preventDefault(); beginDrag(state, handle, e); }
        if (type === 'keydown' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
          e.preventDefault(); const col = state.handles.get(handle), current = state.layout.widths[state.columns.indexOf(col)];
          setWidth(state.context, col.id, e.key === 'Home' ? col.min : e.key === 'End' ? col.max : current + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 32 : 8));
        }
      }, { capture: true, signal: state.events.signal });
      state.root.addEventListener('wheel', e => {
        if ((!e.deltaX && !e.shiftKey) || e.target.closest?.('.sp-genre-scroll')) return;
        const before = state.scrollbar?.scrollLeft || 0;
        setScroll(state, before + (e.deltaX || e.deltaY));
        if (before !== state.scrollbar?.scrollLeft) { e.preventDefault(); e.stopPropagation(); }
      }, { passive: false, signal: state.events.signal });
      state.root.addEventListener('focusin', e => {
        if (e.target.closest?.('.sp-layout-scrollbar') || !e.target.closest?.('.sp-layout-grid')) return;
        const bounds = e.target.getBoundingClientRect(), viewport = state.root.getBoundingClientRect();
        const delta = bounds.right > viewport.right ? bounds.right - viewport.right + 8 : bounds.left < viewport.left ? bounds.left - viewport.left - 8 : 0;
        if (delta) setScroll(state, (state.scrollbar?.scrollLeft || 0) + delta);
      }, { signal: state.events.signal });
    }
    function release(root) {
      const state = roots.get(root); if (!state) return;
      if (drag?.state === state) finishDrag(false);
      roots.delete(root); resizeObserver?.unobserve(root); state.events.abort(); state.generatedHeader?.remove(); state.scrollbar?.remove();
      if (state.scrollFrame != null) win.cancelAnimationFrame(state.scrollFrame);
      for (const handle of state.handles.keys()) handle.remove();
      for (const node of new Set([...state.styles.keys(), ...state.attrs.keys(), ...state.classes.keys()])) restoreNode(state, node);
      root.scrollLeft = 0; notify();
    }
    function restoreNode(state, node) {
      for (const [name, [value, priority]] of state.styles.get(node) || []) { if (value) node.style.setProperty(name, value, priority); else node.style.removeProperty(name); }
      for (const [name, value] of state.attrs.get(node) || []) if (node.getAttribute(name) === value.last) { if (value.before === null) node.removeAttribute(name); else node.setAttribute(name, value.before); }
      for (const name of state.classes.get(node) || []) node.classList.remove(name);
      state.styles.delete(node); state.attrs.delete(node); state.classes.delete(node);
    }
    function prune() { for (const state of roots.values()) if (!validState(state)) release(state.root); }
    function sync(root, { context, extras = {}, enabled = true } = {}) {
      if (closed || !root || !Object.hasOwn(CONTEXTS, context)) return;
      let header = root.querySelector('.sort-play-artist-header-wrapper .main-trackList-trackListHeaderRow') || root.querySelector('.main-trackList-trackListHeaderRow, [role="row"]:has([role="columnheader"])');
      const canonical = (header || root.querySelector('.main-trackList-trackListRow,[role="row"]'))?.closest('.main-trackList-trackList,[role="grid"]');
      if (canonical && root.contains(canonical)) root = canonical;
      if (!enabled) { release(root); return; }
      prune();
      let state = roots.get(root);
      if (state && state.context !== context) { release(root); state = null; }
      if (!state) {
        const padding = win.getComputedStyle(header || root.querySelector(ROWS) || root);
        state = { root, context, id: ++nextRoot, token: options.getContext?.(), columns: [], extras, classes: new Map(), styles: new Map(), attrs: new Map(), handles: new Map(), events: new AbortController(), transient: {}, padding: { left: parseFloat(padding.paddingLeft) || 0, right: parseFloat(padding.paddingRight) || 0 } };
        roots.set(root, state); ownAttr(state, root, 'data-sp-native-layout', context);
        if (!root.hasAttribute('tabindex')) ownAttr(state, root, 'tabindex', '0');
        if (!root.hasAttribute('aria-label')) ownAttr(state, root, 'aria-label', `${CONTEXTS[context]} — rolagem horizontal das colunas`);
        attachEvents(state); resizeObserver?.observe(root);
      }
      state.available = root.clientWidth;
      state.extras = extras;
      const sample = header || root.querySelector('.main-trackList-trackListRow, [role="row"]'); if (!sample) return;
      let cells = visibleCells(sample); if (!cells.length && sample.firstElementChild) cells = visibleCells(sample.firstElementChild);
      // Recommendations combine the index/title into one native cell. Infer from real cells before adding our header.
      const oldSignature = JSON.stringify(state.columns.map(c => c.id));
      if (context === 'recommendations') {
        const row = root.querySelector('.main-trackList-trackListRow, [role="row"]:not(.sp-layout-rec-header)');
        if (row) { cells = visibleCells(row); if (!cells.length) cells = visibleCells(row.firstElementChild); }
      }
      state.columns = detect(cells, context, extras, state.id);
      if (drag?.state === state && oldSignature !== JSON.stringify(state.columns.map(c => c.id))) finishDrag(false);
      if (context === 'recommendations' && (!state.generatedHeader || oldSignature !== JSON.stringify(state.columns.map(c => c.id)))) {
        state.generatedHeader?.remove(); const recHeader = doc.createElement('div'); recHeader.className = 'sp-layout-rec-header'; recHeader.setAttribute('role', 'row');
        for (const col of state.columns) { const cell = doc.createElement('div'); cell.textContent = col.fixed ? '' : col.label; cell.setAttribute('role', 'columnheader');
          const slot = col.id.split(':')[1]; if (col.id.startsWith('extra:')) cell.className = slot === 'playlist2' ? 'sort-play-second-column' : 'sort-play-column';
          recHeader.append(cell);
        }
        root.prepend(recHeader); state.generatedHeader = recHeader;
      }
      if (!state.scrollbar) {
        const bar = doc.createElement('div'); bar.className = 'sp-layout-scrollbar'; bar.tabIndex = 0;
        bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', `Rolagem horizontal das colunas (${CONTEXTS[context]})`); bar.append(doc.createElement('div'));
        bar.addEventListener('scroll', () => {
          if (state.scrollFrame != null) return;
          state.scrollFrame = win.requestAnimationFrame(() => { state.scrollFrame = null; if (validState(state)) setScroll(state, bar.scrollLeft); });
        }, { passive: true, signal: state.events.signal });
        state.scrollbar = bar;
      }
      const anchor = state.generatedHeader || header;
      if (anchor?.parentElement?.matches('.main-trackList-trackListHeader')) {
        if (state.scrollbar.parentElement !== anchor.parentElement) anchor.parentElement.append(state.scrollbar);
        state.scrollbar.style.position = 'static';
      } else if (anchor && anchor.nextElementSibling !== state.scrollbar) {
        anchor.after(state.scrollbar); state.scrollbar.style.top = ((parseFloat(win.getComputedStyle(anchor).top) || 0) + anchor.getBoundingClientRect().height) + 'px';
      }
      for (const row of root.querySelectorAll(ROWS + ', .sp-layout-rec-header')) bindRow(state, row);
      for (const [handle, col] of [...state.handles]) {
        const current = state.columns.find(c => c.id === col.id);
        if (!handle.isConnected || !current) { handle.remove(); state.handles.delete(handle); }
        else state.handles.set(handle, current);
      }
      for (const node of new Set([...state.styles.keys(), ...state.attrs.keys(), ...state.classes.keys()])) if (node !== root && !root.contains(node)) restoreNode(state, node);
      ownAttr(state, root, 'aria-colcount', String(state.columns.length));
      apply(state); notify();
    }
    const resizeObserver = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(entries => {
      for (const entry of entries) { const state = roots.get(entry.target); if (state) state.available = state.root.clientWidth; }
      if (resizeFrame !== null || closed) return;
      resizeFrame = win.requestAnimationFrame(() => { resizeFrame = null; prune(); for (const state of roots.values()) apply(state); notify(); });
    }) : null;
    if (!resizeObserver) win.addEventListener('resize', () => { prune(); for (const state of roots.values()) state.available = state.root.clientWidth; for (const state of roots.values()) apply(state); notify(); }, { signal: lifecycle.signal });
    function describe() { return [...roots.values()].map(state => ({ context: state.context, columns: state.columns.map((col, index) => ({ ...col, width: state.layout?.widths[index] })), gap: state.layout?.gap ?? 16 })); }
    function reset() { finishDrag(false); for (const root of [...roots.keys()]) release(root); }
    function close() { reset(); closed = true; clearClickGuard?.(); resizeObserver?.disconnect(); lifecycle.abort(); if (resizeFrame !== null) win.cancelAnimationFrame(resizeFrame); style.remove(); subscribers.clear(); }
    return { sync, prune, release, reset, close, setWidth, setGap, restore, describe, getSaved: () => JSON.parse(JSON.stringify(saved)), get error() { return lastError; }, onChange(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }, stats: () => ({ roots: roots.size, dragging: !!drag, observers: resizeObserver && !closed ? 1 : 0 }), mountSettings: (host, mountOptions) => mountSettings(host, { describe, setWidth, setGap, restore, onChange: fn => { subscribers.add(fn); return () => subscribers.delete(fn); }, get error() { return lastError; } }, mountOptions) };
  }
  function mountSettings(host, controller, { signal } = {}) {
    const doc = host.ownerDocument, events = new AbortController();
    const section = doc.createElement('section'); section.id = 'sp-native-layout-settings';
    const node = (tag, text) => { const n = doc.createElement(tag); if (text) n.textContent = text; return n; };
    const style = node('style', `#sp-native-layout-settings{margin:16px 0;padding:12px;border:1px solid #666;border-radius:8px;font:13px/1.4 sans-serif} #sp-native-layout-settings h2{font-size:18px;margin:0 0 8px} #sp-native-layout-settings label{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0} #sp-native-layout-settings input{width:92px!important;min-width:0!important} #sp-native-layout-settings input,#sp-native-layout-settings select,#sp-native-layout-settings button{font:inherit;color:var(--spice-text,#fff);background:var(--spice-main,#222);border:1px solid #777;border-radius:4px;padding:5px} #sp-native-layout-settings :focus-visible{outline:2px solid #a7d8ff;outline-offset:2px}`);
    section.append(style, node('h2', 'Layout das colunas'), node('p', 'Larguras e espaçamento são independentes. Arraste as divisórias ou use os valores em pixels. Setas nas divisórias: 8 px; Shift: 32 px. Esc cancela o arraste.'));
    const select = node('select'); select.setAttribute('aria-label', 'Contexto do layout'); section.append(select);
    const fields = node('div'), status = node('p'); status.setAttribute('role', 'status'); section.append(fields, status); host.append(section);
    let signature = '', inputs = new Map(), gapInput, rowEvents = null;
    function render() {
      const all = controller.describe(), contexts = [...new Set(all.map(r => r.context))];
      const selected = contexts.includes(select.value) ? select.value : contexts[0];
      const columns = [...new Map(all.filter(r => r.context === selected).flatMap(r => r.columns).filter(c => !c.fixed).map(c => [c.id, c])).values()];
      const next = JSON.stringify([selected, contexts, columns.map(c => [c.id, c.label])]);
      if (next !== signature) {
        signature = next; rowEvents?.abort(); rowEvents = new AbortController(); inputs = new Map();
        select.replaceChildren(...contexts.map(context => { const opt = node('option', CONTEXTS[context]); opt.value = context; return opt; })); if (selected) select.value = selected;
        fields.replaceChildren();
        if (!selected) fields.append(node('p', 'Abra uma lista com colunas extras ativas para ajustar seu layout.'));
        else {
          function input(label, min, max, value, change) {
            const row = node('label', label), n = node('input'); n.type = 'number'; n.min = String(min); n.max = String(max); n.step = '1'; n.value = String(value); n.setAttribute('aria-label', label);
            n.addEventListener('change', () => { if (n.value.trim() && n.checkValidity()) change(Number(n.value)); else n.reportValidity(); }, { signal: rowEvents.signal });
            row.append(n); fields.append(row); return n;
          }
          gapInput = input('Espaçamento entre colunas (px)', 0, 48, all.find(r => r.context === selected).gap, value => controller.setGap(selected, value));
          for (const col of columns) inputs.set(col.id, input(`${col.controlLabel || col.label} — largura (px)${col.persist ? '' : ' (somente nesta grade)'}`, col.min, col.max, col.width, value => controller.setWidth(selected, col.id, value)));
          const restore = node('button', 'Restaurar layout padrão'); restore.type = 'button'; restore.addEventListener('click', () => controller.restore(selected), { signal: rowEvents.signal }); fields.append(restore);
        }
      }
      const root = section.getRootNode();
      for (const col of columns) if (root.activeElement !== inputs.get(col.id) && inputs.has(col.id)) inputs.get(col.id).value = String(col.width);
      if (selected && root.activeElement !== gapInput) gapInput.value = String(all.find(r => r.context === selected).gap);
      status.textContent = controller.error || '';
    }
    select.addEventListener('change', () => { signature = ''; render(); }, { signal: events.signal });
    const unsubscribe = controller.onChange(render);
    const cleanup = () => { events.abort(); rowEvents?.abort(); unsubscribe(); section.remove(); signal?.removeEventListener('abort', cleanup); };
    signal?.addEventListener('abort', cleanup, { once: true }); render(); if (signal?.aborted) cleanup();
    return { cleanup };
  }
  return { STORAGE_KEY, CONTEXTS, NATIVE, parseSaved, extra, native, compose, createController };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SortPlayNativeLayout;
