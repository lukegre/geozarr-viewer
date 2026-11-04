// Centre longitude (D-26): the world is drawn around this longitude (shifted layer copies). Reference: initCenterLon.
// Global datasets only; app.layers.setCenterLon normalises, stores and reloads the page (no in-place view rebuild).

// "190" -> -170; null for text that is not a number (the input then shows the current value again)
function parseLon(text) {
  const x = parseFloat(text);
  return Number.isFinite(x) ? normLon(x) : null;
}

registerComponent({
  name: 'center-lon',
  init(app, root) {
    root.classList.add('gv-row');
    root.hidden = true;
    const inp = h('input');
    inp.type = 'number'; inp.step = 'any'; inp.id = 'gv-center-lon';
    inp.setAttribute('aria-label', 'Centre longitude');
    const lab = h('label', '', 'Centre longitude');
    lab.htmlFor = inp.id;
    root.append(lab, inp);
    // the centre is read from the URL / storage when the layers start, i.e. after config:loaded
    const show = () => { root.hidden = !app.cfg.global; inp.value = String(app.state.centerLon); };
    app.bus.on('config:loaded', show);
    app.bus.on('map:ready', show);
    inp.addEventListener('change', () => {
      const lon = parseLon(inp.value);
      inp.value = String(lon ?? app.state.centerLon);
      if (lon !== null) app.layers.setCenterLon(lon);
    });
  },
});
