#!/usr/bin/env python3
"""Assemble a standalone GeoZarr viewer page from a TOML spec and the component library.

    assemble.py SPEC.toml -o OUT.html     validate the spec and write the page (stdout without -o)
    assemble.py --list [--json]           list the components with slots and options

Exit codes: 0 ok, 2 invalid spec / manifest / usage. Stdlib only, Python >= 3.11.
See ARCHITECTURE.md for the spec format and the output contract.
"""
import argparse
import html
import json
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SLOTS = ["topbar", "sidebar", "sidebar-bottom", "bottom", "overlay-tl", "overlay-tr", "overlay-bl", "overlay-br"]
CORE_JS = ["util.js", "colormaps.js", "bus.js", "config.js", "style.js", "layers.js", "frame.js", "url.js", "app.js"]
THEMES = ["auto", "light", "dark"]
OPTION_TYPES = ["bool", "int", "number", "string", "enum"]
TOP_KEYS = {"title": str, "store": str, "endpoint": str, "relay": str}
GROUP_DEFAULTS = {"collapsed": False, "icon": "gear"}
GROUP_ICONS = ["gear", "none"]
LAYOUT_DEFAULTS = {"sidebar": "left", "sidebar_width": 320, "sidebar_collapsible": True}
OL_CSS = "https://cdn.jsdelivr.net/npm/ol@10.10.0/ol.css"


class SpecError(Exception):
    """One or more validation messages (each printed as `error: ...`)."""

    def __init__(self, messages):
        self.messages = [messages] if isinstance(messages, str) else list(messages)
        super().__init__("; ".join(self.messages))


# --- manifests ---------------------------------------------------------------------------------------------

def type_name(value):
    return {bool: "bool", int: "int", float: "number", str: "string"}.get(type(value), type(value).__name__)


def check_option_value(opt, spec, value):
    """Return an error text if `value` does not fit the option definition `spec`, else None."""
    t = spec["type"]
    if t == "bool":
        ok = isinstance(value, bool)
    elif t == "int":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif t == "number":
        ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    else:  # string, enum
        ok = isinstance(value, str)
    if not ok:
        return f'option "{opt}" must be {t}, got {type_name(value)} {json.dumps(value)}'
    if t == "enum" and value not in spec["choices"]:
        return f'option "{opt}" must be one of {", ".join(spec["choices"])}; got {json.dumps(value)}'
    if t in ("int", "number"):
        if "min" in spec and value < spec["min"]:
            return f'option "{opt}" must be >= {spec["min"]}; got {value}'
        if "max" in spec and value > spec["max"]:
            return f'option "{opt}" must be <= {spec["max"]}; got {value}'
    return None


def load_manifest(directory: Path):
    """Read and validate components/<name>/manifest.json. Returns (manifest, errors)."""
    name = directory.name
    errors = []
    mfile = directory / "manifest.json"
    if not mfile.is_file():
        return None, [f'component "{name}": manifest.json is missing']
    if not (directory / "component.js").is_file():
        errors.append(f'component "{name}": component.js is missing')
    try:
        m = json.loads(mfile.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return None, [f'component "{name}": manifest.json is not valid JSON ({e})']
    if m.get("name") != name:
        errors.append(f'component "{name}": manifest name {json.dumps(m.get("name"))} does not match the folder name')
    for key, typ in (("description", str), ("slots", list), ("default_slot", str)):
        if not isinstance(m.get(key), typ):
            errors.append(f'component "{name}": manifest needs "{key}" ({typ.__name__})')
    for key in ("requires", "conflicts"):
        m.setdefault(key, [])
        if not isinstance(m[key], list):
            errors.append(f'component "{name}": "{key}" must be a list')
    m.setdefault("options", {})
    m.setdefault("option_requires", {})
    if errors:
        return None, errors
    for s in m["slots"]:
        if s not in SLOTS:
            errors.append(f'component "{name}": unknown slot "{s}" in manifest (slots: {", ".join(SLOTS)})')
    if m["default_slot"] not in m["slots"]:
        errors.append(f'component "{name}": default_slot "{m["default_slot"]}" is not in its slots')
    for opt, spec in m["options"].items():
        if not isinstance(spec, dict) or spec.get("type") not in OPTION_TYPES:
            errors.append(f'component "{name}": option "{opt}" needs a "type" of {", ".join(OPTION_TYPES)}')
            continue
        if spec["type"] == "enum" and not (isinstance(spec.get("choices"), list) and spec["choices"]):
            errors.append(f'component "{name}": enum option "{opt}" needs "choices"')
            continue
        if "default" not in spec:
            errors.append(f'component "{name}": option "{opt}" needs a "default"')
            continue
        bad = check_option_value(opt, spec, spec["default"])
        if bad:
            errors.append(f'component "{name}": default of {bad}')
    for opt, by_value in m["option_requires"].items():
        if opt not in m["options"] or not isinstance(by_value, dict) or not all(
                isinstance(v, list) and all(isinstance(r, str) for r in v) for v in by_value.values()):
            errors.append(f'component "{name}": "option_requires" must map an option to {{value: [component, ...]}}')
    return (None if errors else m), errors


def load_components(components_dir: Path):
    """All manifests, keyed by name. Raises SpecError with every broken manifest."""
    found, errors = {}, []
    if not components_dir.is_dir():
        raise SpecError(f"components directory not found: {components_dir}")
    for d in sorted(p for p in components_dir.iterdir() if p.is_dir()):
        m, errs = load_manifest(d)
        errors += errs
        if m:
            m["_dir"] = d
            found[m["name"]] = m
    if errors:
        raise SpecError(errors)
    return found


# --- spec validation ---------------------------------------------------------------------------------------

def resolve_spec(raw: dict, manifests: dict, note=lambda msg: None):
    """Validate the raw TOML dict and return the resolved spec (defaults filled in, requires added, ordered)."""
    errors = []
    spec = {}
    for key in raw:
        if key not in TOP_KEYS and key not in ("theme", "layout", "components", "groups"):
            errors.append(f'unknown top-level key "{key}" (allowed: {", ".join(sorted([*TOP_KEYS, "theme", "layout", "components", "groups"]))})')
    for key, typ in TOP_KEYS.items():
        val = raw.get(key, "")
        if not isinstance(val, typ):
            errors.append(f'"{key}" must be a string')
            val = ""
        spec[key] = val
    spec["theme"] = raw.get("theme", "auto")
    if spec["theme"] not in THEMES:
        errors.append(f'theme must be one of {", ".join(THEMES)}; got {json.dumps(spec["theme"])}')

    layout = dict(LAYOUT_DEFAULTS)
    rl = raw.get("layout", {})
    if not isinstance(rl, dict):
        errors.append('"layout" must be a table')
        rl = {}
    for key, val in rl.items():
        if key not in LAYOUT_DEFAULTS:
            errors.append(f'unknown layout option "layout.{key}" (allowed: {", ".join(LAYOUT_DEFAULTS)})')
        elif key == "sidebar" and val not in ("left", "right"):
            errors.append(f'layout.sidebar must be "left" or "right"; got {json.dumps(val)}')
        elif key == "sidebar_width" and not (isinstance(val, int) and not isinstance(val, bool) and 120 <= val <= 900):
            errors.append(f"layout.sidebar_width must be an integer between 120 and 900 (px); got {json.dumps(val)}")
        elif key == "sidebar_collapsible" and not isinstance(val, bool):
            errors.append(f"layout.sidebar_collapsible must be true or false; got {json.dumps(val)}")
        else:
            layout[key] = val
    spec["layout"] = layout

    group_defs = raw.get("groups", {})
    if not isinstance(group_defs, dict) or not all(isinstance(v, dict) for v in group_defs.values()):
        errors.append('"groups" must be a table of tables ([groups."Name"])')
        group_defs = {}
    for gname, gdef in group_defs.items():
        for key, val in gdef.items():
            if key not in GROUP_DEFAULTS:
                errors.append(f'unknown option "{key}" in groups."{gname}" (allowed: {", ".join(GROUP_DEFAULTS)})')
            elif key == "collapsed" and not isinstance(val, bool):
                errors.append(f'groups."{gname}".collapsed must be true or false; got {json.dumps(val)}')
            elif key == "icon" and val not in GROUP_ICONS:
                errors.append(f'groups."{gname}".icon must be one of {", ".join(GROUP_ICONS)}; got {json.dumps(val)}')

    entries = raw.get("components", [])
    if not isinstance(entries, list) or not all(isinstance(e, dict) for e in entries):
        errors.append('"components" must be an array of tables ([[components]])')
        entries = []
    wanted = []  # resolved entries in order, before requires
    seen = set()
    for i, e in enumerate(entries, 1):
        name = e.get("name")
        if not isinstance(name, str) or not name:
            errors.append(f'components entry #{i}: "name" is required')
            continue
        for key in e:
            if key not in ("name", "slot", "options", "group"):
                errors.append(f'component "{name}": unknown key "{key}" (allowed: name, slot, options, group)')
        if "group" in e and not (isinstance(e["group"], str) and e["group"].strip()):
            errors.append(f'component "{name}": "group" must be a non-empty string')
            e = {k: v for k, v in e.items() if k != "group"}
        if name not in manifests:
            errors.append(f'unknown component "{name}" (available: {", ".join(sorted(manifests))})')
            continue
        if name in seen:
            errors.append(f'duplicate component "{name}" (each component can be used once)')
            continue
        seen.add(name)
        wanted.append(e)

    resolved, present = [], set()

    def build_entry(name, slot=None, options=None, group=None):
        m = manifests[name]
        errs = []
        slot = slot if slot is not None else m["default_slot"]
        if slot not in m["slots"]:
            errs.append(f'component "{name}": slot {json.dumps(slot)} is not allowed (allowed: {", ".join(m["slots"])})')
        options = {} if options is None else options
        if not isinstance(options, dict):
            errs.append(f'component "{name}": "options" must be a table')
            options = {}
        merged = {k: s["default"] for k, s in m["options"].items()}
        for k, v in options.items():
            if k not in m["options"]:
                known = ", ".join(m["options"]) or "none"
                errs.append(f'component "{name}": unknown option "{k}" (options: {known})')
                continue
            bad = check_option_value(k, m["options"][k], v)
            if bad:
                errs.append(f'component "{name}": {bad}')
            else:
                merged[k] = v
        errors.extend(errs)
        return {"name": name, "slot": slot, "options": merged, "group": group}

    def add(name, entry=None, parent=None):
        if name in present:
            return
        if parent is not None:  # added automatically as a requirement
            ent = build_entry(name)
            note(f'note: "{parent}" requires "{name}": added it to slot "{ent["slot"]}"')
        else:
            ent = build_entry(name, entry.get("slot"), entry.get("options"), entry.get("group"))
        for req in manifests[name]["requires"]:
            if req not in manifests:
                errors.append(f'component "{name}" requires unknown component "{req}"')
            else:
                add(req, parent=name)  # a requirement goes in front of the component that needs it
        present.add(name)
        resolved.append(ent)

    for e in wanted:
        add(e["name"], e)

    for a in resolved:  # conflicts, after requires were added
        for b in resolved:
            if a["name"] < b["name"] and (b["name"] in manifests[a["name"]]["conflicts"]
                                          or a["name"] in manifests[b["name"]]["conflicts"]):
                errors.append(f'components "{a["name"]}" and "{b["name"]}" conflict (they cannot be used together)')
    for c in resolved:  # option-dependent requires (e.g. placement "card" needs variable-cards): not added, an error
        for opt, by_value in manifests[c["name"]]["option_requires"].items():
            for req in by_value.get(str(c["options"][opt]), []):
                if req not in present:
                    errors.append(f'component "{c["name"]}" with {opt} = {json.dumps(c["options"][opt])} '
                                  f'needs component "{req}" in the spec (or choose another {opt})')
    # groups: the components of one group must sit side by side in their slot
    used = {}
    for slot_name in SLOTS:
        run_group, closed = None, set()
        for c in (c for c in resolved if c["slot"] == slot_name):
            g = c["group"]
            if g != run_group:
                if run_group is not None:
                    closed.add(run_group)
                if g is not None and g in closed:
                    errors.append(f'group "{g}" is not consecutive in slot "{slot_name}": put its components '
                                  f'next to each other (components of one group must be consecutive)')
                    closed.discard(g)  # report once
                run_group = g
            if g is not None:
                used[g] = {**GROUP_DEFAULTS, **group_defs.get(g, {})}
    for gname in group_defs:
        if gname not in used:
            note(f'note: [groups."{gname}"] is not used by any component')
    spec["groups"] = used
    spec["components"] = resolved
    if errors:
        raise SpecError(errors)
    return spec


# --- page --------------------------------------------------------------------------------------------------

def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def spec_json(spec: dict) -> str:
    """JSON for the embedded <script type="application/json">: '<' escaped so no `</script>` can end it early."""
    return json.dumps(spec, ensure_ascii=False, indent=1).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def build_html(spec: dict, manifests: dict) -> str:
    by_slot = {s: [] for s in SLOTS}
    for c in spec["components"]:
        by_slot[c["slot"]].append(c)

    group_ids = iter(range(1, 10_000))

    def roots(slot):  # no whitespace between tags: the CSS hides slots by :empty
        out, i, items = [], 0, by_slot[slot]
        while i < len(items):
            g = items[i]["group"]
            j = i + 1
            while g is not None and j < len(items) and items[j]["group"] == g:
                j += 1
            inner = "".join(f'<div class="gv-{c["name"]}" data-gv-component="{c["name"]}"></div>' for c in items[i:j])
            if g is None:
                out.append(inner)
            else:  # the header button is built by core/app.js (initGroups)
                gid = next(group_ids)
                info = spec["groups"][g]
                out.append(f'<section class="gv-group" data-gv-group="{html.escape(g)}" data-icon="{info["icon"]}">'
                           f'<div class="gv-group-body" id="gv-group-{gid}">{inner}</div></section>')
            i = j
        return "".join(out)

    def slot(name, tag="div", extra=""):
        return f'<{tag} class="gv-slot{extra}" data-slot="{name}">{roots(name)}</{tag}>'

    layout = spec["layout"]
    has_sidebar = bool(by_slot["sidebar"] or by_slot["sidebar-bottom"])
    sidebar_side = layout["sidebar"] if has_sidebar else "none"
    sidebar = f'<aside class="gv-sidebar">{slot("sidebar")}{slot("sidebar-bottom")}</aside>\n' if has_sidebar else ""
    body = (
        f'<div class="gv-app" id="gv-app" data-sidebar="{sidebar_side}" style="--gv-sb-width:{layout["sidebar_width"]}px">\n'
        f'{slot("topbar", "header", " gv-topbar")}\n{sidebar}'
        '<main class="gv-main">\n<div class="gv-mapwrap"><div id="gv-map"></div>'
        f'{slot("overlay-tl")}{slot("overlay-tr")}{slot("overlay-bl")}{slot("overlay-br")}</div>\n'
        f'{slot("bottom")}\n</main>\n</div>'
    )

    css = [read(ROOT / "core" / "theme.css"), read(ROOT / "core" / "layout.css")]
    js = [read(ROOT / "core" / "head.js")]
    for f in CORE_JS:
        js.append(f"// ---- core/{f}\n" + read(ROOT / "core" / f))
    for c in spec["components"]:
        d = manifests[c["name"]]["_dir"]
        css_file = d / "component.css"
        if css_file.is_file():
            css.append(f"/* component: {c['name']} */\n" + read(css_file))
        # a block per component: its top-level helpers stay private (components share nothing but `app`)
        js.append(f"// ---- component: {c['name']}\n{{\n" + read(d / "component.js") + "}\n")
    js.append("bootViewer().catch((e) => { console.error(e); });\n")

    title = spec["title"] or "GeoZarr viewer"
    return (
        '<!doctype html>\n'
        f'<html lang="en" data-theme="{html.escape(spec["theme"])}">\n<head>\n'
        '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="color-scheme" content="light dark">\n'
        f'<title>{html.escape(title)}</title>\n'
        f'<link rel="stylesheet" href="{OL_CSS}">\n'
        '<style>\n' + "\n".join(css) + '</style>\n</head>\n<body>\n'
        + body + "\n"
        f'<script id="spec" type="application/json">{spec_json(spec)}</script>\n'
        '<script type="module">\n' + "\n".join(js) + '</script>\n</body>\n</html>\n'
    )


# --- listing -----------------------------------------------------------------------------------------------

def toml_value(v):
    return json.dumps(v) if not isinstance(v, bool) else ("true" if v else "false")


def format_list(manifests: dict) -> str:
    out = [f"Slots: {', '.join(SLOTS)}", ""]
    for name in sorted(manifests):
        m = manifests[name]
        out.append(f"{name}: {m['description']}")
        out.append(f"  slots: {', '.join(m['slots'])} (default slot: {m['default_slot']})")
        if m["requires"]:
            out.append(f"  requires: {', '.join(m['requires'])}")
        if m["conflicts"]:
            out.append(f"  conflicts with: {', '.join(m['conflicts'])}")
        for opt, by_value in m["option_requires"].items():
            for value, reqs in by_value.items():
                out.append(f'  with {opt} = "{value}" needs: {", ".join(reqs)}')
        if m["options"]:
            out.append("  options:")
            for k, s in m["options"].items():
                t = s["type"] if s["type"] != "enum" else "enum: " + "|".join(s["choices"])
                out.append(f"    {k} ({t}, default {toml_value(s['default'])}): {s.get('doc', '')}".rstrip(": ").rstrip())
        else:
            out.append("  options: none")
        out.append("")
    return "\n".join(out)


def list_json(manifests: dict):
    return [{k: v for k, v in m.items() if not k.startswith("_")} for _, m in sorted(manifests.items())]


# --- cli ---------------------------------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Assemble a GeoZarr viewer page from a TOML spec.")
    ap.add_argument("spec", nargs="?", help="spec file (TOML), see presets/")
    ap.add_argument("-o", "--output", help="output HTML file (default: stdout)")
    ap.add_argument("--list", action="store_true", help="list the components with slots and options")
    ap.add_argument("--json", action="store_true", help="with --list: machine-readable output")
    ap.add_argument("--components", default=str(ROOT / "components"), help="component library directory")
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:  # argparse exits with 2 on usage errors already
        return int(e.code or 0)

    def fail(messages):
        for m in messages:
            print(f"error: {m}", file=sys.stderr)
        return 2

    try:
        manifests = load_components(Path(args.components))
    except SpecError as e:
        return fail(e.messages)

    if args.list:
        print(json.dumps(list_json(manifests), indent=1) if args.json else format_list(manifests))
        return 0
    if not args.spec:
        ap.print_usage(sys.stderr)
        return fail(["a SPEC file is required (or use --list)"])
    try:
        raw = tomllib.loads(read(Path(args.spec)))
    except FileNotFoundError:
        return fail([f"spec file not found: {args.spec}"])
    except tomllib.TOMLDecodeError as e:
        return fail([f"{args.spec} is not valid TOML: {e}"])
    try:
        spec = resolve_spec(raw, manifests, note=lambda msg: print(msg, file=sys.stderr))
    except SpecError as e:
        return fail(e.messages)
    page = build_html(spec, manifests)
    if args.output:
        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page, encoding="utf-8")
        print(f"wrote {out} ({len(page) // 1024} KiB, {len(spec['components'])} components)", file=sys.stderr)
    else:
        sys.stdout.write(page)
    return 0


if __name__ == "__main__":
    sys.exit(main())
