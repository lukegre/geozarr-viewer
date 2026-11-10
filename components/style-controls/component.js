// Style controls of one variable: colourmap, Reversed, Log scale, Range, Auto | Min/Max | Symmetric, opacity.
// Reference: buildStyleControls (D-42 grouped colourmaps, D-45 Space reverses, D-48..D-51 range buttons, D-54 log).
// State lives in app.style / app.layers / app.frame; this file is only the DOM and the pure helpers below.

const AUTO_TITLE = 'Percentile range (2-98 %) of the data in view; a diverging colormap when the signs balance';
const MINMAX_TITLE = 'True minimum and maximum of the data in view';
const AUTO_NONE = 'No loaded data for the current frame';
const CMAP_TITLE = 'Tip: with this menu focused, press ← / → to step to the previous / next colormap, or Space to toggle Reversed.';

// stepSelect: the option value one step left/right of `current` in `values` (no wrap); null = no step (other key,
// modifier, already at the end, unknown value).
function stepValue(values, current, e) {
  if (hasModifier(e) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return null;
  const i = values.indexOf(current);
  if (i < 0) return null;
  const j = Math.min(values.length - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)));
  return j === i ? null : values[j];
}

// reverseKey (D-45): is this the plain Space key?
const isReverseKey = (e) => !hasModifier(e) && (e.key === ' ' || e.code === 'Space');

// setRange: both fields must be finite numbers with min < max, else null (the controls flash and keep the old values).
function parseRange(minText, maxText) {
  const a = parseFloat(minText), b = parseFloat(maxText);
  return Number.isFinite(a) && Number.isFinite(b) && a < b ? {vmin: a, vmax: b} : null;
}

// Symmetric button: [-m, m] with m = the larger magnitude; null when both limits are 0.
function symmetricRange(st) {
  const m = Math.max(Math.abs(st.vmin), Math.abs(st.vmax));
  return m > 0 ? {vmin: -m, vmax: m} : null;
}

// sync(): what the controls show for a style. `effLog` = the effective log flag (D-54: needs Min > 0).
function controlState(st, effLog) {
  return {
    reversed: !!st.reversed, log: !!st.log,
    logDisabled: !(st.vmin > 0),         // the flag is kept, it just has no effect
    symDisabled: !!effLog,               // symmetric about 0 is meaningless on a log scale
    minText: String(+st.vmin.toPrecision(6)), maxText: String(+st.vmax.toPrecision(6)),
  };
}

// Build the controls of one variable into a div. `getName()` says which variable they drive (fixed in a card, the
// panel's select otherwise). Returns {el, sync, dispose}.
function buildControls(app, opts, getName) {
  const el = h('div', 'gv-style-controls sc-controls');
  const row = (label) => {
    const r = h('div', 'sc-row');
    if (label) r.append(h('label', '', label));
    el.append(r);
    return r;
  };
  const S = app.style;

  // colourmap select (grouped by source, D-42) + gradient preview
  const sel = h('select');
  sel.setAttribute('aria-label', 'Colormap');
  sel.title = CMAP_TITLE;
  const bar = h('span', 'sc-cmbar');
  row('Colormap').append(sel, bar);
  const checks = row('');
  checks.classList.add('sc-checks');
  const check = (text, title) => {
    const lab = h('label', 'sc-check'), box = h('input');
    box.type = 'checkbox';
    if (title) lab.title = title;
    lab.append(box, h('span', '', text));
    checks.append(lab);
    return box;
  };
  const rev = check('Reversed');
  const logBox = opts.log !== false ? check('Log scale', 'Space the colours logarithmically (needs Min > 0)') : null;

  const minIn = h('input'), maxIn = h('input');
  for (const [inp, name] of [[minIn, 'Min'], [maxIn, 'Max']]) { inp.type = 'number'; inp.step = 'any'; inp.setAttribute('aria-label', name); }
  row('Range').append(minIn, h('span', 'sc-sep', ':'), maxIn);

  let autoBtn, minMaxBtn, symBtn;
  if (opts.range_buttons !== false) {
    const r = row('');
    autoBtn = h('button', 'gv-btn', 'Auto'); minMaxBtn = h('button', 'gv-btn', 'Min/Max'); symBtn = h('button', 'gv-btn', 'Symmetric');
    for (const b of [autoBtn, minMaxBtn, symBtn]) b.type = 'button';
    autoBtn.title = AUTO_TITLE; minMaxBtn.title = MINMAX_TITLE;
    r.append(autoBtn, minMaxBtn, symBtn);
  }
  let opac;
  if (opts.opacity !== false) {
    opac = h('input');
    opac.type = 'range'; opac.min = '0'; opac.max = '1'; opac.step = '0.05';
    opac.setAttribute('aria-label', 'Opacity');
    row('Opacity').append(opac);
  }

  // fillCmapSelect: groups of the shown sources; the current map stays listed even from a hidden source
  const fill = (current) => {
    const groups = S.listedGroups(current).map((g) => {
      const og = document.createElement('optgroup');
      og.label = g.label;
      for (const n of g.names) og.append(new Option(S.cmapLabel(n), n));
      return og;
    });
    sel.replaceChildren(...groups);
    sel.value = current;
  };
  const sync = () => {
    const name = getName(), st = name && S.get(name);
    if (!st) return;
    const c = controlState(st, S.effectiveLog(st));
    fill(st.cmap);
    rev.checked = c.reversed;
    if (logBox) { logBox.checked = c.log; logBox.disabled = c.logDisabled; }
    if (symBtn) symBtn.disabled = c.symDisabled;
    minIn.value = c.minText; maxIn.value = c.maxText;
    bar.style.background = S.gradientCss(S.stopsOf(st));
    if (opac) opac.value = String(app.layers.opacityOf(name));
  };
  const flashBad = () => {
    for (const i of [minIn, maxIn]) i.classList.add('bad');
    setTimeout(() => { minIn.classList.remove('bad'); maxIn.classList.remove('bad'); }, 1500);
  };
  // a style call that may be rejected (invalid range): on failure show the old values again and flash
  const apply = (patch) => { if (!S.set(getName(), patch)) { sync(); flashBad(); } };

  sel.addEventListener('change', () => apply({cmap: sel.value, reversed: false}));
  // ←/→ step across optgroups (native stepping is unreliable on macOS Chrome); Space toggles Reversed (D-45).
  sel.addEventListener('keydown', (e) => {
    const next = stepValue(Array.from(sel.options, (o) => o.value), sel.value, e);
    if (next !== null) {
      e.preventDefault(); e.stopPropagation();
      sel.value = next;
      sel.dispatchEvent(new Event('change', {bubbles: true}));
    }
  });
  // Space: swallow keydown, keyup and auto-repeat (some browsers open the list on keyup); toggle once per press
  const spaceKey = (e) => {
    if (!isReverseKey(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'keydown' && !e.repeat) rev.click();
  };
  sel.addEventListener('keydown', spaceKey);
  sel.addEventListener('keyup', spaceKey);
  rev.addEventListener('change', () => apply({reversed: rev.checked}));
  if (logBox) logBox.addEventListener('change', () => apply({log: logBox.checked}));
  const setRange = () => {
    const r = parseRange(minIn.value, maxIn.value);
    if (r) apply(r); else { sync(); flashBad(); }
  };
  minIn.addEventListener('change', setRange);
  maxIn.addEventListener('change', setRange);
  if (autoBtn) {
    // nothing loaded for the current frame: the style is kept (D-48, D-51)
    const run = (btn, title, fn) => btn.addEventListener('click', () => {
      if (fn(getName())) { btn.title = title; return; }
      btn.title = AUTO_NONE;
      flashBad();
    });
    run(autoBtn, AUTO_TITLE, (n) => app.frame.autoStyle(n));
    run(minMaxBtn, MINMAX_TITLE, (n) => app.frame.minMaxStyle(n));
    symBtn.addEventListener('click', () => { const r = symmetricRange(S.get(getName())); if (r) apply(r); });
  }
  if (opac) opac.addEventListener('input', () => app.layers.setOpacity(getName(), +opac.value));

  const refresh = (name) => { if (name === undefined || name === getName()) sync(); };
  const unsub = [app.bus.on('style:changed', refresh), app.bus.on('opacity:changed', refresh),
    app.bus.on('cmaps:changed', () => refresh())];
  sync();
  return {el, sync, dispose: () => unsub.forEach((f) => f())};
}

registerComponent({
  name: 'style-controls',
  init(app, root, opts) {
    if (opts.placement === 'panel') {
      // own panel: one variable at a time, picked in a small select (follows the selection; labels per label mode)
      root.classList.add('gv-panel', 'sc-panel');
      root.hidden = true;
      const sel = h('select');
      sel.setAttribute('aria-label', 'Variable');
      const head = h('div', 'sc-row');
      head.append(h('label', '', 'Variable'), sel);
      const note = h('div', 'sc-note', 'No style controls for categorical variables.');
      note.hidden = true;
      let current = null;
      const ctl = buildControls(app, opts, () => current);
      root.append(head, ctl.el, note);
      const fillVars = () => {
        const vars = app.cfg.variables;
        root.hidden = !vars.length;
        sel.replaceChildren(...vars.map((v) => new Option(app.label(v), v.name)));
        if (!current || !app.varOf(current)) current = app.state.selected.at(-1) || vars[0]?.name || null;
        if (current) sel.value = current;
        show();
      };
      const show = () => {
        const v = current && app.varOf(current);
        ctl.el.hidden = !v || !!v.categorical;
        note.hidden = !(v && v.categorical);
        if (v && !v.categorical) ctl.sync();
      };
      sel.addEventListener('change', () => { current = sel.value; show(); });
      app.bus.on('config:loaded', fillVars);
      app.bus.on('labels:changed', fillVars);
      // the newly selected (top-most) variable becomes the one shown
      app.bus.on('selection:changed', (selected) => { if (selected.length) { current = selected.at(-1); sel.value = current; show(); } });
    } else {
      // card: fill the settings container of each variable card (re-emitted containers replace the old controls)
      root.hidden = true;
      const mine = new globalThis.Map();  // name -> controls
      app.bus.on('card:settings', ({name, el}) => {
        mine.get(name)?.el.remove();
        mine.get(name)?.dispose();
        const v = app.varOf(name);
        if (!v || v.categorical) return;
        const ctl = buildControls(app, opts, () => name);
        el.append(ctl.el);
        mine.set(name, ctl);
      });
    }
  },
});
