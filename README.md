# Storm Central

**Open-data weather for people who actually watch the sky.** Storm Central pairs a quiet, instrument-style interface (with a live, weather-reactive sky behind it) with professional meteorological tooling: live NEXRAD radar with storm-track projections, a drone pilot's go/no-go board, an angler's solunar and river dashboard, air-quality heatmaps, and a community **Spotter Network** where people post and verify ground-truth reports.

Every data source is free and open. No paid weather API keys are required.

> ⚠️ Storm Central is not an official warning system. Always follow the National Weather Service and local emergency management.

## Download

Get it at **[stormcentralwx.com](https://www.stormcentralwx.com)**: Windows from the [Microsoft Store](https://apps.microsoft.com/detail/9P3SXT2T0CLQ) or as an installer, Android as an APK, or [in your browser](https://storm-central-pi.vercel.app). Every version is also on **[Releases](https://github.com/KingCreeper531/StormCentral/releases/latest)**.

| Device | File | Updates |
|---|---|---|
| **Windows 10 / 11** (64-bit) | `StormCentral-Setup-<version>.exe` | Automatic. The app downloads new releases in the background and asks to restart. |
| **Android 7.0+** | `StormCentral-<version>.apk` | In the app (0.4.3 and newer). Tap **Update** and it downloads and installs itself; Android asks once to allow it. With automatic updates on (Settings → App), new versions install in the background, and on Android 12+ without a prompt after the first in-app update. |

- **Windows:** the installer isn't code-signed yet, so SmartScreen may say "Windows protected your PC". Choose **More info → Run anyway**. It installs for your user only, with no admin prompt.
- **Android:** open the APK on your phone and allow your browser to install apps when asked.
- **Self-contained:** both apps work with no server. The Windows app runs Storm Central's own server on your PC, so every feature works, including accounts and reports (stored on that PC). The Android app runs the weather feeds on the phone. The spotter network needs a shared server, so it's off in the Android app for now.

---

## Modes

Press **1–5** (and **6** for Pro, when it's on) to switch modes and **⌘K / Ctrl-K** to search any place. Hovering a mode tab prefetches its data. On phones the modes live in a bottom tab bar, and Radar mode's warnings and layer controls sit in a draggable bottom sheet (peek / half / full).

| Mode | What you get |
|---|---|
| **Daily** | Conditions hero with an animated sky that tracks the real sun position; 15-minute nowcast; 24 h temperature and precipitation charts; 10-day range bars; wind compass, pressure tendency, UV, visibility, AQI, sun arc and moon phase; live radar preview; **SPC tornado / hail / wind probabilities** when you're in a risk area; a **Forecast from** picker at the top that switches the whole app's forecast between Open-Meteo's best match, ECMWF, ECMWF AI, GFS, the NWS Blend, ICON, GEM, the UK Met Office, Météo-France, JMA or Google (your own key); **forecaster notes** (your NWS office's discussion with key messages up front, the full text and a jargon decoder); **compared with normal** (official normals and record highs/lows for the date, rain this month vs. normal, the week's departures); **rainfall and flooding** (totals so far and ahead, flood alerts, NWS river gauges with flood stages and forecast crests); **fire and smoke** (fire-weather level for 3 days, smoke/haze from PM2.5, Red Flag Warnings and active wildfires nearby); spotter reports near you. Every panel can be moved, placed left, right or full width, hidden and brought back (**Customize this page** at the bottom). |
| **Radar** (fullscreen) | NEXRAD national mosaic or any single WSR-88D site, with **future radar** (the next 6 hours of HRRR model reflectivity after the live loop) and **lightning** (NOAA strike density, last 15 minutes). Products: reflectivity, velocity, storm-relative velocity, CC, ZDR and hydrometeor classification. Tilt selection is driven by what the radar is actually producing. Buffer-aware loop playback (play/pause/step, 0.5–4×, cross-fade). NWS warning polygons in official hazard colors with PDS/emergency tags, plus **every other hazard polygon** you choose: watches, advisories, statements, marine products, SPC mesoscale discussions and watch boxes, WPC precipitation discussions, and Canadian and German warnings. **Other countries' radar** (Canada, Germany, Finland, the Netherlands, Japan) loops in step with the US radar. **projected storm tracks with ETA to your location**, SPC Day 1 outlook (categorical or **tornado / hail / wind probabilities**, hatched where significant), **official NWS storm reports** (hail size, wind speed, tornadoes, fading with age), **NEXRAD storm cells** (TVS, mesocyclone, max hail size, 15–60 min forecast track and arrival time at your location), the **NHC hurricane tracker** (cone, track, intensity forecast), **GOES infrared / visible satellite** looping with the radar, and **export the loop as a GIF or video**. |
| **UAV Pilot** | Flyability score with a factor breakdown per airframe class, an hourly go/no-go strip, wind at flight altitude vs. the airframe limit, a 10/80/120/180 m wind profile with **bulk shear and veer**, NOAA Kp index, **GNSS sky plot with satellite count and PDOP/HDOP** (SGP4 from CelesTrak), an estimated cloud ceiling against the Part 107 500-ft clearance, visibility and density altitude. |
| **Angler** | Bite Index with explained reasons, an hourly bite timeline with solunar bands, moon phase and solunar major/minor periods, a 48 h barometer with Met Office tendency terms, **USGS real-time river gauges** (discharge, stage, 24 h change, water temperature), and an estimated water temperature where no gauge reports one. |
| **Air & Allergy** | A **model-derived AQI / PM2.5 heatmap** sampled across the visible map, current US AQI with health guidance, pollutant breakdown, 48 h AQI and UV forecast, the cleanest 2-hour outdoor window, and NAB-scaled pollen (CAMS covers Europe). |
| **Pro** (fullscreen, optional) | An AWIPS II-style workspace for advanced users, switched on under **Settings → General → Professional mode**. Up to **nine map panels** (1×1, 1×2, 2×2, 3×3) that pan, zoom and loop together, each with its own product, opacity, warnings and storm cells. Site radar is decoded straight from NOAA's NEXRAD files: reflectivity, velocity, SRV, CC, ZDR, HC and KDP at all six Level III tilts, digital VIL and echo tops, and on desktop **any tilt of the Level II volume up to 19.5°**. Also MRMS mosaic, composite reflectivity and echo tops, and GOES visible, clean IR, water vapor, Air Mass, GeoColor, Dust and Fire Temperature. An optional **Pro data server** (`pro-server/`, e.g. on an Oracle Cloud free VM) adds GOES Day Cloud Phase, Night Fog and Sandwich, and MRMS hail size, rotation tracks and VIL. A **cursor readout** samples every panel at once (exact values for decoded radar) along with ground height, range and bearing from the radar, and model T, Td, CAPE, CIN, 0–3 km shear and PWAT. Tools: **model soundings** (Skew-T with SB/ML/MU parcels, CAPE/CIN, LI, PWAT, lapse rates, hodograph with Bunkers motion, 0–1/0–3 km SRH, critical angle), a **vertical cross-section** along A–A′ (θe, 0 °C and −20 °C), a **storm vector** from two clicks, a **time-of-arrival fan** for your places, a **warning inspector** with the impact-based tags (Considerable, Destructive, Observed) and HAZARD/SOURCE/IMPACT text, and **WarnGen for the spotter network**. With WarnGen you pick the storm, and it draws an editable track-based polygon, adds IBW tags and generates WarnGen-style product text. Warnings go only to signed-in spotters and are always marked unofficial; issuing needs the Trusted Spotter rank. Panels can also show other countries' radar. Phones get a lighter version (two panels, shorter loops, no Level II). How it works: [ARCHITECTURE.md § 9](ARCHITECTURE.md#9-professional-mode). |

## Beyond a typical weather app

- **Spotter Network**: sign in, post geotagged reports with photos and a severity level, and verify each other's observations. Confirmations build reputation tiers (Observer → Spotter → Trusted Spotter → Storm Chaser → Legend). Reports show up on the radar map. Chasing? Turn on **Share my location as a storm chaser** (Settings → Account, off by default, for 1–12 hours) and signed-in spotters see your live position, speed and heading on the radar's **Storm chasers** layer.
- **Ground truth vs. model**: each report stores what the forecast model said at that moment, so you can see where the model missed.
- **Privacy by default**: report locations are rounded to about 1 km unless you opt in to precise GPS. Photo EXIF/GPS is stripped on your device *and* again on the server.
- **Storm ETA**: the machine-readable storm-motion line in each NWS warning is parsed into a projected track and a live arrival estimate for your location.
- **Warning polygon test**: the alert banner tells you when you're *inside* a storm-based warning, not just inside the county.
- **Saved places and notifications**: save up to 10 places and get a notification when a warning is issued for any of them. Windows keeps checking from the tray; Android checks about every 15 minutes in the background, even with the app closed.
- **Rain starting soon**: the 15-minute forecast tells you when rain or snow starts where you are, how hard and for how long ("Rain starting in about 20 min · Moderate rain, lasting about 45 min"), once per spell.
- **Storms heading your way**: radar storm tracking is projected onto your places; the Daily page shows the arrival time, hail size and motion of any strong storm due within the hour, and a notification announces it.
- **More notifications**: morning briefing, lightning nearby, severe spotter reports nearby, and confirmations or comments on your own reports.
- **Custom alerts**: "wind at 120 m below 15 mph", "bite index above 70", "US AQI above 100", "temperature below freezing": any mode's numbers, for any saved place, notified once a day when the forecast crosses your line.
- **Forecast vs. reality scorecard**: how often the model matched what spotters reported (temperature, wind, rain), by category ([/community/scorecard](src/app/community/scorecard/page.tsx)).
- **Home-screen widgets and tray**: five Android widget styles (Weather, Clock and weather, Temperature, Hourly, 5-day) with the top active warning and, where there's room, the day's highlight ("Near-record high: 84°" or the forecasters' key message), on a solid panel or transparent over the wallpaper; the Windows tray icon shows the current temperature, with a red or orange dot and the warning in its tooltip while one is active.
- **English and Spanish**: the app follows your device's language, or pick one in Settings (Language · Idioma). Notifications and Android widgets are translated too.
- **Settings**: light, dark or system theme, and each unit (temperature, wind, pressure, distance, rain, height) set separately; the gear icon in the top bar.
- **Shareable views**: mode and location live in the URL.
- **Works offline**: the app itself is cached, and the last forecast (kept for 3 days) shows with no signal, labelled with when it was saved; radar tiles come from a bounded service-worker cache.

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
| Lightning strike density | [NOAA nowCOAST](https://nowcoast.noaa.gov) |
| HRRR forecast reflectivity (future radar) | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/GIS/model.phtml) |
| NEXRAD Level II and III files (Pro mode) | [NOAA Open Data on AWS](https://registry.opendata.aws/noaa-nexrad/) |
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
| GNSS orbital elements | [CelesTrak](https://celestrak.org) |
| Reverse geocoding | BigDataCloud free client API |
| Forecast models you can pick (ECMWF, ECMWF AI, GFS, NBM, ICON, GEM, UK Met Office, Météo-France, JMA) | [Open-Meteo](https://open-meteo.com) |
| Google forecast (each person's own key) | [Google Maps Platform Weather API](https://developers.google.com/maps/documentation/weather) |

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1`–`6` | Daily · Severe · UAV · Angler · Air · Pro (when Professional mode is on) |
| `⌘K` / `Ctrl-K`, `/` | Search places and commands |
| `Space` | Play/pause the radar loop (Severe, Pro) |
| `←` / `→` | Step radar frames |
| `Esc` | Close dialogs and selections |

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. To show weather, it sends the coordinates of the places you look at to the public weather data services listed under [Data sources](#data-sources). It checks GitHub Releases for app updates. Google receives requests only if you add your own Google Weather API key, and a spotter network server only if you sign in to one. Storm Central has no analytics, tracking or advertising.

## Credits

- Weather icons: [Makin-Things/weather-icons](https://github.com/Makin-Things/weather-icons), MIT.
- WSR-88D site metadata: [supercell-wx](https://github.com/dpaulat/supercell-wx) (MIT), cross-checked against Py-ART.
- MapLibre GL JS (BSD-3). Basemap © CARTO © OpenStreetMap contributors.
- Weather data © Open-Meteo (CC BY 4.0), NOAA/NWS/SPC/SWPC, Iowa Environmental Mesonet, USGS, CelesTrak.

MIT © 2026 KingCreeper531
