// Sliders for the dims whose role is 'v'. Reference: buildDimSlider, dimKeyDown, scrubKeyDown (D-50), syncRoles (D-40).
// Roles live in app.state.roles; without dim-roles the defaults apply (first dim h, the rest v). Without a timeline
// component nothing renders the 'h' dim, so it is treated as vertical here.

const dimLabel = (d, i) => (d.labels && d.labels[i] !== undefined ? d.labels[i] : String(i));

// Same function as in timeline and dim-roles (idempotent): a new dim is horizontal only if no dim holds that role.
function syncRoles(dimNames, roles) {
  let holder = dimNames.find((d) => roles[d] === 'h');
  for (const d of dimNames) {
    if (!roles[d]) roles[d] = holder === undefined ? 'h' : 'v';
    if (roles[d] === 'h') { if (holder === undefined) holder = d; else if (holder !== d) roles[d] = 'v'; }
  }
  return roles;
}

// The dims this component draws, in union order: role 'v', plus 'h' when no timeline exists.
function verticalDims(dimNames, roles, hasTimeline) {
  return dimNames.filter((d) => roles[d] === 'v' || (roles[d] === 'h' && !hasTimeline));
}

registerComponent({
  name: 'dim-sliders',
  init(app, root, opts) {
    const {state, bus} = app;
    const hasTimeline = app.spec.components.some((c) => c.name === 'timeline');
    const horizontal = opts.orientation === 'horizontal';
    root.dataset.orientation = horizontal ? 'horizontal' : 'vertical';
    root.hidden = true;
    let steps = [];  // [{name, step(delta)}] in display order

    function build() {
      steps = [];
      root.replaceChildren();
      const dimNames = app.layers.unionDims();
      syncRoles(dimNames, state.roles);
      const vDims = verticalDims(dimNames, state.roles, hasTimeline);
      root.hidden = !vDims.length;
      for (const name of vDims) {
        const d = app.cfg.dims[name];
        state.dims[name] = clamp(state.dims[name] || 0, 0, d.size - 1);
        const item = h('div', 'gv-panel ds-item');
        const val = h('span', 'ds-val', String(dimLabel(d, state.dims[name])));
        const inp = h('input');
        inp.type = 'range'; inp.min = 0; inp.max = d.size - 1; inp.step = 1; inp.value = state.dims[name];
        if (!horizontal) inp.setAttribute('orient', 'vertical');  // minimum at the top (writing-mode in the CSS)
        inp.setAttribute('aria-label', name);
        const apply = () => { app.layers.setDim(name, +inp.value); val.textContent = String(dimLabel(d, +inp.value)); };
        inp.addEventListener('input', apply);
        // Keyboard stepping (D-50): the same path as a native input event, clamped at both ends.
        steps.push({name, inp, step: (delta) => {
          const i = clamp(+inp.value + delta, 0, d.size - 1);
          if (i === +inp.value) return;
          inp.value = i;
          apply();
        }});
        // Focused slider: Up/Down step it, Left/Right the timeline (via the bus); Home/End/Page keys stay native.
        inp.addEventListener('keydown', (e) => {
          if (opts.keys === false || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault(); e.stopPropagation();
            steps.find((s) => s.name === name).step(e.key === 'ArrowDown' ? 1 : -1);  // Up = index - 1
          } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && hasTimeline) {
            e.preventDefault(); e.stopPropagation();
            bus.emit('timeline:step', e.key === 'ArrowRight' ? 1 : -1);
          }
        });
        item.append(h('span', 'ds-lab', name), inp, val);
        root.append(item);
      }
    }

    // global Up/Down: the first slider (D-50); fields and modifiers are left alone
    if (opts.keys !== false) {
      document.addEventListener('keydown', (e) => {
        if (!steps.length || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (e.target && e.target.closest && e.target.closest('input, select, textarea, [contenteditable]')) return;
        e.preventDefault();
        steps[0].step(e.key === 'ArrowDown' ? 1 : -1);
      });
    }

    bus.on('config:loaded', build);
    bus.on('selection:changed', build);
    bus.on('roles:changed', build);
    bus.on('dims:changed', ({dim, index}) => {  // changed from elsewhere (URL, timeline of another dim is irrelevant)
      const s = steps.find((x) => x.name === dim);
      if (!s || +s.inp.value === index) return;
      s.inp.value = index;
      s.inp.nextSibling.textContent = String(dimLabel(app.cfg.dims[dim], index));
    });
  },
});
