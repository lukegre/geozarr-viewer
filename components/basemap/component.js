// Basemap selector. Reference: initBasemap (the selector; the basemap layers and setBasemap live in core/layers.js).
registerComponent({
  name: 'basemap',
  init(app, root, opts) {
    root.classList.add('gv-panel', 'gv-row');
    const sel = h('select');
    sel.id = 'gv-basemap';
    sel.setAttribute('aria-label', 'Basemap');
    for (const [id, label] of app.layers.basemaps) sel.add(new Option(label, id));
    if (opts.label !== false) {
      const lab = h('label', '', 'Basemap');
      lab.htmlFor = sel.id;
      root.append(lab);
    }
    root.append(sel);
    sel.addEventListener('change', () => app.layers.setBasemap(sel.value));
    app.bus.on('basemap:changed', (id) => { sel.value = id; });
    app.layers.setBasemap(opts.default);
  },
});
