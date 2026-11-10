// Dataset information: an info button and a panel. Reference: buildInfo (D-32, D-55; attribute values arrive formatted in cfg.attrs). Rows: title, store,
// CRS, bbox, variables, dims, levels, then the global attributes. In the sidebar the panel opens inline under the
// button; elsewhere it is a popover beside the button, kept inside the viewport.

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
  if (attrs.length) sections.push({title: 'Global attributes', rows: attrs});
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
        panel.append(kvTable(rows));
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
