# StormCentral

**Open-data weather for people who actually watch the sky.** StormCentral pairs an animated, OLED-first interface with professional meteorological tooling: live NEXRAD radar with storm-track projections, a drone pilot's go/no-go board, an angler's solunar and river dashboard, air-quality heatmaps, and a community **Spotter Network** where people post and verify ground-truth reports.

Every data source is free and open. No paid weather API keys are required.

> ⚠️ StormCentral is not an official warning system. Always follow the National Weather Service and local emergency management.

---

## Modes

Press **1–5** to switch modes and **⌘K / Ctrl-K** to search any place. Hovering a mode tab prefetches its data.

| Mode | What you get |
|---|---|
| **Daily** | Conditions hero with an animated sky that tracks the real sun position; 15-minute nowcast; 24 h temperature and precipitation charts; 10-day range bars; wind compass, pressure tendency, UV, visibility, AQI, sun arc and moon phase; live radar preview; spotter reports near you. |
| **Severe** (fullscreen) | NEXRAD national mosaic or any single WSR-88D site. Products: reflectivity, velocity, storm-relative velocity, CC, ZDR and hydrometeor classification. Tilt selection is driven by what the radar is actually producing. Buffer-aware loop playback (play/pause/step, 0.5–4×, cross-fade). NWS warning polygons in official hazard colors with PDS/emergency tags, **projected storm tracks with ETA to your location**, SPC Day 1 outlook, radar-site picker and spotter reports on the map. |
| **UAV Pilot** | Flyability score with a factor breakdown per airframe class, an hourly go/no-go strip, wind at flight altitude vs. the airframe limit, a 10/80/120/180 m wind profile with **bulk shear and veer**, NOAA Kp index, **GNSS sky plot with satellite count and PDOP/HDOP** (SGP4 from CelesTrak), an estimated cloud ceiling against the Part 107 500-ft clearance, visibility and density altitude. |
| **Angler** | Bite Index with explained reasons, an hourly bite timeline with solunar bands, moon phase and solunar major/minor periods, a 48 h barometer with Met Office tendency terms, **USGS real-time river gauges** (discharge, stage, 24 h change, water temperature), and an estimated water temperature where no gauge reports one. |
| **Air & Allergy** | A **model-derived AQI / PM2.5 heatmap** sampled across the visible map, current US AQI with health guidance, pollutant breakdown, 48 h AQI and UV forecast, the cleanest 2-hour outdoor window, and NAB-scaled pollen (CAMS covers Europe). |

## Beyond a typical weather app

- **Spotter Network**: sign in, post geotagged reports with photos and a severity level, and verify each other's observations. Confirmations build reputation tiers (Observer → Spotter → Trusted Spotter → Storm Chaser → Legend). Reports show up on the radar map.
- **Ground truth vs. model**: each report stores what the forecast model said at that moment, so you can see where the model missed.
- **Privacy by default**: report locations are rounded to about 1 km unless you opt in to precise GPS. Photo EXIF/GPS is stripped on your device *and* again on the server.
- **Storm ETA**: the machine-readable storm-motion line in each NWS warning is parsed into a projected track and a live arrival estimate for your location.
- **Warning polygon test**: the alert banner tells you when you're *inside* a storm-based warning, not just inside the county.
- **Shareable views**: mode and location live in the URL.
- **Offline-first cold start**: the last forecast renders instantly from the persisted query cache, and radar tiles come from a bounded service-worker cache.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, Turbopack), **React 19**, TypeScript (strict) |
| Styling and motion | **Tailwind CSS v4** with design tokens, **Motion** (formerly Framer Motion), Canvas2D particle engine |
| Maps | **MapLibre GL JS v6** (WebGL); CARTO Dark Matter basemap, or MapTiler with a key |
| State | **Zustand** (persisted UI state and URL sync) + **TanStack Query** (server state, persisted cache) |
| Data and auth | **Drizzle ORM** on **libSQL/SQLite** (Turso-ready), Node `crypto` scrypt, opaque DB sessions, **Zod** validation |
| Science | Custom ephemerides, wind and thermodynamics, DOP; **satellite.js** (SGP4) on the server |
| Icons | [Makin-Things/weather-icons](https://github.com/Makin-Things/weather-icons) (animated SVG, MIT) + Lucide for UI chrome |
| Tests | **Vitest**: 68 unit tests across science, radar, parsers, security and the DB schema |

## Data sources

| Data | Source | Accessed from |
|---|---|---|
| Forecast, nowcast, air quality, pollen, geocoding | [Open-Meteo](https://open-meteo.com) (CC BY 4.0) | Browser (CORS) |
| NEXRAD radar tiles and scan index | [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu) | Browser (tiles) + `/api/radar/*` |
| Watches, warnings, storm motion | [api.weather.gov](https://www.weather.gov/documentation/services-web-api) | `/api/alerts` |
| Convective outlook | [Storm Prediction Center](https://www.spc.noaa.gov) | `/api/outlook` |
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

### Deploying

On Vercel (or any Node host), set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` to a Turso database. The schema is applied automatically on first request. Every proxy route sends `s-maxage` / `stale-while-revalidate`, so a CDN absorbs most traffic. Rate limiting is per instance; swap `src/lib/server/rate-limit.ts` for Redis/Upstash when you scale horizontally.

## Project structure

```
StormCentral/
├─ ARCHITECTURE.md              ← state, polling, caching & radar pipeline in depth
├─ next.config.ts               ← CSP & security headers, cache headers
├─ public/
│  ├─ sw.js                     ← bounded cache-first radar tile service worker
│  ├─ icons/weather/            ← Makin-Things animated + static SVGs (MIT)
│  └─ vendor/                   ← MapLibre worker (generated on install)
├─ scripts/                     ← icon sync, MapLibre worker vendoring
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
   │  ├─ shell/                 ← AppShell, TopBar, ModeSwitcher, CommandPalette, AlertBanner
   │  ├─ background/            ← sky gradients, Canvas2D precipitation, lightning
   │  ├─ modes/                 ← daily, severe, drone, angler, air (lazy-loaded)
   │  ├─ map/                   ← MapView (z-order slots) + layers/: radar, warnings,
   │  │                            tracks, outlook, sites, reports, heat, user marker
   │  ├─ radar/                 ← timeline, controls, legend, alert list/detail
   │  ├─ daily/  drone/         ← mode-specific panels
   │  ├─ community/             ← composer, feed, post card, auth form
   │  ├─ charts/                ← accessible SVG time-series (crosshair + tooltip)
   │  └─ ui/                    ← glass card, segmented, score ring, dials, status
   ├─ hooks/                    ← queries (per-mode polling), radar loop, hotkeys, URL sync
   ├─ modes/registry.ts         ← mode definitions + polling policy
   ├─ store/app-store.ts        ← Zustand store (persisted, hydration-safe)
   └─ lib/
      ├─ radar/                 ← frames, products, playback, RadarLayerManager, sites
      ├─ astro/                 ← sun, moon, solunar
      ├─ science/               ← wind/shear, atmosphere, pressure, DOP, GNSS, scores,
      │                            air & pollen, storm motion
      ├─ api/                   ← Open-Meteo clients, shared response types
      ├─ server/                ← coalescing cache, parsers, rate limit, CSRF guard,
      │                            image sanitising, community repository
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
