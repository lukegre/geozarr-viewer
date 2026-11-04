---
name: geozarr-viewer
description: Build a custom standalone web viewer (single HTML page) for a GeoZarr / Zarr v3 multiscale store by picking components (variable cards or dropdown, colour controls, legend, timeline, sliders, readout, info panel, basemap…) and placing them in fixed layout slots. Use when the user wants a map viewer, preview page or dashboard for a GeoZarr pyramid, or wants to change the layout or components of such a viewer.
---

# geozarr-viewer

Assemble a viewer page from `components/` with `scripts/assemble.py`. Paths below are relative to this skill's
folder. Read `ARCHITECTURE.md` only when you need to change core or write a new component.

## 1. Interview (short, one round if possible)

Run `python3 scripts/assemble.py --list` first; it is the source of truth for components, slots and options.
Then ask, with AskUserQuestion where it fits (offer a preset as the first, recommended option):

1. **Store**: path or URL (`s3://…`, `https://…`, relative path) and S3 endpoint if any. Does the host send
   CORS headers? If unknown or no, the page needs `relay = "/proxy/"` and `scripts/serve.py`.
2. **Starting point**: a preset from `presets/` (`full` ≈ the original preview page, `minimal`, `kiosk`, …)
   or build from scratch.
3. **Layout**: sidebar left / right / none, width, collapsible; theme auto / light / dark.
4. **Components and placement**: which ones, in which slot (`topbar`, `sidebar`, `sidebar-bottom`, `bottom`, `overlay-tl/tr/bl/br`).
   Offer a collapsible **"Global settings"** block pinned to the bottom of the sidebar (slot `sidebar-bottom`,
   `group = "Global settings"`) for the rarely changed settings: label by, basemap, dimensions, colourmap sources,
   centre longitude. Groups (`group = "Name"`) also work in other slots; ask whether it starts collapsed.
   Mention the real alternatives: `variable-cards` vs `variable-dropdown`; legend in the card vs as a map
   overlay; style controls in the card vs a panel; timeline vs only sliders.
5. **Options** that matter for their choice (only the ones `--list` shows for chosen components).

Don't ask what a preset already answers unless the user wants to change it.

## 2. Write the spec

Write a TOML spec next to where the user wants the page (default: `<project>/viewer/viewer.toml`):

```toml
title = "…"
store = "…"          # optional; ?store= in the URL overrides it
endpoint = "…"
relay = ""           # "/proxy/" when served by scripts/serve.py for a store without CORS
theme = "auto"

[layout]
sidebar = "left"     # left | right
sidebar_width = 320
sidebar_collapsible = true

[[components]]
name = "variable-cards"
slot = "sidebar"
options = { drag = true }

# optional: settings in a collapsible block pinned to the bottom of the sidebar
[groups."Global settings"]
collapsed = false    # initial state; icon = "gear" | "none"

[[components]]
name = "basemap"
slot = "sidebar-bottom"
group = "Global settings"   # consecutive components of one group share one block
```

Components in one slot stack in spec order; a group's components must be consecutive (else exit 2). Omit `slot` to use the component's default slot.

## 3. Build

```
python3 scripts/assemble.py SPEC.toml -o OUT.html
```

Exit code 2 means the spec is invalid; the message says why (unknown component, slot not allowed, bad option,
conflict). Fix the spec, never the assembler, unless the assembler is wrong. Required components are added
automatically (stderr note): tell the user.

## 4. Check it

- Serve: `python3 scripts/serve.py OUT_DIR --port 8780` (static + `/proxy/` relay), then open
  `http://localhost:8780/OUT.html`. Use the browser preview tool if available: wait for tiles, take a
  screenshot, read console errors. 404s for `.zattrs`/`.zgroup` are harmless zarr v2 probes.
- Show the user the screenshot; iterate on the spec (layout, slots, options) until they are happy.

## 5. Hand over

Give the user the spec and HTML paths and the serve command. The HTML is standalone: any static host works for
stores with CORS; others need a relay like `serve.py`.

## Changing or adding components

When no option covers what the user wants:
- Small change to one component: edit `components/<name>/` and its `test.cjs`; keep the contract in
  `ARCHITECTURE.md` (components talk only through `app` and the bus; CSS under `.gv-<name>` with `--gv-*` tokens).
- New component: copy the closest component folder, update `manifest.json` (slots, options, requires,
  conflicts), write tests first.
- Run `python3 -m unittest discover -s tests` and `node --test` before rebuilding.
