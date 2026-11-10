"""Tests of scripts/assemble.py: valid specs, every validation error, requires resolution, --list."""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "assemble.py"


def run(*args, cwd=None):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True, cwd=cwd)


def make_component(base: Path, name: str, **manifest):
    """Write a tiny component into `base/<name>/` (for the tests that need requires/conflicts)."""
    d = base / name
    d.mkdir(parents=True)
    m = {"name": name, "description": f"test component {name}", "slots": ["sidebar", "overlay-tl"],
         "default_slot": "sidebar", "requires": [], "conflicts": [], "options": {}}
    m.update(manifest)
    (d / "manifest.json").write_text(json.dumps(m))
    (d / "component.js").write_text(f"registerComponent({{name: '{name}', init(app, root, opts) {{}}}});\n")
    (d / "component.css").write_text(f".gv-{name} {{ color: red; }}\n")


def markup(html):
    """The <body> markup (slots), without the embedded CSS/JS."""
    return html.split("<body>")[1].split('<script id="spec"')[0]


class AssembleTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def spec(self, text: str) -> Path:
        p = self.tmp / "spec.toml"
        p.write_text(text)
        return p

    def build(self, text, *extra):
        out = self.tmp / "out.html"
        r = run(self.spec(text), "-o", out, *extra)
        return r, (out.read_text() if out.exists() else None)

    # --- valid specs ---------------------------------------------------------------------------------------

    def test_presets_build(self):
        for preset in sorted(p.stem for p in (ROOT / "presets").glob("*.toml")):
            out = self.tmp / f"{preset}.html"
            r = run(ROOT / "presets" / f"{preset}.toml", "-o", out)
            self.assertEqual(r.returncode, 0, r.stderr)
            html = out.read_text()
            self.assertEqual(len(re.findall(r'<script type="module">', html)), 1)
            self.assertEqual(html.count("<style>"), 1)
            self.assertIn("ol@10.10.0", html)
            self.assertIn("zarrita@0.7.3", html)
            self.assertTrue(html.rstrip().endswith("</html>"))
            self.assertIn("bootViewer();", html)

    def test_minimal_preset_content(self):
        out = self.tmp / "m.html"
        self.assertEqual(run(ROOT / "presets" / "minimal.toml", "-o", out).returncode, 0)
        html = out.read_text()
        m = re.search(r'<script id="spec" type="application/json">(.*?)</script>', html, re.S)
        spec = json.loads(m.group(1))
        self.assertEqual(spec["store"], "s3://spi-greenfjord-public/test/mur_sst_subset.zarr")
        self.assertEqual(spec["relay"], "/proxy/")
        self.assertEqual([c["name"] for c in spec["components"]], ["basemap", "readout"])
        ro = spec["components"][1]
        self.assertEqual(ro["options"], {"latlon": True})  # manifest defaults are resolved into the spec
        self.assertIn('data-gv-component="readout"', html)
        self.assertIn("registerComponent({\n  name: 'readout'", html)
        self.assertIn(".gv-readout {", html)  # component css included

    def test_defaults_slot_and_layout(self):
        r, html = self.build('title = "T"\n[[components]]\nname = "readout"\n')
        self.assertEqual(r.returncode, 0, r.stderr)
        spec = json.loads(re.search(r'<script id="spec" type="application/json">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(spec["components"][0]["slot"], "overlay-br")
        self.assertEqual(spec["layout"], {"sidebar": "left", "sidebar_width": 320, "sidebar_collapsible": True,
                                          "sidebar_resizable": True})
        self.assertEqual(spec["theme"], "auto")
        self.assertIn('data-sidebar="none"', html)  # nothing in the sidebar slot

    def test_sidebar_layout_options(self):
        r, html = self.build('[layout]\nsidebar = "right"\nsidebar_width = 400\n'
                             '[[components]]\nname = "basemap"\nslot = "sidebar"\n')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('data-sidebar="right"', html)
        self.assertIn("--gv-sb-width:400px", html)

    def test_title_and_json_are_escaped(self):
        r, html = self.build('title = "</script><b>x"\n')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("</script><b>", html)
        self.assertEqual(html.count("</script>"), 2)  # spec + module only

    def test_inline_svg_favicon(self):
        r, html = self.build("")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,', html)

    def test_stdout_without_o(self):
        r = run(self.spec(""))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("<!doctype html>"))

    # --- validation errors ---------------------------------------------------------------------------------

    def assertInvalid(self, text, *needles):
        r, html = self.build(text)
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIsNone(html)
        for n in needles:
            self.assertIn(n, r.stderr)
        return r

    def test_unknown_component(self):
        self.assertInvalid('[[components]]\nname = "nope"\n', "unknown component", "nope", "readout")

    def test_slot_not_allowed(self):
        self.assertInvalid('[[components]]\nname = "readout"\nslot = "topbar"\n', "slot", "topbar", "overlay-br")

    def test_unknown_option(self):
        self.assertInvalid('[[components]]\nname = "readout"\noptions = { bogus = 1 }\n', "unknown option", "bogus", "latlon")

    def test_option_wrong_type(self):
        self.assertInvalid('[[components]]\nname = "readout"\noptions = { latlon = "yes" }\n', "latlon", "bool")

    def test_option_enum_choice(self):
        self.assertInvalid('[[components]]\nname = "basemap"\noptions = { default = "pink" }\n', "default", "pink", "dark")

    def test_unknown_top_level_key_and_layout_key(self):
        self.assertInvalid('colour = "red"\n', "unknown", "colour")
        self.assertInvalid('[layout]\nsidebar = "middle"\n', "layout.sidebar", "left")
        self.assertInvalid('[layout]\nwidth = 3\n', "unknown", "layout.width")
        self.assertInvalid('theme = "sepia"\n', "theme", "auto")

    def test_duplicate_component(self):
        self.assertInvalid('[[components]]\nname = "readout"\n[[components]]\nname = "readout"\n', "duplicate", "readout")

    def test_missing_name_and_bad_toml(self):
        self.assertInvalid('[[components]]\nslot = "sidebar"\n', "name")
        r = run(self.spec("this is = = not toml"), "-o", self.tmp / "x.html")
        self.assertEqual(r.returncode, 2)
        self.assertIn("TOML", r.stderr)

    def test_missing_spec_file(self):
        r = run(self.tmp / "absent.toml", "-o", self.tmp / "x.html")
        self.assertEqual(r.returncode, 2)

    def test_all_errors_reported_together(self):
        r = self.assertInvalid('[[components]]\nname = "nope"\n[[components]]\nname = "readout"\nslot = "topbar"\n',
                               "nope", "topbar")
        self.assertEqual(r.stderr.count("error:"), 2)

    # --- requires / conflicts ------------------------------------------------------------------------------

    def test_requires_added_with_note(self):
        comps = self.tmp / "comps"
        make_component(comps, "base")
        make_component(comps, "extra", requires=["base"], slots=["overlay-tl"], default_slot="overlay-tl")
        r, html = self.build('[[components]]\nname = "extra"\n', "--components", comps)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("note:", r.stderr)
        self.assertIn("base", r.stderr)
        spec = json.loads(re.search(r'<script id="spec" type="application/json">(.*?)</script>', html, re.S).group(1))
        self.assertEqual([c["name"] for c in spec["components"]], ["base", "extra"])  # required one comes first
        self.assertIn("name: 'base'", html)

    def test_option_requires_fails_with_clear_message(self):
        comps = self.tmp / "comps"
        make_component(comps, "cards")
        make_component(comps, "legend2", options={"placement": {"type": "enum", "choices": ["card", "overlay"],
                       "default": "overlay"}}, option_requires={"placement": {"card": ["cards"]}})
        spec = self.spec('[[components]]\nname = "legend2"\noptions = { placement = "card" }\n')
        r = run(spec, "-o", self.tmp / "x.html", "--components", comps)
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn('"legend2"', r.stderr)
        self.assertIn('placement = "card"', r.stderr)
        self.assertIn('"cards"', r.stderr)
        # fine with the required component present, or with another value
        ok = self.spec('[[components]]\nname = "cards"\n[[components]]\nname = "legend2"\noptions = { placement = "card" }\n')
        self.assertEqual(run(ok, "-o", self.tmp / "x.html", "--components", comps).returncode, 0)
        ok = self.spec('[[components]]\nname = "legend2"\n')
        self.assertEqual(run(ok, "-o", self.tmp / "x.html", "--components", comps).returncode, 0)

    def test_real_card_placement_needs_variable_cards(self):
        for name in ("legend", "style-controls"):
            r, _ = self.build(f'[[components]]\nname = "{name}"\noptions = {{ placement = "card" }}\n')
            self.assertEqual(r.returncode, 2, name)
            self.assertIn("variable-cards", r.stderr)

    def test_requires_already_present_is_silent(self):
        comps = self.tmp / "comps"
        make_component(comps, "base")
        make_component(comps, "extra", requires=["base"])
        r, _ = self.build('[[components]]\nname = "base"\n[[components]]\nname = "extra"\n', "--components", comps)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("note:", r.stderr)

    def test_requires_unknown_component_is_an_error(self):
        comps = self.tmp / "comps"
        make_component(comps, "extra", requires=["ghost"])
        r, _ = self.build('[[components]]\nname = "extra"\n', "--components", comps)
        self.assertEqual(r.returncode, 2)
        self.assertIn("ghost", r.stderr)

    def test_conflicts(self):
        comps = self.tmp / "comps"
        make_component(comps, "cards", conflicts=["dropdown"])
        make_component(comps, "dropdown", conflicts=["cards"])
        r, _ = self.build('[[components]]\nname = "cards"\n[[components]]\nname = "dropdown"\n', "--components", comps)
        self.assertEqual(r.returncode, 2)
        self.assertIn("conflict", r.stderr)
        self.assertIn("cards", r.stderr)
        self.assertIn("dropdown", r.stderr)

    def test_required_component_conflict_after_auto_add(self):
        comps = self.tmp / "comps"
        make_component(comps, "a", conflicts=["b"])
        make_component(comps, "b")
        make_component(comps, "c", requires=["b"])
        r, _ = self.build('[[components]]\nname = "a"\n[[components]]\nname = "c"\n', "--components", comps)
        self.assertEqual(r.returncode, 2)
        self.assertIn("conflict", r.stderr)

    # --- groups and sidebar-bottom -------------------------------------------------------------------------

    def test_sidebar_bottom_slot_is_emitted_and_pinned(self):
        r, html = self.build('[[components]]\nname = "label-mode"\nslot = "sidebar-bottom"\n')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('data-slot="sidebar-bottom"', html)
        self.assertIn('<aside class="gv-sidebar">', html)
        self.assertIn('data-sidebar="left"', html)
        self.assertRegex(html, r'<div class="gv-slot" data-slot="sidebar-bottom"><div class="gv-label-mode"')

    def test_no_sidebar_without_sidebar_components(self):
        r, html = self.build('[[components]]\nname = "readout"\n')
        self.assertNotIn('<aside', html)

    def test_sidebar_manifests_allow_sidebar_bottom(self):
        data = json.loads(run("--list", "--json").stdout)
        for c in data:
            if "sidebar" in c["slots"] and c["name"] != "variable-cards":  # the card list scrolls with the main sidebar
                self.assertIn("sidebar-bottom", c["slots"], c["name"])
        for name in ("basemap", "label-mode", "dim-roles", "cmap-sources", "center-lon"):
            self.assertIn("sidebar-bottom", next(c for c in data if c["name"] == name)["slots"])

    GROUPED = (
        '[[components]]\nname = "label-mode"\nslot = "sidebar-bottom"\ngroup = "Global settings"\n\n'
        '[[components]]\nname = "basemap"\nslot = "sidebar-bottom"\ngroup = "Global settings"\n')

    def test_group_wraps_consecutive_components(self):
        r, html = self.build(self.GROUPED)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(markup(html).count('<section class="gv-group"'), 1)
        m = re.search(r'<section class="gv-group" data-gv-group="Global settings"[^>]*><div class="gv-group-body" id="(gv-group-\d+)">'
                      r'<div class="gv-label-mode"[^>]*></div><div class="gv-basemap"[^>]*></div></div></section>', html)
        self.assertTrue(m, html[html.index("<body>"):][:900])
        spec = json.loads(re.search(r'<script id="spec" type="application/json">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(spec["groups"], {"Global settings": {"collapsed": False, "icon": "gear"}})
        self.assertEqual([c["group"] for c in spec["components"]], ["Global settings"] * 2)

    def test_ungrouped_components_have_no_group_and_no_section(self):
        r, html = self.build('[[components]]\nname = "label-mode"\n')
        self.assertNotIn('<section', markup(html))
        spec = json.loads(re.search(r'<script id="spec" type="application/json">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(spec["groups"], {})
        self.assertIsNone(spec["components"][0]["group"])

    def test_groups_table_sets_state_and_icon(self):
        r, html = self.build(self.GROUPED + '\n[groups."Global settings"]\ncollapsed = true\nicon = "none"\n')
        self.assertEqual(r.returncode, 0, r.stderr)
        spec = json.loads(re.search(r'<script id="spec" type="application/json">(.*?)</script>', html, re.S).group(1))
        self.assertEqual(spec["groups"]["Global settings"], {"collapsed": True, "icon": "none"})

    def test_groups_table_errors(self):
        self.assertInvalid(self.GROUPED + '\n[groups."Global settings"]\nicon = "star"\n', 'icon')
        self.assertInvalid(self.GROUPED + '\n[groups."Global settings"]\ncollapsed = "yes"\n', 'collapsed')
        self.assertInvalid(self.GROUPED + '\n[groups."Global settings"]\nfoo = 1\n', 'foo')
        self.assertInvalid(self.GROUPED + '\ngroups = 3\n', 'groups')

    def test_bad_group_name(self):
        self.assertInvalid('[[components]]\nname = "label-mode"\ngroup = ""\n', 'group')
        self.assertInvalid('[[components]]\nname = "label-mode"\ngroup = 3\n', 'group')

    def test_non_consecutive_group_is_an_error(self):
        text = ('[[components]]\nname = "label-mode"\nslot = "sidebar-bottom"\ngroup = "G"\n\n'
                '[[components]]\nname = "dim-roles"\nslot = "sidebar-bottom"\n\n'
                '[[components]]\nname = "basemap"\nslot = "sidebar-bottom"\ngroup = "G"\n')
        self.assertInvalid(text, 'group "G"', "sidebar-bottom", "consecutive")

    def test_same_group_name_in_two_slots_is_fine(self):
        text = ('[[components]]\nname = "label-mode"\nslot = "sidebar"\ngroup = "G"\n\n'
                '[[components]]\nname = "basemap"\nslot = "overlay-tl"\ngroup = "G"\n')
        r, html = self.build(text)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(markup(html).count('<section class="gv-group"'), 2)

    def test_group_name_is_html_escaped(self):
        r, html = self.build('[[components]]\nname = "label-mode"\ngroup = "A <b> \\"q\\""\n')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("<b>", html.split("<body>")[1].split('<script id="spec"')[0])

    def test_full_and_analyst_presets_use_global_settings(self):
        for preset in ("full", "analyst"):
            r, html = self.build((ROOT / "presets" / f"{preset}.toml").read_text())
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn('data-gv-group="Global settings"', html, preset)
            self.assertIn('data-slot="sidebar-bottom"', html)
        r, html = self.build((ROOT / "presets" / "full.toml").read_text())
        spec = json.loads(re.search(r'<script id="spec" type="application/json">(.*?)</script>', html, re.S).group(1))
        in_group = {c["name"] for c in spec["components"] if c["group"] == "Global settings"}
        self.assertEqual(in_group, {"label-mode", "basemap", "dim-roles", "cmap-sources", "center-lon"})
        self.assertTrue(all(c["slot"] == "sidebar-bottom" for c in spec["components"] if c["group"]))

    # --- --list --------------------------------------------------------------------------------------------

    def test_list(self):
        r = run("--list")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout
        for needle in ("basemap", "readout", "Pointer value of each visible variable plus lat/lon", "overlay-br",
                       "default slot", "latlon", "bool", "dark"):
            self.assertIn(needle, out)

    def test_list_json(self):
        r = run("--list", "--json")
        data = json.loads(r.stdout)
        folders = {d.name for d in (ROOT / "components").iterdir() if d.is_dir()}
        self.assertEqual({c["name"] for c in data}, folders)
        for c in data:
            self.assertIn("slots", c)
            self.assertIn("options", c)
        ro = next(c for c in data if c["name"] == "readout")
        self.assertEqual(ro["default_slot"], "overlay-br")
        self.assertEqual(ro["options"]["latlon"]["default"], True)

    def test_no_arguments_is_usage_error(self):
        r = run()
        self.assertEqual(r.returncode, 2)

    def test_broken_manifest_is_reported(self):
        comps = self.tmp / "comps"
        make_component(comps, "bad", default_slot="nowhere")
        r = run("--list", "--components", comps)
        self.assertEqual(r.returncode, 2)
        self.assertIn("bad", r.stderr)


if __name__ == "__main__":
    unittest.main()
