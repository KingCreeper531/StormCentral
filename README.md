# StormCentral

**Open-data weather for people who actually watch the sky.** StormCentral pairs a quiet, instrument-style interface (with a live, weather-reactive sky behind it) with professional meteorological tooling: live NEXRAD radar with storm-track projections, a drone pilot's go/no-go board, an angler's solunar and river dashboard, air-quality heatmaps, and a community **Spotter Network** where people post and verify ground-truth reports.

Every data source is free and open. No paid weather API keys are required.

> ⚠️ StormCentral is not an official warning system. Always follow the National Weather Service and local emergency management.

## Download

Get the newest version from **[Releases](https://github.com/KingCreeper531/StormCentral/releases/latest)**.

| Device | File | Updates |
|---|---|---|
| **Windows 10 / 11** (64-bit) | `StormCentral-Setup-<version>.exe` | Automatic. The app downloads new releases in the background and asks to restart. |
| **Android 7.0+** | `StormCentral-<version>.apk` | The app shows a notice when a new release is out; tap **Download** and install it over the old one. |

- **Windows:** the installer isn't code-signed yet, so SmartScreen may say "Windows protected your PC". Choose **More info → Run anyway**. It installs for your user only, with no admin prompt.
- **Android:** open the APK on your phone and allow your browser to install apps when asked.
- **Self-contained:** both apps work with no server. The Windows app runs StormCentral's own server on your PC, so every feature works, including accounts and reports (stored on that PC). The Android app runs the weather feeds on the phone. The spotter network needs a shared server, so it's turned off there until one is set up (see [Desktop and Android apps](#desktop-and-android-apps)).

---

## Modes

Press **1–5** to switch modes and **⌘K / Ctrl-K** to search any place. Hovering a mode tab prefetches its data. On phones the modes live in a bottom tab bar, and Severe mode's warnings and layer controls sit in a draggable bottom sheet (peek / half / full).

| Mode | What you get |
|---|---|
| **Daily** | Conditions hero with an animated sky that tracks the real sun position; 15-minute nowcast; 24 h temperature and precipitation charts; 10-day range bars; wind compass, pressure tendency, UV, visibility, AQI, sun arc and moon phase; live radar preview; **SPC tornado / hail / wind probabilities** when you're in a risk area; spotter reports near you. |
| **Severe** (fullscreen) | NEXRAD national mosaic or any single WSR-88D site. Products: reflectivity, velocity, storm-relative velocity, CC, ZDR and hydrometeor classification. Tilt selection is driven by what the radar is actually producing. Buffer-aware loop playback (play/pause/step, 0.5–4×, cross-fade). NWS warning polygons in official hazard colors with PDS/emergency tags, **projected storm tracks with ETA to your location**, SPC Day 1 outlook (categorical or **tornado / hail / wind probabilities**, hatched where significant), **official NWS storm reports** (hail size, wind speed, tornadoes, fading with age), **NEXRAD storm cells** (TVS, mesocyclone, max hail size, 15–60 min forecast track and arrival time at your location), the **NHC hurricane tracker** (cone, track, intensity forecast), **GOES infrared / visible satellite** looping with the radar, and **export the loop as a GIF or video**. |
| **UAV Pilot** | Flyability score with a factor breakdown per airframe class, an hourly go/no-go strip, wind at flight altitude vs. the airframe limit, a 10/80/120/180 m wind profile with **bulk shear and veer**, NOAA Kp index, **GNSS sky plot with satellite count and PDOP/HDOP** (SGP4 from CelesTrak), an estimated cloud ceiling against the Part 107 500-ft clearance, visibility and density altitude. |
| **Angler** | Bite Index with explained reasons, an hourly bite timeline with solunar bands, moon phase and solunar major/minor periods, a 48 h barometer with Met Office tendency terms, **USGS real-time river gauges** (discharge, stage, 24 h change, water temperature), and an estimated water temperature where no gauge reports one. |
| **Air & Allergy** | A **model-derived AQI / PM2.5 heatmap** sampled across the visible map, current US AQI with health guidance, pollutant breakdown, 48 h AQI and UV forecast, the cleanest 2-hour outdoor window, and NAB-scaled pollen (CAMS covers Europe). |

## Beyond a typical weather app

- **Spotter Network**: sign in, post geotagged reports with photos and a severity level, and verify each other's observations. Confirmations build reputation tiers (Observer → Spotter → Trusted Spotter → Storm Chaser → Legend). Reports show up on the radar map.
- **Ground truth vs. model**: each report stores what the forecast model said at that moment, so you can see where the model missed.
- **Privacy by default**: report locations are rounded to about 1 km unless you opt in to precise GPS. Photo EXIF/GPS is stripped on your device *and* again on the server.
- **Storm ETA**: the machine-readable storm-motion line in each NWS warning is parsed into a projected track and a live arrival estimate for your location.
- **Warning polygon test**: the alert banner tells you when you're *inside* a storm-based warning, not just inside the county.
- **Saved places and notifications**: save up to 10 places and get a notification when a warning is issued for any of them. Windows keeps checking from the tray; Android checks about every 15 minutes in the background, even with the app closed.
- **Custom alerts**: "wind at 120 m below 15 mph", "bite index above 70", "US AQI above 100", "temperature below freezing": any mode's numbers, for any saved place, notified once a day when the forecast crosses your line.
- **Forecast vs. reality scorecard**: how often the model matched what spotters reported (temperature, wind, rain), by category ([/community/scorecard](src/app/community/scorecard/page.tsx)).
- **Home-screen widget and tray**: an Android widget with the temperature, conditions and the top active warning; the Windows tray icon shows the current temperature.
- **Shareable views**: mode and location live in the URL.
- **Offline-first cold start**: the last forecast renders instantly from the persisted query cache, and radar tiles come from a bounded service-worker cache.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, Turbopack), **React 19**, TypeScript (strict) |
| Styling and motion | **Tailwind CSS v4** design tokens ([docs/DESIGN.md](docs/DESIGN.md)), **Motion** (formerly Framer Motion), Canvas2D particle engine |
| Maps | **MapLibre GL JS v6** (WebGL); CARTO Dark Matter basemap, or MapTiler with a key |
| State | **Zustand** (persisted UI state and URL sync) + **TanStack Query** (server state, persisted cache) |
| Data and auth | **Drizzle ORM** on **libSQL/SQLite** (Turso-ready), Node `crypto` scrypt, opaque DB sessions, **Zod** validation |
| Science | Custom ephemerides, wind and thermodynamics, DOP; **satellite.js** (SGP4) on the server |
| Icons | [Makin-Things/weather-icons](https://github.com/Makin-Things/weather-icons) (animated SVG, MIT) + Lucide for UI chrome |
| Apps | **Electron 44** + **electron-updater** (Windows), **Capacitor 8** (Android), released by GitHub Actions |
| Tests | **Vitest**: 189 unit tests across science, radar, parsers, feeds, alerting, security and the DB schema |

## Data sources

| Data | Source | Accessed from |
|---|---|---|
| Forecast, nowcast, air quality, pollen, geocoding | [Open-Meteo](https://open-meteo.com) (CC BY 4.0) | Browser (CORS) |
| NEXRAD radar tiles and scan index | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu) | Browser (tiles) + `/api/radar/*` |
| Watches, warnings, storm motion | [api.weather.gov](https://www.weather.gov/documentation/services-web-api) | `/api/alerts` |
| Convective outlook and hazard probabilities | [Storm Prediction Center](https://www.spc.noaa.gov) | `/api/outlook` |
| Local storm reports, NEXRAD storm-cell attributes | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu) | `/api/storm-reports`, `/api/storm-cells` |
| Tropical cyclones (positions, cone, track) | [National Hurricane Center](https://www.nhc.noaa.gov) + NOAA map services | `/api/tropical` |
| GOES-East/West satellite imagery | [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) | Browser (WMS tiles) |
| Planetary Kp | [NOAA SWPC](https://www.swpc.noaa.gov) | `/api/space-weather` |
| River discharge, stage, water temperature | [USGS Water Services](https://waterservices.usgs.gov) (OGC API fallback) | `/api/rivers` |
| GNSS orbital elements | [CelesTrak](https://celestrak.org) | `/api/gnss` |
| Reverse geocoding | BigDataCloud free client API | Browser |

## Getting started

```bash
# Node 20.9+ required
npm install          # also vendors the MapLibre worker into public/vendor
npm run dev          # http://localhost:3000
```

That's all you need. A SQLite database is created at `./data/stormcentral.db` on first use. Copy `.env.example` to `.env.local` to customise:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `file:./data/stormcentral.db` (default) or a `libsql://` Turso URL for serverless deploys |
| `DATABASE_AUTH_TOKEN` | Turso auth token |
| `NEXT_PUBLIC_MAPTILER_KEY` | Optional; switches the basemap to MapTiler `dataviz-dark` |
| `NWS_USER_AGENT` | Contact string sent to api.weather.gov (required by NWS policy) |

### Scripts

| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Develop, build, serve |
| `npm test` | Vitest unit suite |
| `npm run typecheck` / `lint` | `tsc --noEmit` / ESLint (incl. React Compiler rules) |
| `npm run check` | All three of the above |
| `npm run icons:sync` | Re-vendor the Makin-Things icon set |
| `npm run desktop:start` | Build the desktop server bundle and open the Electron app |
| `npm run desktop:dist` | Package the Windows installer into `dist/desktop/` (run on Windows) |
| `npm run android:build` | Build the static bundle and sync it into `android/` |

### Deploying

On Vercel (or any Node host), set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` to a Turso database. The schema is applied automatically on first request. Every proxy route sends `s-maxage` / `stale-while-revalidate`, so a CDN absorbs most traffic. Rate limiting is per instance; swap `src/lib/server/rate-limit.ts` for Redis/Upstash when you scale horizontally.

## Desktop and Android apps

One codebase, three packages. `BUILD_TARGET` in `next.config.ts` picks the output:

| Package | Build | How it runs |
|---|---|---|
| **Web** | `next build` | Any Node host or Vercel. |
| **Windows** | `standalone` server + Electron (`desktop/`) | The app starts StormCentral's own Next.js server on `127.0.0.1` in a background process and shows it in a window. The database lives in `%APPDATA%\StormCentral`, so updates never touch accounts or reports. |
| **Android** | static export + Capacitor (`android/`) | No server. The weather routes (`/api/alerts`, `/api/gnss`, …) run on the phone: the same feed code as the server (`src/lib/feeds/`), with native HTTP so government APIs that don't send CORS headers still work. |

**Notifications.** One alert engine (`src/lib/alerting/`) runs in two places. On the web and in the Windows app it runs in the page (one tab at a time); the Windows window hides to the tray on close so checks continue (switchable in Alerts and places). On Android it also runs in a Capacitor background runner (`src/native/runner/background.ts`, bundled to `out/runners/background.js` by `npm run android:build`), which checks warnings and custom alerts about every 15 minutes and refreshes the home-screen widget.

**Sharing one spotter network.** Accounts and reports need one shared server. Deploy the web app (Vercel plus a free [Turso](https://turso.tech) database works), then add a repository variable **`STORMCENTRAL_URL`** (Settings → Secrets and variables → Actions → Variables) set to its `https://` address. The next release builds both apps to load that server, with everything enabled for every user.

### Building locally

```bash
# Windows app (run on Windows; packaging the .exe needs Windows or Wine)
npm install && npm install --prefix desktop
npm run desktop:dist                       # → dist/desktop/StormCentral-Setup-<version>.exe

# Android app (JDK 21 + Android SDK)
npm run android:build
cd android && ./gradlew assembleRelease    # → android/app/build/outputs/apk/release/app-release.apk
```

### Releases

`.github/workflows/release.yml` builds both apps on every push that touches the packaging, and publishes a release for version tags:

1. Bump `version` in `package.json` (it is the version of the web app, the Windows app and the APK), commit and push.
2. Tag it: `git tag v0.2.0 && git push origin v0.2.0`. You can also run **Release apps** from the Actions tab with **publish** ticked.
3. The workflow checks the code, builds the installer and the APK, and publishes the GitHub release. Installed Windows apps update themselves from it, and Android apps offer the new APK.

Optional repository secrets:

| Secret | Purpose |
|---|---|
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Sign the APK with your own key. Without them, APKs are signed with the shared development key in `android/app/debug.keystore`. That key isn't secret: it keeps builds installable over each other, but anyone could sign an APK with it. Create a key with `keytool -genkeypair -v -keystore release.jks -alias stormcentral -keyalg RSA -keysize 4096 -validity 10000` and store `base64 -w0 release.jks` as `ANDROID_KEYSTORE_BASE64`. Android only installs an update signed with the same key, so after switching keys, users reinstall once. |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | A code-signing certificate (base64 `.pfx`). Signed installers skip the SmartScreen warning. |

## Project structure

```
StormCentral/
├─ ARCHITECTURE.md              ← state, polling, caching & radar pipeline in depth
├─ docs/DESIGN.md               ← design system: tokens, banned patterns, recipes, mobile rules
├─ next.config.ts               ← build targets (web / desktop / mobile), CSP & cache headers
├─ .github/workflows/release.yml ← builds the Windows installer + APK, publishes releases
├─ desktop/                     ← Electron app: local server, window, auto-updates
├─ electron-builder.config.mjs  ← Windows installer (NSIS) + GitHub update feed
├─ android/                     ← Capacitor Android project (icons, signing, permissions)
├─ capacitor.config.ts          ← Android app config
├─ public/
│  ├─ sw.js                     ← bounded cache-first radar tile service worker
│  ├─ icons/weather/            ← Makin-Things animated + static SVGs (MIT)
│  └─ vendor/                   ← MapLibre worker (generated on install)
├─ scripts/                     ← icon sync, MapLibre worker vendoring, native builds
└─ src/
   ├─ app/
   │  ├─ page.tsx               ← dashboard (AppShell)
   │  ├─ community/  login/  register/  u/[username]/
   │  └─ api/
   │     ├─ alerts/  outlook/  space-weather/  rivers/  gnss/
   │     ├─ radar/{scans,products}/
   │     ├─ auth/{register,login,logout,me}/
   │     └─ posts/[id]/{verify,comments}/  media/[id]/
   ├─ components/
   │  ├─ shell/                 ← AppShell, TopBar, ModeSwitcher, mobile TabBar, CommandPalette, AlertBanner
   │  ├─ background/            ← sky gradients, Canvas2D precipitation, lightning
   │  ├─ modes/                 ← daily, severe, drone, angler, air (lazy-loaded)
   │  ├─ map/                   ← MapView (z-order slots) + layers/: radar, warnings,
   │  │                            tracks, outlook, sites, reports, heat, user marker
   │  ├─ radar/                 ← timeline, controls, legend, alert list/detail
   │  ├─ daily/  drone/         ← mode-specific panels
   │  ├─ community/             ← composer, feed, post card, auth form
   │  ├─ charts/                ← accessible SVG time-series (crosshair + tooltip)
   │  └─ ui/                    ← Panel, Button, Segmented, Tabs, Sheet, StatusText, Meter, dials
   ├─ hooks/                    ← queries (per-mode polling), radar loop, hotkeys, URL sync
   ├─ modes/registry.ts         ← mode definitions + polling policy
   ├─ store/app-store.ts        ← Zustand store (persisted, hydration-safe)
   └─ lib/
      ├─ radar/                 ← frames, products, playback, RadarLayerManager, sites
      ├─ astro/                 ← sun, moon, solunar
      ├─ science/               ← wind/shear, atmosphere, pressure, DOP, GNSS, scores,
      │                            air & pollen, storm motion
      ├─ api/                   ← Open-Meteo clients, shared response types
      ├─ feeds/                 ← weather feeds behind /api (alerts, radar, Kp, rivers,
      │                            GNSS, SPC): parsers + coalescing cache; run on the
      │                            server and, in the Android app, on the phone
      ├─ native/                ← Android: in-app /api dispatcher, native HTTP, update check
      ├─ server/                ← route helpers, rate limit, CSRF guard, image
      │                            sanitising, community repository
      ├─ auth/  db/             ← scrypt, sessions, Drizzle schema
      └─ weather/               ← units, WMO codes → icons/scenes, view helpers
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1`–`5` | Daily · Severe · UAV · Angler · Air |
| `⌘K` / `Ctrl-K`, `/` | Search places and commands |
| `Space` | Play/pause the radar loop (Severe) |
| `←` / `→` | Step radar frames |
| `Esc` | Close dialogs and selections |

## Credits

- Weather icons: [Makin-Things/weather-icons](https://github.com/Makin-Things/weather-icons), MIT.
- WSR-88D site metadata: [supercell-wx](https://github.com/dpaulat/supercell-wx) (MIT), cross-checked against Py-ART.
- MapLibre GL JS (BSD-3). Basemap © CARTO © OpenStreetMap contributors.
- Weather data © Open-Meteo (CC BY 4.0), NOAA/NWS/SPC/SWPC, Iowa Environmental Mesonet, USGS, CelesTrak.

MIT © 2026 KingCreeper531
