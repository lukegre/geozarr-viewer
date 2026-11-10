// Colourmap sources: which libraries the colourmap selects list (D-42), at least one on (D-47).
// Reference: initCmapToggle, syncCmapBoxes, setCmapShow. The state and the rule live in app.style.setSourceShown.

const CMAP_SOURCES = [['core', 'matplotlib'], ['cmocean', 'cmocean'], ['cmasher', 'cmasher']];
const ONLY_ONE = 'At least one colormap source must stay selected';

// syncCmapBoxes: checkbox state per source for `show` ({core, cmocean, cmasher} -> bool); the only source still on
// is disabled so it cannot be switched off.
function boxStates(show) {
  const only = CMAP_SOURCES.filter(([src]) => show[src]).length === 1;
  return Object.fromEntries(CMAP_SOURCES.map(([src]) => {
    const disabled = only && !!show[src];
    return [src, {checked: !!show[src], disabled, title: disabled ? ONLY_ONE : ''}];
  }));
}

registerComponent({
  name: 'cmap-sources',
  init(app, root) {
    root.classList.add('gv-panel');
    root.hidden = true;  // blank viewer: no colourmap selects
    root.append(h('div', 'cs-title', 'Colormaps'));
    const row = h('div', 'cs-boxes');
    root.append(row);
    const boxes = {};
    for (const [src, text] of CMAP_SOURCES) {
      const lab = h('label', 'cs-check'), box = h('input');
      box.type = 'checkbox';
      lab.append(box, h('span', '', text));
      row.append(lab);
      boxes[src] = box;
      // the core refuses to switch the last source off; sync() then puts the box back
      box.addEventListener('change', () => { app.style.setSourceShown(src, box.checked); sync(); });
    }
    const sync = () => {
      const states = boxStates(app.style.sources);
      for (const [src, box] of Object.entries(boxes)) Object.assign(box, states[src]);
    };
    app.bus.on('cmaps:changed', sync);
    app.bus.on('config:loaded', (cfg) => { root.hidden = !cfg.variables.length; });
    sync();
  },
});
