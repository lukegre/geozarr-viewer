// Variable cards. Reference: buildCards, refreshCards, initCardDragging, selectedDropBefore, toggleVar (D-36/D-37/D-38),
// labelOf (D-44, here app.label). Legend, colour and opacity controls are not here: style components fill the card's
// settings container (event card:settings); var-attrs opens on varinfo:open (D-55).

// Card names by section: selected top-first (app.state.selected is bottom-first), the others in store order.
function cardOrder(variables, selected) {
  const sel = new Set(selected);
  return {selected: [...selected].reverse(), other: variables.map((v) => v.name).filter((n) => !sel.has(n))};
}

// Reference selectedDropBefore: the first selected card (top-first `names`) whose vertical midpoint is below `y`,
// ignoring the dragged one; null = dropped below all of them (= the bottom layer).
function dropBefore(names, rectOf, y, dragged) {
  return names.find((n) => {
    if (n === dragged) return false;
    const r = rectOf(n);
    return y < r.top + r.height / 2;
  }) || null;
}

// "unit · dim · dim" metadata line
function metaLine(v) {
  return [unitsOf(v), ...(v.dims || [])].filter(Boolean).join(' · ');
}

registerComponent({
  name: 'variable-cards',
  init(app, root, opts) {
    const sections = opts.sections !== false, drag = opts.drag !== false, showOther = opts.show_other !== false;
    const OTHER_KEY = 'other-collapsed';  // reference OTHER_KEY
    const hasAttrs = app.spec.components.some((c) => c.name === 'var-attrs');
    const cards = new globalThis.Map();  // name -> {el, title, longname, info, gear, visibility, remove, handle}
    let otherCollapsed = app.storage.get(OTHER_KEY) === '1';
    let dragged = null;
    const open = new Set();  // cards whose settings are expanded

    const selBox = h('div', 'vc-list'), otherBox = h('div', 'vc-list');
    const selHead = h('h2', 'vc-head'), selSec = h('section', 'vc-sec'), otherSec = h('section', 'vc-sec');
    const otherToggle = h('button', 'vc-head vc-toggle');
    otherToggle.type = 'button';
    otherToggle.innerHTML = `<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const otherLabel = h('span');
    otherToggle.append(otherLabel);
    selSec.append(selHead, selBox);
    otherSec.append(otherToggle, otherBox);
    const hint = h('div', 'vc-hint', 'Click to select. Use the eye to show or hide, and × to remove.' +
      `${drag ? ' Drag handles to reorder.' : ''} The top card is drawn on top.`);
    hint.hidden = true;
    root.append(hint, ...(sections ? [selSec, otherSec] : [selBox]));
    selSec.hidden = otherSec.hidden = true;

    // ---- one card (reference buildCards)
    function buildCard(v) {
      const name = v.name;
      const el = h('div', 'vc-card');
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      const top = h('div', 'vc-top');
      const title = h('div', 'vc-name');
      let handle = null;
      if (drag) {
        handle = h('span', 'gv-iconbtn vc-handle', '⠿');
        handle.setAttribute('role', 'img');
        handle.draggable = true;
        handle.title = 'Drag to reorder or move between Selected and Other';
        handle.addEventListener('click', (e) => e.stopPropagation());
        handle.addEventListener('dragstart', (e) => {
          dragged = name;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', name);
          e.dataTransfer.setDragImage(el, 20, 20);
          el.classList.add('dragging');
        });
        handle.addEventListener('dragend', () => { dragged = null; el.classList.remove('dragging'); clearFeedback(); });
        top.append(handle);
      }
      top.append(title);
      const button = (cls, html, onclick) => {
        const b = h('button', `gv-iconbtn ${cls}`);
        b.type = 'button';
        if (html) b.innerHTML = html;
        b.addEventListener('click', (e) => { e.stopPropagation(); onclick(); });
        return b;
      };
      const info = button('vc-info', ICON.info, () => app.bus.emit('varinfo:open', {name, anchor: info}));
      info.title = 'Attributes';
      info.setAttribute('aria-expanded', 'false');
      info.hidden = !hasAttrs;
      const gear = button('vc-gear', ICON.gear, () => {
        if (open.has(name)) open.delete(name); else open.add(name);
        refresh();
      });
      gear.setAttribute('aria-label', 'Layer options');
      gear.setAttribute('aria-expanded', 'false');
      const visibility = button('vc-visibility', '', () => app.layers.setVisible(name, app.state.hidden.has(name)));
      const remove = button('vc-remove', '×', () => app.layers.deselect(name));
      remove.title = 'Remove from Selected';
      top.append(info, visibility, gear, remove);
      el.append(top);
      const meta = h('div', 'vc-meta', metaLine(v));
      meta.hidden = !meta.textContent;
      const longname = h('div', 'vc-longname');
      el.append(meta, longname);
      // settings container: style components fill it on card:settings; the gear is shown only when it has content
      const settings = h('div', 'vc-settings');
      settings.addEventListener('click', (e) => e.stopPropagation());
      el.append(settings);
      const sync = () => { gear.hidden = !settings.hasChildNodes(); };
      new MutationObserver(sync).observe(settings, {childList: true});
      gear.hidden = true;
      app.bus.emit('card:settings', {name, el: settings});
      sync();
      el.addEventListener('click', () => app.layers.select(name));  // a selected card is left as it is
      el.addEventListener('keydown', (e) => {
        if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); app.layers.select(name); }
      });
      cards.set(name, {el, title, longname, info, gear, visibility, remove, handle});
      return el;
    }

    // ---- drag and drop into the sections (reference initCardDragging)
    function clearFeedback() {
      selSec.classList.remove('drop-target');
      otherSec.classList.remove('drop-target');
      for (const c of cards.values()) c.el.classList.remove('drop-before');
    }
    const beforeAt = (y) => dropBefore(cardOrder(app.cfg.variables, app.state.selected).selected,
      (n) => cards.get(n).el.getBoundingClientRect(), y, dragged);
    function dropTarget(section, selected) {
      section.addEventListener('dragover', (e) => {
        if (!dragged) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        clearFeedback();
        section.classList.add('drop-target');
        const before = selected ? beforeAt(e.clientY) : null;
        if (before) cards.get(before).el.classList.add('drop-before');
      });
      section.addEventListener('dragleave', (e) => { if (!section.contains(e.relatedTarget)) clearFeedback(); });
      section.addEventListener('drop', (e) => {
        if (!dragged) return;
        e.preventDefault();
        const name = dragged, before = selected ? beforeAt(e.clientY) : null;
        clearFeedback();
        if (!selected) app.layers.deselect(name);
        else if (app.state.selected.includes(name)) app.layers.move(name, before);
        else app.layers.select(name, before);
      });
    }
    if (drag && sections) { dropTarget(selSec, true); dropTarget(otherSec, false); }

    // ---- state -> DOM (reference refreshCards)
    function refresh() {
      const order = cardOrder(app.cfg.variables, app.state.selected);
      const place = (box, names) => box.append(...names.filter((n) => cards.has(n)).map((n) => cards.get(n).el));
      if (sections) {
        place(selBox, order.selected);
        place(otherBox, order.other);
        selSec.hidden = !cards.size;
        otherSec.hidden = !cards.size || !showOther;  // kept even when empty: it is a drop target
        selHead.textContent = `Selected (${order.selected.length})`;
        otherLabel.textContent = `Other (${order.other.length})`;
        otherToggle.setAttribute('aria-expanded', String(!otherCollapsed));
        otherBox.hidden = otherCollapsed;
      } else {
        place(selBox, [...order.selected, ...order.other]);  // flat list: selected first, top-first
      }
      for (const [name, c] of cards) {
        const active = app.state.selected.includes(name), visible = active && !app.state.hidden.has(name);
        const isOpen = active && open.has(name);
        const v = app.varOf(name);
        c.el.hidden = !active && !showOther;
        c.title.textContent = app.label(v);
        const other = app.state.labelMode === 'long' ? v.name : (v.long_name?.trim() ? (v.display_name || v.long_name) : '');
        c.longname.textContent = other;  // the other name, never a duplicate of the title (D-38/D-44)
        c.longname.hidden = !other;
        c.el.classList.toggle('selected', active);
        c.el.classList.toggle('active', visible);
        c.el.classList.toggle('open', isOpen);
        c.el.setAttribute('aria-pressed', String(active));
        c.visibility.innerHTML = app.state.hidden.has(name) ? ICON.eyeOff : ICON.eye;
        const action = `${visible ? 'Hide' : 'Show'} ${app.label(v)}`;
        c.visibility.title = action;
        c.visibility.setAttribute('aria-label', action);
        c.visibility.setAttribute('aria-pressed', String(visible));
        c.gear.setAttribute('aria-expanded', String(isOpen));
        c.info.setAttribute('aria-label', `Attributes of ${app.label(v)}`);
        c.remove.setAttribute('aria-label', `Remove ${app.label(v)} from Selected`);
        c.handle?.setAttribute('aria-label', `Drag ${app.label(v)}`);
      }
      hint.hidden = cards.size < 2;
    }

    otherToggle.addEventListener('click', () => {
      otherCollapsed = !otherCollapsed;
      app.storage.set(OTHER_KEY, otherCollapsed ? '1' : '0');
      refresh();
    });
    app.bus.on('config:loaded', (cfg) => {
      for (const v of cfg.variables) selBox.append(buildCard(v));
      refresh();
    });
    for (const ev of ['selection:changed', 'visibility:changed', 'labels:changed']) app.bus.on(ev, refresh);
    // var-attrs tells which card's popover is open (aria-expanded of the info icon)
    app.bus.on('varinfo:state', ({name}) => {
      for (const [n, c] of cards) c.info.setAttribute('aria-expanded', String(n === name));
    });
  },
});
