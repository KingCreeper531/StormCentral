# Storm Central

**Open-data weather for people who actually watch the sky.** Storm Central pairs a quiet, instrument-style interface (with a live, weather-reactive sky behind it) with professional meteorological tooling: live NEXRAD radar with storm-track projections, a drone pilot's go/no-go board, an angler's solunar and river dashboard, air-quality heatmaps, and a community **Spotter Network** where people post and verify ground-truth reports.

Every data source is free and open. No paid weather API keys are required.

> ⚠️ Storm Central is not an official warning system. Always follow the National Weather Service and local emergency management.

For downloads, features and how to use the app, see **[stormcentralwx.com](https://www.stormcentralwx.com)**. This README is for developers.

## Development

Node.js 22.12+.

```bash
npm install
cp .env.example .env.local   # optional: every variable is documented there
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run check` | Typecheck, lint and tests (CI runs it on every pull request) |
| `npm run build` / `npm start` | Production build of the web app |
| `npm run desktop:build`, `desktop:dist` | Windows app (Electron) |
| `npm run android:build` | Android app (static export + Capacitor) |

Without a database setting, accounts and spotter reports use a local SQLite file in `data/`. On Vercel, connect a Turso database.

- How it fits together: [ARCHITECTURE.md](ARCHITECTURE.md). Design system: [docs/DESIGN.md](docs/DESIGN.md).
- YouTube Shorts and Radar School: [shorts/README.md](shorts/README.md).
- Pro data server: [pro-server/README.md](pro-server/README.md).
- Your own server (Pro data server, 24/7 YouTube live stream, local AI) in one command: [vps/README.md](vps/README.md).

## Themes and plugins

Install add-ons from GitHub under **Settings → Add-ons**: paste `owner/repo` or a
link to a `stormcentral.json`, or browse repositories tagged
`stormcentral-theme` / `stormcentral-plugin`. Themes recolour the app; plugins
add tile or GeoJSON layers to the Radar and Air maps. Add-ons are JSON only and
never run code.

### Make your own

1. Create a public GitHub repository (or a gist) with one file, `stormcentral.json`.
2. For a **theme**, set the colours you want to change; anything left out comes from the dark or light base:

   ```json
   {
     "type": "theme",
     "name": "Nord",
     "author": "you",
     "base": "dark",
     "colors": { "canvas": "#242933", "surface-1": "#2e3440", "ink": "#eceff4", "accent": "#88c0d0" }
   }
   ```

   For a **plugin**, list up to 8 map layers: map tiles (`raster`) or shapes and points (`geojson`):

   ```json
   {
     "type": "plugin",
     "name": "My overlays",
     "layers": [
       { "type": "raster", "name": "Tiles", "tiles": ["https://example.com/tiles/{z}/{x}/{y}.png"], "opacity": 0.7, "attribution": "Source name" },
       { "type": "geojson", "name": "Points or shapes", "url": "https://example.com/data.geojson", "color": "#ff9f0a" }
     ]
   }
   ```

3. Try it: **Settings → Add-ons → Install from GitHub**, paste `your-name/your-repo`.
4. Share it: add the topic **`stormcentral-theme`** or **`stormcentral-plugin`** to the repository, and it shows up under **Browse community add-ons** in the app (forks too). The repository must be public, and GitHub can take a few minutes to list a newly tagged one.

Every colour slot and layer option, plus ready-made examples to copy (Nord, Dracula, Sky, rainfall totals, wildfires, earthquakes and more), are in [`examples/addons`](examples/addons).

## Data sources

| Data | Source |
|---|---|
| Forecast, nowcast, recent rainfall, air quality and smoke, pollen, geocoding | [Open-Meteo](https://open-meteo.com) (CC BY 4.0) |
| Radar: MRMS national mosaic, super-resolution NEXRAD reflectivity and velocity | [NOAA/NWS GeoServer](https://opengeo.ncep.noaa.gov) (radar.weather.gov's backend) |
| Other radar products, and radar fallback | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu) |
| Watches, warnings, storm motion | [api.weather.gov](https://www.weather.gov/documentation/services-web-api) |
| Watch, warning and advisory polygons (zone- and county-based) | [NWS WWA map service](https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer) |
| Mesoscale discussions, watch boxes, precipitation discussions | SPC and WPC via the [Iowa Environmental Mesonet API](https://mesonet.agron.iastate.edu/api/1/docs) |
| Canadian warnings and radar | [Environment and Climate Change Canada](https://eccc-msc.github.io/open-data/) (GeoMet) |
| German warnings and radar | [Deutscher Wetterdienst](https://www.dwd.de/opendata) (GeoServer) |
| Finnish, Dutch and Japanese radar | [FMI](https://en.ilmatieteenlaitos.fi/open-data), [KNMI](https://www.knmi.nl/), [JMA](https://www.jma.go.jp/bosai/nowc/) |
| Convective outlook and hazard probabilities | [Storm Prediction Center](https://www.spc.noaa.gov) |
| Local storm reports, NEXRAD storm-cell attributes | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu) |
| Tropical cyclones (positions, cone, track) | [National Hurricane Center](https://www.nhc.noaa.gov) + NOAA map services |
| Lightning: GOES GLM flashes (Pro data server), strike density otherwise | [NOAA Open Data on AWS](https://registry.opendata.aws/noaa-goes/), [NOAA nowCOAST](https://nowcoast.noaa.gov) |
| HRRR forecast reflectivity (future radar) | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/GIS/model.phtml) |
| NEXRAD Level II and III files (Pro mode, and its archive back to 1995) | [NOAA Open Data on AWS](https://registry.opendata.aws/noaa-nexrad/) |
| Radar archive: national mosaic, warnings and storm reports at a past time | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu) |
| GOES ABI channels and MRMS grids (Pro data server) | [NOAA Open Data on AWS](https://registry.opendata.aws/noaa-goes/) |
| GOES water vapor (Pro mode) | [NOAA nowCOAST](https://nowcoast.noaa.gov) |
| Model soundings and cross-sections (Pro mode) | [Open-Meteo](https://open-meteo.com) pressure-level forecasts |
| GOES-East/West satellite imagery | [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) |
| Planetary Kp | [NOAA SWPC](https://www.swpc.noaa.gov) |
| River discharge, stage, water temperature | [USGS Water Services](https://waterservices.usgs.gov) (OGC API fallback) |
| River forecast points, flood stages and forecast crests | [NOAA National Water Prediction Service](https://water.noaa.gov) |
| Forecaster notes (Area Forecast Discussion) | [api.weather.gov](https://www.weather.gov/documentation/services-web-api) |
| Daily normals (1991–2020) and records | [NOAA ACIS](https://www.rcc-acis.org) (threaded NWS climate sites) |
| Active wildfires | [NIFC WFIGS](https://data-nifc.opendata.arcgis.com) |
| Live cameras | [Caltrans](https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm) traffic, [ALERTCalifornia](https://cameras.alertcalifornia.org) (UC San Diego) wildfire, [USGS](https://api.waterdata.usgs.gov/docs/nims/) river and [USGS AshCam](https://volcview.wr.usgs.gov) volcano cameras; images load from each owner, credited on the card |
| GNSS orbital elements | [CelesTrak](https://celestrak.org) |
| Reverse geocoding | BigDataCloud free client API |
| Forecast models you can pick (ECMWF, ECMWF AI, GFS, NBM, ICON, GEM, UK Met Office, Météo-France, JMA) | [Open-Meteo](https://open-meteo.com) |
| Google forecast (each person's own key) | [Google Maps Platform Weather API](https://developers.google.com/maps/documentation/weather) |

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. To show weather, it sends the coordinates of the places you look at to the public weather data services listed under [Data sources](#data-sources). It checks GitHub Releases for app updates. Google receives requests only if you add your own Google Weather API key, and a spotter network server only if you sign in to one. Storm Central has no analytics, tracking or advertising.

## Credits

- Weather icons: [Makin-Things/weather-icons](https://github.com/Makin-Things/weather-icons), MIT.
- WSR-88D site metadata: [supercell-wx](https://github.com/dpaulat/supercell-wx) (MIT), cross-checked against Py-ART.
- MapLibre GL JS (BSD-3). Basemap © CARTO © OpenStreetMap contributors.
- Weather data © Open-Meteo (CC BY 4.0), NOAA/NWS/SPC/SWPC, Iowa Environmental Mesonet, USGS, CelesTrak.

MIT © 2026 KingCreeper531
