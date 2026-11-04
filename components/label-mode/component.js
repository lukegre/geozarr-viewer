// Label by: Array name / Long name (D-44). Reference: initLabelMode. The choice is app.setLabelMode (kept in storage,
// not in the URL); every component that shows a label listens to `labels:changed`.

const LABEL_MODES = [['name', 'Array name'], ['long', 'Long name']];

registerComponent({
  name: 'label-mode',
  init(app, root) {
    root.classList.add('gv-row');
    root.hidden = true;  // no variables yet (and none in the blank viewer)
    const sel = h('select');
    sel.id = 'gv-label-mode';
    sel.setAttribute('aria-label', 'Label by');
    for (const [value, text] of LABEL_MODES) sel.add(new Option(text, value));
    const lab = h('label', '', 'Label by');
    lab.htmlFor = sel.id;
    root.append(lab, sel);
    sel.value = app.state.labelMode;
    sel.addEventListener('change', () => app.setLabelMode(sel.value));
    app.bus.on('labels:changed', (mode) => { sel.value = mode; });
    app.bus.on('config:loaded', (cfg) => { root.hidden = !cfg.variables.length; sel.value = app.state.labelMode; });
  },
});
