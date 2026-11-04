# geozarr-viewer

Assembles a standalone GeoZarr viewer page (OpenLayers + zarrita, no build step) from a small component library and a
TOML spec. The core (map, store loading, colourmaps, layers, frame statistics, URL state) is always included;
components (basemap selector, readout, later cards, sliders, …) are picked per page and placed in fixed layout slots.
Design and contracts: [ARCHITECTURE.md](ARCHITECTURE.md). Ported from the reference `preview.html` of
geozarr-pyramid-maker.

## Use

```sh
python3 scripts/assemble.py --list                                   # components, slots, options
python3 scripts/assemble.py presets/minimal.toml -o /tmp/viewer/index.html
python3 scripts/serve.py /tmp/viewer --port 8780                     # then open http://localhost:8780/
```

`presets/minimal.toml` shows the MUR SST demo store (`s3://spi-greenfjord-public/test/mur_sst_subset.zarr`, endpoint
`https://os.zhdk.cloud.switch.ch`). That bucket has no CORS rules, so the preset sets `relay = "/proxy/"`: the page reads
the store through `serve.py`, which forwards GET + `Range` to the bucket. `presets/blank.toml` has no store (basemaps
only); open any store with `?store=s3://bucket/path.zarr&endpoint=https://…` on the page URL.

Write your own spec (see ARCHITECTURE.md, "Spec"):

```toml
title = "My viewer"
store = "https://example.org/data.zarr"
theme = "auto"                      # auto | light | dark

[layout]
sidebar = "left"                    # left | right
sidebar_width = 320
sidebar_collapsible = true

[[components]]
name = "basemap"
slot = "topbar"

[[components]]
name = "readout"
options = { latlon = true }
```

`assemble.py` reports every problem at once (`error: …`, exit code 2) and adds required components with a `note:`.
The page must be served over http; opening the file from disk shows an error.

## Tests

```sh
python3 -m unittest discover -s tests     # assembler, serve.py (the relay tests need local sockets)
node --test                               # core pure functions, component tests, boot smoke tests (Node >= 20)
```

The boot smoke tests (`tests/core_boot.test.cjs`) run the assembled page against a fake DOM and fake OpenLayers: they
check wiring, not rendering; look at the page in a browser for that.

## Layout

`core/` (always included), `components/<name>/` (`component.js`, `component.css`, `manifest.json`, `test.cjs`),
`presets/`, `scripts/` (`assemble.py`, `serve.py`, `extract_colormaps.py`), `tests/`.
