# Storm Central add-ons

Themes and plugins are a single JSON file named `stormcentral.json`, hosted in a
public GitHub repository (or gist). Add-ons are data only: colours and map
layers. They can't run code.

## Install one

In the app: **Settings → Add-ons → Install from GitHub**, then paste any of:

- `owner/repo` (reads `stormcentral.json` from the default branch)
- a repository or folder link: `https://github.com/owner/repo/tree/main/my-theme`
- a file link: `https://github.com/owner/repo/blob/main/stormcentral.json`
- a gist: `https://gist.github.com/user/<id>`

Everything in this folder is also built into the app under **Settings →
Add-ons → Featured**, one tap each:

- Themes: Sky (animated, see below), Nord, Paper, Dracula, Solarized Dark and Light, Midnight Blue,
  Forest, Sunset, Ocean, High Contrast (`themes/`).
- Plugins (`plugins/`): Rainfall totals (1, 24, 48 or 72 hours), Wildfires,
  Earthquakes, Map boundaries, Earth from space (true colour, city lights,
  sea temperature). After adding one, choose which of its layers to show.

## Share yours

Add the topic **`stormcentral-theme`** or **`stormcentral-plugin`** to your
repository. It then shows up under **Browse community add-ons** in the app.

## Theme format

```json
{
  "type": "theme",
  "name": "Nord",
  "author": "you",
  "description": "Optional, shown in the list.",
  "version": "1.0.0",
  "base": "dark",
  "colors": { "canvas": "#242933", "surface-1": "#2e3440", "ink": "#eceff4", "accent": "#88c0d0" }
}
```

- `"sky": "vivid"` (optional) turns on Storm Central's built-in vivid sky:
  full, saturated animated backgrounds that follow the live weather and time
  of day (sun and moon, drifting clouds, rain, snow, lightning), with
  bright, airy day skies and deep starry nights. With `"sky": "vivid"`,
  `colors` may be empty to keep Storm Central's own light and dark colours,
  as the Sky theme does.
- `base` is `"dark"`, `"light"` or `"auto"` (light while the sun is up at the
  selected location, dark at night). It picks the basemap, and any colour you
  leave out comes from that built-in theme.
- Colours are hex only (`#rgb`, `#rrggbb`, `#rrggbbaa`). Slots:

| Slot | Used for |
| --- | --- |
| `canvas` | Page background |
| `surface-1`, `surface-2`, `surface-3` | Panels, controls, pressed controls |
| `line`, `line-strong` | Hairlines and borders |
| `ink`, `ink-2`, `ink-3` | Primary, secondary and muted text |
| `accent` | Links, focus, active tabs |
| `go`, `caution`, `nogo` | Good, watch and bad states |
| `series-1`, `series-2`, `series-3` | Chart lines |
| `grid` | Chart grid lines |

## Plugin format

A plugin adds up to 8 layers to the Radar and Air maps.

```json
{
  "type": "plugin",
  "name": "My overlays",
  "layers": [
    {
      "type": "raster",
      "name": "Tiles",
      "tiles": ["https://example.com/tiles/{z}/{x}/{y}.png"],
      "tileSize": 256,
      "minzoom": 0,
      "maxzoom": 12,
      "opacity": 0.7,
      "attribution": "Source name"
    },
    {
      "type": "geojson",
      "name": "Points or shapes",
      "url": "https://example.com/data.geojson",
      "color": "#ff9f0a",
      "opacity": 0.9
    }
  ]
}
```

- **raster**: an https tile URL with `{z}`, `{x}` and `{y}` (any order, so
  WMTS `{z}/{y}/{x}` works), `{quadkey}`, or (for WMS) `{bbox-epsg-3857}`.
  List each subdomain as its own URL; `{s}` isn't supported. For daily
  imagery, `{date}` becomes yesterday's UTC date (`2026-10-11`) and
  `{date-2}` … `{date-7}` go further back.
- **visible**: `false` to install a layer switched off. People choose which
  layers of a plugin to show under Settings → Add-ons.
- **geojson**: an https URL that allows cross-origin requests. Polygons are
  filled and outlined, lines drawn, points shown as dots.
- Raster layers sit above the radar and below warning polygons.

The file must be under 64 KB. Users can turn each plugin on or off and set its
opacity under Settings → Add-ons.
