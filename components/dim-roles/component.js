// Role select per dim: Horizontal (timeline), Vertical (dim-sliders) or Off (no control, the index stays applied).
// Reference: buildDimRoles, setRole, syncRoles, ROLES, the `slider.<dim>` URL entries (D-40, D-28). The model is
// app.state.roles; timeline and dim-sliders read it too and work without this component (defaults: first dim h).

const ROLES = [['h', 'Horizontal'], ['v', 'Vertical'], ['off', 'Off']];
const defaultRoles = (dims) => Object.fromEntries(dims.map((d, i) => [d, i === 0 ? 'h' : 'v']));

// Same function as in timeline and dim-sliders (idempotent): a new dim is horizontal only if no dim holds that role.
function syncRoles(dimNames, roles) {
  let holder = dimNames.find((d) => roles[d] === 'h');
  for (const d of dimNames) {
    if (!roles[d]) roles[d] = holder === undefined ? 'h' : 'v';
    if (roles[d] === 'h') { if (holder === undefined) holder = d; else if (holder !== d) roles[d] = 'v'; }
  }
  return roles;
}

// Choosing Horizontal moves the previous holder to Vertical (D-40).
function assignRole(roles, dimNames, name, role) {
  if (role === 'h') for (const d of dimNames) if (d !== name && roles[d] === 'h') roles[d] = 'v';
  roles[name] = role;
  return roles;
}

// What a role means when a component is missing: no timeline -> 'h' is drawn as a slider; no sliders -> 'v' is off.
function effectiveRole(role, hasTimeline, hasSliders) {
  if (role === 'h' && !hasTimeline) role = 'v';
  if (role === 'v' && !hasSliders) role = 'off';
  return role;
}

// URL `slider.<dim>=h|v|off`, only for dims whose role differs from the default. Returns [[key, value], ...].
function roleParams(dimNames, roles) {
  const def = defaultRoles(dimNames);
  return dimNames.filter((d) => roles[d] && roles[d] !== def[d]).map((d) => [`slider.${d}`, roles[d]]);
}

// Parse the URL: roles by dim for the known dims with a valid value (unknown dims and values are ignored).
function readRoleParams(params, dimNames) {
  const out = {};
  for (const d of dimNames) {
    const role = params.get(`slider.${d}`);
    if (ROLES.some(([r]) => r === role)) out[d] = role;
  }
  return out;
}

registerComponent({
  name: 'dim-roles',
  init(app, root, opts) {
    const {state, bus} = app;
    const has = (n) => app.spec.components.some((c) => c.name === n);
    const hasTimeline = has('timeline'), hasSliders = has('dim-sliders');
    root.hidden = true;

    // `slider.<dim>` URL entry; the defaults come from the union at write time. Two `h` keep the first (syncRoles).
    app.url.register('roles', {
      read(p) { if (!app.blank) Object.assign(state.roles, readRoleParams(p, Object.keys(app.cfg.dims))); },
      write(q) {
        if (app.blank) return;
        for (const [k, v] of roleParams(app.layers.unionDims(), state.roles)) q.set(k, v);
      },
    });

    function build() {
      root.replaceChildren();
      const dimNames = app.layers.unionDims();
      syncRoles(dimNames, state.roles);
      root.hidden = !dimNames.length;
      if (!dimNames.length) return;
      if (opts.title !== false) root.append(h('div', 'dr-title', 'Dimensions'));
      const roles = ROLES.filter(([r]) => (r === 'h' ? hasTimeline : r === 'v' ? hasSliders : true));
      for (const name of dimNames) {
        const sel = h('select');
        for (const [role, text] of roles) sel.add(new Option(text, role));
        sel.value = effectiveRole(state.roles[name], hasTimeline, hasSliders);
        sel.setAttribute('aria-label', `Role of ${name}`);
        sel.dataset.dim = name;
        sel.addEventListener('change', () => {
          assignRole(state.roles, dimNames, name, sel.value);
          app.url.sync();
          bus.emit('roles:changed', state.roles);  // timeline / dim-sliders (and this list) rebuild; playback stops
          root.querySelector(`select[data-dim="${CSS.escape(name)}"]`)?.focus();  // keep keyboard focus (D-40)
        });
        const row = h('label', 'dr-row');
        row.append(h('span', 'dr-name', name), sel);
        root.append(row);
      }
    }
    bus.on('config:loaded', build);
    bus.on('selection:changed', build);
    bus.on('roles:changed', build);
  },
});
