// Dataset information: an info button and a panel. Reference: buildInfo, attrValue (D-32, D-55). Rows: title, store,
// CRS, bbox, variables, dims, levels, then the global attributes. In the sidebar the panel opens inline under the
// button; elsewhere it is a popover beside the button, kept inside the viewport.

// D-55: attribute display values, as `_attr_value` in preview.py (long values are cut at 2000 characters).
function attrValue(x) {
  let out;
  if (typeof x === 'boolean') out = x ? 'True' : 'False';
  else if (typeof x === 'number') out = Number.isFinite(x) ? x : String(x);
  else if (typeof x === 'string') out = x;
  else if (Array.isArray(x)) out = x.map((i) => typeof i === 'string' ? i : (i && typeof i === 'object' ? JSON.stringify(i) : String(i))).join(', ');
  else if (x && typeof x === 'object') out = JSON.stringify(x);
  else out = x == null ? 'None' : String(x);
  return typeof out === 'string' && out.length > 2000 ? out.slice(0, 2000) + '…' : out;
}

// Sections [{title, rows: [[key, value, id?]]}] for a dataset config; `label` names a variable (array or long name).
function infoSections(cfg, blank, label) {
  const rows = [];
  if (blank) rows.push(['Store', 'none loaded; type a path or URL in the store picker and press Enter']);
  else {
    if (cfg.title) rows.push(['Title', cfg.title]);
    rows.push(['Store', cfg.source || cfg.title]);
  }
  rows.push(['CRS', cfg.crs.name]);
  if (cfg.bbox) rows.push(['Bbox', cfg.bbox.map((x) => +Number(x).toPrecision(7)).join(', ')]);
  if (!blank) {
    rows.push([`Variables (${cfg.variables.length})`, cfg.variables.map(label).join(', '), 'info-vars']);
    for (const [d, info] of Object.entries(cfg.dims || {})) rows.push([`Dimension ${d}`, `${info.size} steps`]);
    if (cfg.levels) rows.push(['Levels', cfg.levels]);
  }
  const sections = [{title: 'Metadata', rows}];
  const attrs = Object.entries(cfg.attrs || {});
  if (attrs.length) sections.push({title: 'Global attributes', rows: attrs.map(([k, v]) => [k, attrValue(v)])});
  return sections;
}

registerComponent({
  name: 'info-panel',
  init(app, root, opts) {
    const inline = root.closest('[data-slot]')?.dataset.slot === 'sidebar';
    root.dataset.mode = inline ? 'inline' : 'popover';
    const btn = h('button', 'gv-iconbtn ip-btn');
    btn.type = 'button';
    btn.innerHTML = ICON.info;
    btn.setAttribute('aria-label', 'Dataset information');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Dataset information';
    const panel = h('div', 'ip-panel');
    panel.hidden = true;
    root.append(btn, panel);

    function place() {  // popover: below the button, right edge aligned, kept in the viewport
      if (inline || panel.hidden) return;
      const at = btn.getBoundingClientRect();
      const left = Math.max(8, Math.min(at.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 8));
      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(8, Math.min(at.bottom + 4, innerHeight - panel.offsetHeight - 8))}px`;
    }
    const setOpen = (open) => {
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      place();
    };
    function fill() {
      panel.replaceChildren();
      for (const {title, rows} of infoSections(app.cfg, app.blank, (v) => app.label(v))) {
        panel.append(h('h2', '', title));
        const tbl = h('table'), body = h('tbody');
        for (const [k, v, id] of rows) {
          const tr = h('tr'), td = h('td', '', String(v));
          if (id) td.dataset.id = id;
          tr.append(h('th', '', k), td);
          body.append(tr);
        }
        tbl.append(body);
        panel.append(tbl);
      }
      place();
    }
    btn.addEventListener('click', () => setOpen(panel.hidden));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });
    addEventListener('resize', place);
    app.bus.on('config:loaded', () => { fill(); if (opts.open) setOpen(true); });
    app.bus.on('labels:changed', () => {  // relabel the variables row in place (D-44)
      const td = panel.querySelector('td[data-id="info-vars"]');
      if (td) td.textContent = app.cfg.variables.map((v) => app.label(v)).join(', ');
    });
  },
});
