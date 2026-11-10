// Variable dropdown: compact alternative to variable-cards. Same selection model (app.layers.select/deselect); no
// eye, order or settings. Reference: toggleVar / moveVariable for the selection behaviour, labelOf (D-44) via app.label.

// Single mode: choosing `name` selects it and deselects every other selected variable ("" = none).
function singleChange(selected, name) {
  return {add: name || null, remove: selected.filter((n) => n !== name)};
}

// Summary text of the checklist button: the label for one, a count for several.
function summaryText(selected, labelOf) {
  if (!selected.length) return 'None selected';
  if (selected.length === 1) return labelOf(selected[0]);
  return `${selected.length} variables`;
}

registerComponent({
  name: 'variable-dropdown',
  init(app, root, opts) {
    const multiple = opts.multiple === true;
    root.classList.add('gv-row');
    if (opts.label !== false) root.append(h('label', '', 'Variable'));
    const names = () => app.cfg.variables.map((v) => v.name);
    let control;  // the select, or the checklist <details>
    let summary, list;  // checklist only: the <details> button and the checkbox panel

    if (!multiple) {
      control = h('select');
      control.setAttribute('aria-label', 'Variable');
      root.append(control);
      control.addEventListener('change', () => {
        const {add, remove} = singleChange(app.state.selected, control.value);
        if (add) app.layers.select(add);  // add first so the selection is never empty in between
        for (const n of remove) app.layers.deselect(n);
      });
    } else {
      control = h('details', 'vd-multi');
      summary = h('summary', 'gv-btn');
      list = h('div', 'vd-list gv-panel');
      control.append(summary, list);
      root.append(control);
      list.addEventListener('change', (e) => {
        const box = e.target;
        if (box.checked) app.layers.select(box.value); else app.layers.deselect(box.value);
      });
      // close on a click elsewhere or Escape
      document.addEventListener('click', (e) => { if (control.open && !control.contains(e.target)) control.open = false; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') control.open = false; });
    }

    function rebuild() {
      if (!multiple) {
        control.replaceChildren(...names().map((n) => new Option(app.label(n), n)));
        control.add(new Option('(none)', ''), 0);
      } else {
        list.replaceChildren(...names().map((n) => {
          const row = h('label', 'vd-item'), box = h('input');
          box.type = 'checkbox';
          box.value = n;
          row.append(box, h('span', '', app.label(n)));
          return row;
        }));
      }
      sync();
    }
    function sync() {
      const sel = app.state.selected;
      if (!multiple) {
        // single: show the top-most selected variable (the last of the bottom-first list), "(none)" when empty
        control.value = sel.at(-1) || '';
      } else {
        for (const box of list.querySelectorAll('input')) box.checked = sel.includes(box.value);
        summary.textContent = summaryText(sel, app.label);
      }
    }
    app.bus.on('config:loaded', rebuild);
    app.bus.on('selection:changed', sync);
    app.bus.on('labels:changed', rebuild);
  },
});
