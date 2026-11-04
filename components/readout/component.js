// Pointer readout: value of every visible variable under the pointer plus lat/lon. Reference: initReadout, coordLine
// (D-39/D-41). It sits in its slot instead of following the pointer; the sampling itself is app.frame.sample.

// "Lat: 46.520°N  Lon: 6.630°E" (lon normalised to [-180, 180) by the caller). No "0.000°S".
function formatLatLon(lon, lat) {
  const f = (v, p, n) => `${Math.abs(v).toFixed(3)}°${+v.toFixed(3) < 0 ? n : p}`;
  return `Lat: ${f(lat, 'N', 'S')}  Lon: ${f(lon, 'E', 'W')}`;
}

// "name: 12.34 unit" (categorical values print as they are, without units)
function formatValue(val, v, label) {
  const u = unitsOf(v);
  return `${label}: ${v.categorical ? String(val) : +Number(val).toPrecision(4)}${!v.categorical && u ? ` ${u}` : ''}`;
}

registerComponent({
  name: 'readout',
  init(app, root, opts) {
    root.classList.add('gv-panel');
    root.hidden = true;
    const hide = () => { root.hidden = true; };
    app.bus.on('map:ready', (map) => {
      map.on('pointermove', (e) => {
        if (e.dragging) return hide();
        const samples = app.frame.sample(e.coordinate);  // top-most first
        const lines = samples.map((s) => formatValue(s.value, app.varOf(s.name), app.label(s.name)));
        let coord = null;
        // lat/lon inside the data extent, or anywhere while a value is shown (as in the reference's coordLine)
        if (opts.latlon !== false && (samples.length || app.geo.inExtent(e.coordinate))) {
          const ll = app.geo.lonLat(e.coordinate);
          if (ll) coord = formatLatLon(ll[0], ll[1]);
        }
        if (!lines.length && !coord) return hide();
        root.replaceChildren(...(coord ? [h('div', 'ro-coord', coord)] : []), ...lines.map((t) => h('div', 'ro-val', t)));
        root.hidden = false;
      });
      map.getViewport().addEventListener('pointerleave', hide);
    });
  },
});
