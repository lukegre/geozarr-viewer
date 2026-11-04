// Per-variable attributes popover (D-55). Reference: toggleVarInfo, closeVarInfo, initVarInfo. The info icon belongs to
// variable-cards, which emits varinfo:open({name, anchor}); this component owns one shared popover (position: fixed,
// so its slot does not matter; the root itself stays empty). Attribute values arrive formatted in cfg (attrValue).

// Rows of the table: [key, text] in stored order.
function attrRows(attrs) {
  return Object.entries(attrs || {}).map(([k, x]) => [k, String(x)]);
}

// Reference toggleVarInfo placement: right of the sidebar (or of the anchor), vertically at the anchor, kept inside
// the viewport (and below `minTop`, e.g. a top bar). Rects are {top, right}; sizes in px.
function popoverPosition(at, side, panel, view, minTop = 8) {
  const left = Math.max(8, Math.min(Math.max(side ? side.right : 0, at.right) + 8, view.w - panel.w - 8));
  const top = Math.max(minTop, Math.min(at.top, view.h - panel.h - 8));
  return {left, top};
}

registerComponent({
  name: 'var-attrs',
  init(app, root) {
    const panel = h('div', 'gv-panel va-pop');
    panel.hidden = true;
    root.append(panel);
    let current = null, anchorEl = null;

    function close() {
      panel.hidden = true;
      current = anchorEl = null;
      app.bus.emit('varinfo:state', {name: null});
    }
    function open(name, anchor) {
      const v = app.varOf(name);
      if (!v) return;
      panel.replaceChildren(h('div', 'va-title', app.label(v)));
      const rows = attrRows(v.attrs);
      if (rows.length) {
        const tbody = h('tbody');
        for (const [k, x] of rows) { const tr = h('tr'); tr.append(h('th', '', k), h('td', '', x)); tbody.append(tr); }
        const tbl = h('table');
        tbl.append(tbody);
        panel.append(tbl);
      } else {
        panel.append(h('div', 'va-none', 'No attributes'));
      }
      panel.hidden = false;
      const at = anchor.getBoundingClientRect();
      const side = anchor.closest('.gv-sidebar')?.getBoundingClientRect();
      const top = app.slot('topbar')?.getBoundingClientRect();
      const pos = popoverPosition(at, side, {w: panel.offsetWidth, h: panel.offsetHeight},
        {w: innerWidth, h: innerHeight}, Math.max(8, top ? top.bottom + 4 : 0));
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
      current = name;
      anchorEl = anchor;
      app.bus.emit('varinfo:state', {name});
    }

    // clicking the same card's icon again closes it
    app.bus.on('varinfo:open', ({name, anchor}) => { const same = current === name; close(); if (!same) open(name, anchor); });
    // capture phase: card buttons stop propagation, so a bubbling listener would miss them
    document.addEventListener('click', (e) => {
      if (current && !panel.contains(e.target) && !anchorEl.contains(e.target)) close();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) close(); });
    app.bus.on('selection:changed', () => { if (current && !app.state.selected.includes(current) && !anchorEl.isConnected) close(); });
    app.bus.on('labels:changed', () => { if (current) open(current, anchorEl); });
  },
});
