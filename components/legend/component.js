// Colourbar legend: gradient, ticks (log ticks under an effective log scale, D-54) and units.
// Reference: buildLegend, layoutTicks (D-54, D-44: no variable name in the card legend; overlays add a title).

// Ticks of a style as [{pos, label}], pos = fraction 0..1 along the bar. `style` supplies effectiveLog, niceTicks and
// niceLogTicks (app.style). buildLegend: linear (t - vmin)/(vmax - vmin), log ln(t/vmin)/ln(vmax/vmin).
function legendTicks(st, style) {
  const log = style.effectiveLog(st);
  const values = log ? style.niceLogTicks(st.vmin, st.vmax) : style.niceTicks(st.vmin, st.vmax);
  return values.map((t) => {
    const f = log ? Math.log(t / st.vmin) / Math.log(st.vmax / st.vmin) : (t - st.vmin) / (st.vmax - st.vmin);
    return {pos: clamp(f, 0, 1), label: fmt(t)};
  });
}

// layoutTicks: labels are centred on their tick; the end ones are nudged back inside the bar, a label that would
// touch the previous one is hidden. `items` = [{start, size}] in screen order along the axis (start = left/top of the
// centred label), `lo`/`hi` = the bar's extent. Returns [{shift, hidden}].
function fitLabels(items, lo, hi, gap = 4) {
  let end = -Infinity;
  return items.map(({start, size}) => {
    const shift = start < lo ? lo - start : (start + size > hi ? hi - (start + size) : 0);
    const s = start + shift;
    if (s < end + gap) return {shift, hidden: true};
    end = s + size;
    return {shift, hidden: false};
  });
}

// the colourbar gradient runs left to right in app.style.gradientCss; vertical bars put the high end on top
const gradientFor = (css, vertical) => (vertical ? css.replace('to right', 'to top') : css);

// DOM wrapper around fitLabels for one .lg-ticks element
function layoutTicks(ticks, vertical) {
  const box = ticks.getBoundingClientRect();
  const len = vertical ? box.height : box.width;
  if (!len) return;  // sidebar collapsed / settings closed / not laid out yet
  const labs = Array.from(ticks.querySelectorAll('.lg-label'));
  const dir = vertical ? 'Y' : 'X';
  const origin = vertical ? box.top : box.left;
  for (const lab of labs) { lab.style.visibility = 'visible'; lab.style.transform = `translate${dir}(-50%)`; }
  // screen order along the axis (a vertical bar has the high ticks on top)
  const items = labs.map((lab) => {
    const r = lab.getBoundingClientRect();
    return {lab, start: (vertical ? r.top : r.left) - origin, size: vertical ? r.height : r.width};
  }).sort((a, b) => a.start - b.start);
  fitLabels(items, 0, len).forEach((f, i) => {
    const lab = items[i].lab;
    if (f.shift) lab.style.transform = `translate${dir}(calc(-50% + ${f.shift}px))`;
    lab.style.visibility = f.hidden ? 'hidden' : 'visible';
  });
}

// One legend element for a variable. title: caption above (overlay only).
function buildLegend(app, v, opts, vertical, title) {
  const el = h('div', `lg-legend ${vertical ? 'lg-vertical' : 'lg-horizontal'}`);
  if (title) el.append(h('div', 'lg-title', title));
  if (v.categorical) {  // palette swatches
    for (const [val, c] of v.palette) {
      const sw = h('span', 'lg-swatch');
      sw.style.background = css(c);
      const r = h('div', 'lg-cat');
      r.append(sw, h('span', '', String(val)));
      el.append(r);
    }
    return el;
  }
  const st = app.style.get(v.name);
  const body = h('div', 'lg-body');
  const bar = h('div', 'lg-bar');
  bar.style.background = gradientFor(app.style.gradientCss(app.style.stopsOf(st)), vertical);
  const ticks = h('div', 'lg-ticks');
  for (const {pos, label} of legendTicks(st, app.style)) {
    const p = `${100 * (vertical ? 1 - pos : pos)}%`;
    const mark = h('span', 'lg-tick'), lab = h('span', 'lg-label', label);
    mark.style[vertical ? 'top' : 'left'] = lab.style[vertical ? 'top' : 'left'] = p;
    ticks.append(mark, lab);
  }
  body.append(bar, ticks);
  el.append(body);
  const units = unitsOf(v);
  if (opts.units !== false && units) el.append(h('div', 'lg-units', units));
  new ResizeObserver(() => layoutTicks(ticks, vertical)).observe(ticks);
  return el;
}

registerComponent({
  name: 'legend',
  init(app, root, opts) {
    root.hidden = true;
    if (opts.placement === 'card') {
      // inside each card's settings container; only that variable's style changes redraw it
      const mine = new globalThis.Map();  // name -> {legend, draw}
      app.bus.on('card:settings', ({name, el}) => {
        mine.get(name)?.legend.remove();
        const v = app.varOf(name);
        if (!v) return;
        const wrap = h('div', 'gv-legend lg-card');
        const draw = () => wrap.replaceChildren(buildLegend(app, v, opts, false));
        draw();
        el.append(wrap);
        mine.set(name, {legend: wrap, draw});
      });
      app.bus.on('style:changed', (name) => mine.get(name)?.draw());
      return;
    }
    // overlay: one colourbar per visible variable, top-most first, titled with its label
    const vertical = opts.orientation === 'vertical';
    root.classList.add('lg-overlay', vertical ? 'lg-vertical' : 'lg-horizontal');
    const draw = () => {
      const vars = [...app.state.selected].reverse().filter((n) => !app.state.hidden.has(n)).map((n) => app.varOf(n)).filter(Boolean);
      root.replaceChildren(...vars.map((v) => {
        const panel = h('div', 'gv-panel lg-panel');
        panel.append(buildLegend(app, v, opts, vertical, app.label(v)));
        return panel;
      }));
      root.hidden = !vars.length;
    };
    for (const ev of ['selection:changed', 'visibility:changed', 'style:changed', 'labels:changed', 'config:loaded']) app.bus.on(ev, draw);
  },
});
