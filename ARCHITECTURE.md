# Storm Central — System Architecture

Storm Central is a Next.js 16 (App Router) application. The browser does the heavy lifting where free APIs allow it (forecasts, radar tiles); a thin server layer proxies, reshapes and caches the feeds that need a User-Agent, shared caching or heavy computation. Community features (accounts, reports, photos) run on an embedded libSQL/SQLite database.

```mermaid
flowchart LR
  subgraph Browser
    UI[React UI<br/>modes · charts · sky] --> Z[(Zustand store<br/>mode · location · units · radar)]
    UI --> Q[(TanStack Query cache<br/>persisted to localStorage)]
    MAP[MapLibre GL<br/>frame-pool radar] --> SW[[Service worker<br/>radar tile cache]]
  end
  Q -- CORS --> OM[Open-Meteo<br/>forecast · air · geocode]
  SW -- tiles --> IEM[(IEM NEXRAD tiles)]
  Q --> API
  subgraph Next.js server
    API[/api routes/] --> C[(Coalescing LRU<br/>stale-if-error)]
    C --> NWS[NWS alerts]
    C --> IEMJ[IEM scan index]
    C --> SWPC[NOAA SWPC Kp]
    C --> USGS[USGS gauges]
    C --> CT[CelesTrak OMM → SGP4]
    C --> SPC[SPC outlook]
    API --> DB[(libSQL / SQLite<br/>users · sessions · posts · media)]
  end
```

---

## 1. State management

State is split three ways, and each kind lives in exactly one place:

| Kind | Where | Why |
|---|---|---|
| **UI and preference state**: active mode, location, units, radar settings, drone profile | `src/store/app-store.ts` (Zustand + `persist`) | Tiny and synchronous. Any component can subscribe to one slice without context re-render cascades. |
| **Server state**: forecasts, alerts, scans, gauges, posts | TanStack Query (`src/hooks/queries.ts`) | Deduplication, background refetch, retries, `keepPreviousData` for flicker-free location changes. |
| **Shareable view state**: `?mode=&lat=&lon=&name=` | URL, two-way synced by `useUrlSync` | Any view can be linked. Sync uses `history.replaceState`, so it causes no router re-render. |

**Hydration safety.** The store is created with `skipHydration` and rehydrated in a client effect, so server HTML and the first client render match. A `hydrated` flag gates every query, which avoids fetching the default location before the user's saved location is restored.

**Modes are projections, not pages.** `src/modes/registry.ts` defines each mode's identity (label, short mobile label, line icon, hotkey, whether it is map-first) and a **polling policy** per feed:

| Feed | Daily | Severe | UAV | Angler | Air |
|---|---|---|---|---|---|
| Forecast (Open-Meteo) | 10 min | 5 min | 10 min | 10 min | 10 min |
| Local alerts | 5 min | **60 s** | 5 min | 5 min | 5 min |
| National warning polygons | — | **45 s** | — | — | — |
| Radar scan index | 2 min | **60 s** | — | — | — |
| Kp / GNSS | — | — | 15 / 10 min | — | — |
| River gauges | — | — | — | 10 min | — |
| Air quality | 30 min | — | — | — | 15 min |

All modes read the same normalised forecast (a columnar struct-of-arrays, stored in SI units), so switching modes never refetches cached data. Hovering or focusing a mode tab calls `prefetchMode()` to warm that mode's feeds, so the switch lands on data instead of skeletons. Each mode is a separate `next/dynamic` chunk; the map-heavy modes never download for a user who only reads Daily. Mode changes are a short opacity cross-fade. The UI uses one constant accent (see `docs/DESIGN.md`); colour is reserved for data and status, not per-mode theming. On phones, modes switch from a bottom tab bar, and Severe mode's controls live in a draggable bottom sheet.

Units are a presentation concern. Data stays SI and `formatters(units)` converts at render time, so toggling °F/°C is instant and never triggers a network request.

## 2. API polling and caching layers

There are four cache tiers, from the user outward:

1. **TanStack Query** keys round coordinates to about 1 km, so GPS jitter doesn't bust the cache. Refetching pauses in background tabs, and 4xx errors are never retried. Small location-scoped feeds (forecast, air, Kp) are persisted to `localStorage` for 24 h, so a cold start renders the last known conditions instantly.
2. **Service worker** (`public/sw.js`) serves timestamped radar tiles cache-first. They are immutable, so this is safe. The cache is bounded to 4,000 entries and 6 hours.
3. **Server coalescing cache** (`src/lib/feeds/cache.ts`) is a process-local LRU with **request coalescing**: during an outbreak, thousands of concurrent misses for the national warnings feed collapse into one upstream request. It is **stale-if-error**, so a flaky NWS endpoint keeps serving the last good payload.
4. **CDN**: every proxy response sets `s-maxage` plus `stale-while-revalidate`, so a deployment behind Vercel/Cloudflare absorbs most traffic at the edge.

Server routes also **reshape** the data. National alerts are filtered to storm-based polygons, enriched with NWS hazard colours, impact tags (PDS / emergency / destructive / observed), a severity rank and a parsed storm-motion vector. USGS series are downsampled to hourly values with computed 24 h change. CelesTrak elements are propagated server-side, so the browser receives about 3 KB of sky geometry instead of about 80 KB of orbital elements plus an SGP4 library.

Each route's logic is a **feed** (`src/lib/feeds/`): fetch, parse, cache, with no dependency on Next.js. The route handlers are one-line wrappers (`feedRoute(alertsFeed)`), and the Android app runs the same feeds on the phone (§8).

**Every hazard polygon** (`src/lib/feeds/hazards.ts`, `/api/hazards`). Besides storm-based warnings, the radar maps draw the rest of the watch/warning/advisory map. The NWS's own WWA map service (`mapservices.weather.noaa.gov`, the layer behind weather.gov's hazard map) supplies zone- and county-based products already drawn as polygons. The NWS API sends those without geometry, so this is the only practical source. Pieces of one product (one per zone) are joined by CAP id and generalised. The layer has no text, so these alerts go out **lean**, and the full text is fetched when one is opened (`/api/alerts?id=`). The same feed adds SPC mesoscale discussions and watch boxes and WPC precipitation discussions (from IEM), plus the national warnings of Canada (ECCC's OGC API) and Germany (DWD's WFS). Each source is cached and fails on its own. Every product is categorised (warning, watch, advisory, statement, marine, discussion) with the NWS hazard-map colour. The radar settings pick which categories every radar view draws: the radar mode, the daily preview and every Pro pane share `useMapAlerts`.

Every parser in `src/lib/feeds/parse.ts` is pure and tolerant of both legacy and current upstream layouts (for example, both SWPC JSON shapes). Each one is unit-tested against fixtures.

## 3. Memory-safe radar tile caching and animation

The radar pipeline has four stages:

```
IEM scan index ──► immutable frames ──► MapLibre frame pool ──► playback clock
 (/api/radar/scans)   (lib/radar/frames)   (lib/radar/layer-manager)   (hooks/use-radar-loop)
```

- **Frames are immutable.** Each frame is a RIDGE tile pyramid addressed by scan time, e.g. `ridge::TLX-N0B-202610071423/{z}/{x}/{y}.png`. Its id never changes, so frames are diffed by id, and the service worker can cache tiles forever (bounded by size and age).
- **Pre-buffered layer pool** (`RadarLayerManager`). Every frame gets its own raster source and layer at `raster-opacity: 0`. MapLibre fetches and uploads tiles for zero-opacity layers but skips drawing them, so the whole loop is prefetched into GPU textures at zero per-frame render cost. Animating is then a paint-property flip, with an optional cross-dissolve via `raster-opacity-transition`. No network requests or texture uploads happen on the hot path, so there is no stutter.
- **The newest frame is requested first.** Layers are added newest-first, so the current scan's tiles head the request queue.
- **Buffer-aware playback.** The manager tracks per-frame readiness from `sourcedata`/`idle` events. The clock (`nextPlayableIndex`) only advances onto buffered frames, so viewers never see a half-loaded frame. The timeline shows buffer state per tick, the last frame dwells 3.2× longer so "now" registers, and the cross-fade is clamped to 45 % of the frame interval so frames never double-expose at 4×.
- **Bounded memory.**
  - Frames are capped by `navigator.deviceMemory`: 8 frames at ≤2 GB, 12 at ≤4 GB, 20 above. A new volume scan adds exactly one source and evicts the oldest, freeing its GPU textures immediately, so memory stays flat no matter how long the loop runs.
  - Source `maxzoom` is 8 for the mosaic and 10 for single sites. Beyond that MapLibre over-zooms existing textures instead of fetching new tiles.
  - The map's `maxTileCacheSize: 48` caps each source's off-screen tile cache.
  - Worst case: 20 frames × (≈24 visible + 48 cached tiles) × 256 KB is bounded by design, and typical usage is far lower.
- **Graceful degradation.** If the IEM index is unreachable, the national mosaic falls back to IEM's rolling `-m05m…-m55m` composite layers, which need no index.
- **Discovery-driven product UI.** Available products and tilts per site come from IEM (`operation=products`), so the UI never offers a tilt or dual-pol product the radar isn't producing.

Overlays (warnings, storm tracks, SPC outlook, radar sites, spotter reports, AQI heat raster) are null-rendering React components that insert into named **z-order slots**: invisible marker layers created on map load. Stacking is therefore deterministic regardless of mount order, and radar renders beneath the basemap's place labels. Selections from map clicks go to React state and render in overlay panels (a bottom sheet on phones); user content is never injected into map popups as HTML.

## 4. Science modules (all pure, all unit-tested)

| Module | What it does |
|---|---|
| `astro/*` | Sun and moon ephemerides, refraction, twilight crossings, moon phase/illumination, solunar major and minor periods |
| `science/wind` | u/v vector math, bulk shear and veer, log-height wind interpolation |
| `science/atmosphere` | Magnus dew point, LCL, BKN/OVC ceiling estimate, density altitude, water-temperature estimate |
| `science/pressure` | Met Office/WMO 3-hour tendency terms |
| `science/dop` + `gnss` | SGP4 propagation, look angles, GDOP/PDOP/HDOP/VDOP |
| `science/storm-motion` | Parses NWS `eventMotionDescription`; projects storm tracks and computes an ETA corridor |
| `science/scores` | UAV flyability (encodes 14 CFR 107 visibility and cloud-clearance minimums) and angler Bite Index, each explaining its factors |
| `science/air` | EPA AQI (2024 PM2.5 breakpoints), NAB pollen scales, cleanest outdoor window |

## 5. Auth and community security model

- **Passwords:** Node's built-in scrypt (N=2^15, r=8, p=3), self-describing encoded parameters, `timingSafeEqual`, and a dummy verification for unknown users so response timing can't enumerate accounts.
- **Sessions:** a 256-bit opaque token in an `HttpOnly`, `SameSite=Lax`, `__Host-` cookie (production). Only its SHA-256 is stored. Sessions are sliding (30 days, extended in the second half of their life), and expired sessions are purged opportunistically.
- **CSRF:** every mutating route requires `Origin` to match `Host`, in addition to SameSite.
- **Rate limits:** sliding-window limits per IP and per account for login (stuffing and spraying), registration, posting, verifying and commenting.
- **Uploads:** client re-encodes photos to ≤1600 px WebP, which drops metadata. The server **does not trust the client**: it sniffs magic bytes, strips JPEG APP1/APP13/COM, PNG text/eXIf chunks and WebP EXIF/XMP chunks (fixing VP8X flags and the RIFF size), and serves media with `nosniff` and a sandboxing CSP.
- **Privacy:** report coordinates are rounded to about 1 km unless the user opts in to precise GPS.
- **CSP:** a strict allow-list of the upstream origins the browser talks to directly, plus `frame-ancestors 'none'` and `object-src 'none'`.
- Cascading deletes are explicit (batch) because libSQL's connection pool doesn't guarantee `PRAGMA foreign_keys` per connection.
- **Spotter warnings (WarnGen, §9):** members only. Listing them requires a session (401 otherwise), so they never reach the public. Issuing takes the Trusted Spotter rank (25 confirmations of your reports), or `WARNGEN_MIN_REPUTATION`; moderators and developers always can. Issuing is rate-limited (8 per 15 minutes) and capped at 6 active warnings per spotter. The server re-validates every field: the polygon's size, corner count and self-intersection; the product's criteria; and place names as plain text. Only the issuer updates a warning; the issuer or a moderator cancels it. A suspended account's warnings are hidden like its reports.

## 6. Rendering the sky

`WeatherBackground` computes the **true solar altitude** at the selected location (refreshed every 5 minutes) to pick night, astronomical, nautical and civil twilight, golden hour or day palettes. All palettes fall to true black at the bottom (OLED-friendly, text-safe). On top of that:

- Motion-driven cloud blobs scaled by cloud cover and pushed by the real east–west wind component.
- A Canvas2D precipitation engine: one batched path per frame, DPR capped at 1.5, particle budget scaled to screen area and to both WMO intensity and measured mm/h. Wind sets the rain slant.
- Procedural lightning for convective codes, plus fog banks and twinkling stars.

The loop parks when the tab is hidden, pauses under immersive map modes, and renders a single static frame under `prefers-reduced-motion`.

## 7. Testing

`npm test` runs Vitest across astronomy (validated against real 2024 moon phases and a Chicago solstice sunset), wind and pressure science, scoring, DOP, storm-motion ETA, radar frame/playback/layer-manager logic (with a mock map), upstream parsers, image metadata stripping, password hashing, chart geometry and a schema-drift test that runs every table through Drizzle on a database created from the bootstrap DDL. A registry test checks that every feed route is also available to the Android app's in-app dispatcher, so the two can't drift apart.

## 8. Desktop and Android apps

```
                 ┌─ web ──────► next build ──────────────► Node host / Vercel
src/ (one app) ──┼─ desktop ──► standalone server ─► Electron (desktop/) ─► NSIS installer
                 └─ mobile ───► static export ────► Capacitor (android/) ─► APK
```

`BUILD_TARGET` in `next.config.ts` selects the output; `scripts/build-native.mjs` drives the native builds.

**Windows (Electron).** `desktop/server.mjs` runs the `standalone` Next.js server in an Electron utility process, bound to `127.0.0.1:47613`. The port is fixed so the UI keeps one origin, and with it its localStorage and query cache, across launches. Because the app's own server runs locally, every feature works offline from any hosting, including accounts: the SQLite database lives in the user's app-data folder, outside the install directory that updates replace. Running on loopback HTTP needs two server settings. `SESSION_COOKIE_SECURE=false` drops the `__Host-`/Secure cookie, which plain HTTP can't carry. `ALLOWED_HOST` pins the Host header for writes, so a DNS-rebinding page can't reach the local database. The window is sandboxed with context isolation and no Node integration, navigation is locked to the app's origin (other links open in the default browser), and only geolocation, clipboard-write and fullscreen permissions are granted. electron-updater checks GitHub Releases on launch and every 4 hours, downloads in the background, and asks before restarting.

**Android (Capacitor).** A static export can't include route handlers, cookies or server-rendered pages. Its build uses `pageExtensions: ["tsx"]`, which drops every `route.ts` along with pages named `*.server.tsx` (the profile page). `getJson()` sends `/api/*` requests to `lib/native/local-api.ts` instead, which runs the matching feed in-process with `CapacitorHttp`, the platform's HTTP stack. That way NWS, SPC, USGS and CelesTrak work despite missing CORS headers, and the NWS User-Agent can be set. The cache keeps CelesTrak elements in localStorage for 6 hours, which honours CelesTrak's re-download etiquette across app restarts. GNSS needs SGP4 in the browser, so `lib/science/sgp4.ts` imports satellite.js's pure-JS modules directly, bypassing its WASM entry. The spotter network needs the shared database. `COMMUNITY_ENABLED` is false in this build, which hides its entry points. The web view runs edge-to-edge, and the layout pads its fixed chrome with `env(safe-area-inset-*)`. The app checks the latest GitHub release at most every 6 hours and offers the new APK.

**Hosted mode.** With the `STORMCENTRAL_URL` repository variable set, both apps load that deployment instead (Electron loads the URL; Capacitor's `server.url`). Every user then shares one spotter network, and web changes reach the apps on deploy, without a new release.

**Releases.** `.github/workflows/release.yml` checks the code (typecheck, lint, tests). It then builds the installer on Windows and smoke-tests the bundled server's native database module there, and builds the APK on Linux. For a `v<version>` tag matching `package.json`, it publishes one GitHub release with `StormCentral-Setup-<version>.exe`, its blockmap, `latest.yml` (the electron-updater feed) and `StormCentral-<version>.apk`.

## 9. Professional mode

An AWIPS II / CAVE-style workspace, off by default (**Settings → General → Professional mode** adds the **Pro** mode, hotkey `6`). It lives in `src/components/pro/` and `src/lib/pro/`, and loads as its own chunk like the other map modes.

```
ProfessionalWorkspace          sync bus (zustand/vanilla) + pane registry + tool actions (React context)
├─ ProToolbar                  layout 1×1 · 1×2 · 2×2 · 3×3, radar site, tool, loop transport (Zulu clock)
├─ Pane × 1–9                  one MapLibre map each
│  ├─ FrameSource              per product kind: site (useRadarLoop) · decoded L2/L3 · mosaic · MRMS · other countries · server · satellite
│  ├─ ProFrames                RadarLayerManager frame pool, stepped by the sync clock
│  ├─ CameraSync, CursorSync   imperative subscriptions: jumpTo / crosshair transform
│  ├─ WarningsLayer (all hazards + spotter warnings), StormCellsLayer, ToolOverlay (A–A′, vector, TOA fan), WarnGenOverlay, ToolClicks
│  └─ PaneHeader               product, tilt, opacity, overlays; frame time written to the DOM
├─ side panel                  SoundingPanel (SkewT + Hodograph) · CrossSectionPanel · StormToolsPanel · WarnGenPanel · IbwInspector / AlertDetail
└─ ReadoutHud                  lat/lon, ground height, range/bearing, every pane's value, model fields
```

**State.** Settings that should survive a reload (layout, each pane's product/tilt/opacity/overlays, site, frame count, speed) are a persisted Zustand store, `src/store/pro-store.ts`. The fast-changing shared view is a separate **vanilla** store, `src/lib/pro/sync.ts`: camera `{lng, lat, zoom, source}`, the loop `timeline`/`index`/`playing`, the time-basis pane's buffer status, and the cursor. Panes subscribe to it outside React and apply changes straight to MapLibre, so panning a 3×3 layout or stepping the loop renders no React components. Only the small widgets that display these values read them through `useProSync`, and the frame clocks write their text node directly.

**Spatial sync.** A move event that carries user input (`originalEvent`) is published with the pane's id; the other panes `jumpTo` it. Programmatic jumps carry no input event, so they're never re-published, and there's no echo loop or "who leads" logic.

**Temporal sync.** AWIPS-style time matching: the first radar pane is the **time basis** (marked `TB`) and the loop steps through its scan times, waiting on frames that pane hasn't buffered. Every pane shows its newest frame at or before the clock (`frameAt`), so products that scan at different times (super-res reflectivity, IEM dual-pol, 2-minute MRMS, 10-minute GOES) stay on the same moment. Satellite frames are stamped with the loop time they pair with (scan time + GIBS latency).

**Decoded NEXRAD** (`lib/pro/nexrad/`). Products the tile services don't carry are read straight from NOAA's Open Data buckets on AWS, which are public and CORS-open:
- **Level III** (`unidata-nexrad-level3`, a few KB per file, about 5 minutes behind the scan): CC, ZDR, HC and KDP at all six published tilts, reflectivity and velocity above 0.5°, digital VIL and enhanced echo tops. On every device.
- **Level II** (`unidata-nexrad-level2`, 2–20 MB per volume, about 11 minutes behind): any cut of the volume up to 19.5° for Z, V, ZDR and ρHV. Desktop only.

The decoders are our own TypeScript, with no dependencies: `bzip2.ts`, `level3.ts` (packet 16 digital radials, per-product scaling from the threshold halfwords) and `level2.ts` (Message 31, with the cut list from the VCP in Message 5; it stops decompressing once the requested cut is complete). The available npm decoders don't cover the dual-pol Level III products and need Node's `Buffer`. Tests check them against MetPy, value for value, on real KTLX files in `__fixtures__/`.

Decoding runs in a pool of Web Workers (`decode.worker.ts`). Each worker renders the sweep to a Web Mercator PNG around the radar, placing gates by 4/3-earth beam geometry. The frame pool shows it as an image source (`RadarFrame.image`) in place of tiles, and keeps the compact sweep so the cursor readout shows the exact gate value.

**Cursor sampling** for tile products: the tile services return rendered PNGs, not data, so values are read back from colour (`lib/pro/sample.ts`). The tile under the cursor is fetched once (LRU of decoded tiles), and the pixel is matched to the closest point on the colour scale that drew it, interpolating between stops. NOAA's scales (`lib/pro/scales.ts`) were sampled from its own legend images and pinned to their printed values (reflectivity, super-res velocity with range folding, echo tops); IEM's tiles use the radar mode's legends. These values are shown as approximate (≈).

**Pro data server** (`pro-server/`, optional). Some products need channel math or GRIB2 decoding on files too big for a browser:
- GOES Day Cloud Phase Distinction, Nighttime Microphysics (night fog) and IR Sandwich from raw ABI bands.
- MRMS hail size (MESH), rotation tracks and VIL.

A small Python service renders them on a schedule (satpy for the RGB recipes, GRIB2 decoding for MRMS). It publishes `index.json` plus Web Mercator PNGs, built to run on a free Oracle Cloud VM. The app reads it from the address under **Settings → Professional mode → Pro data server**; until one is set, those products say so.

**Other countries' radar** (`lib/radar/intl.ts`). Outside NEXRAD coverage, national weather services' own composites serve CORS-open WMS or XYZ tiles: Canada (ECCC GeoMet, 1 km North American composite, 6 min), Germany (DWD), Finland (FMI), the Netherlands (KNMI) and Japan (JMA's high-resolution nowcast, observed frames only), each verified from a CI runner. `/api/radar/intl` lists each source's times, from WMS capabilities, JMA's time list, or the fixed grid for services whose capabilities are slow to build. In the radar mode they sit under NOAA's radar and are **time-matched** to the loop: each loop frame shows each source's latest scan at or before it, within two scan intervals. Only sources whose coverage is in view are fetched, and raster sources carry `bounds`, so no tiles are requested outside it. In Pro they are products of their own ("Radar (other countries)"), stepped by the same loop clock. Agencies that need an API key (Météo-France, the Met Office, AEMET) or publish only HDF5 files (SMHI, DMI, MeteoSwiss) aren't included.

**Spotter WarnGen** (`lib/warngen/`, `warngen-panel.tsx`, `warngen-overlay.tsx`). A WarnGen-style editor for the built-in spotter network, never the public or the NWS:
- **Pick the storm.** Click it on any pane ("drag me to storm"), then again on another frame to track it, or type the motion in. The pick is carried forward to the present along its motion.
- **The polygon.** Drawn the way AWIPS WarnGen draws it: a box that starts just behind the storm and widens down the projected track for the warning's duration, or an octagon for a stationary storm. Corners can be dragged on any pane, midpoints dragged to add a corner, and corners right-clicked or double-clicked away.
- **Products.** Tornado, severe thunderstorm, flash flood and snow squall warnings, and significant weather advisories. Each takes its IBW tags: source, hail size, wind gust, tornado possible, and a damage threat including PDS and emergency tiers. The editor enforces the NWS criteria; for example, a severe warning needs 1-inch hail or 58 mph wind.
- **The text.** Generated like a WarnGen product (bullets, HAZARD/SOURCE/IMPACT, call to action, `LAT...LON` and `TIME...MOT...LOC`, IBW tags). Towns come from reverse-geocoding points inside the polygon. The text is headed and signed as an unofficial spotter-network product, and is regenerated from the stored fields in each viewer's time zone.
- **Storage and display.** Warnings live in the `spotter_warnings` table with per-year numbers and can be updated (revisions) or cancelled. Every radar view draws them for signed-in members, dashed and labelled "SPOTTER". They open in the same detail panel as NWS alerts, with an unofficial banner.

### Still not covered

| Gap | Why | Path |
|---|---|---|
| Live Level II (seconds behind) | The archive bucket publishes whole volumes about 11 minutes after the scan starts | Assemble the real-time chunks from `unidata-nexrad-level2-chunks` (S/I/E chunks per volume, concatenated) |
| Raw GRIB2 in the browser (HRRR native levels, RAP) | No practical browser decoder for JPEG2000/CCSDS-packed fields | Add them to the Pro data server ([ecCodes](https://confluence.ecmwf.int/display/ECC) / `cfgrib`), or keep using Open-Meteo |

**Rendering at scale.** For many pre-rendered rasters, MapLibre's raster sources (one per frame, flipped by opacity) are hard to beat. Gate-level data or model grids drawn as data rather than images want a MapLibre `CustomLayerInterface` with a WebGL2 shader doing the colour table lookup on the GPU, or [deck.gl](https://deck.gl) through `@deck.gl/mapbox`'s interleaved `MapboxOverlay`. The Skew-T, hodograph and cross-section are plain SVG: a sounding is a few hundred points, and SVG keeps them crisp, themeable and accessible without another dependency (alternatives: [`d3-skewt`](https://github.com/rsobash/d3-skewt) for D3 users, [MetPy](https://unidata.github.io/MetPy/) server-side).
