# StormCentral design system

StormCentral should read like a **professional instrument**: RadarScope, Windy, an aircraft EFB, Linear. It is a tool people trust during dangerous weather, so the UI stays quiet and the data carries the visual weight. Colour lives in data (radar, charts, warnings, status), not in chrome.

Tokens live in `src/app/globals.css` (`@theme`). Primitives live in `src/components/ui/`.

---

## 1. Principles

1. **Data is loud, chrome is quiet.** Panels are flat neutral surfaces. Never decorate a container to make it look premium.
2. **Hierarchy comes from type and space**, not from borders inside borders, glows, or gradients.
3. **One accent** (`accent`, a blue) marks interactivity and selection only: focus rings, the active tab underline, toggles, links. Modes do not get their own colours.
4. **Status = icon + plain label.** Use `<StatusText>`. Never a filled pill, never colour alone.
5. **Plain, factual copy.** Sentence case everywhere, with no cute phrasing or exclamation marks. Write "Sign in", not "Welcome back, spotter". Write "No reports nearby", not "Nothing on radar here".
6. **Mobile is a first-class layout,** not a squeezed desktop (see §6).

## 2. Banned patterns ("vibe-coded" tells)

Remove these wherever they appear:

- `glass`, `glass-strong`, `backdrop-blur-*` on content panels. (`overlay` is allowed only for UI floating over the map.)
- Gradient fills on panels, buttons or text, and `bg-gradient-*` / `linear-gradient` in chrome. Gradients are OK inside data viz, e.g. a temperature range bar or legend.
- Glows: `shadow-[...]` with colour, `drop-shadow` glows, coloured `boxShadow`, `blur-3xl` decorative blobs (except the weather background itself).
- Letter-spaced uppercase eyebrows (`uppercase tracking-[0.14em]`, `tracking-wide uppercase`) used as section labels. Use the panel `title` (sentence case) and an optional `subtitle`.
- Pills everywhere: `rounded-full` on buttons, chips, badges, inputs or nav items. Buttons and inputs use `rounded-[var(--radius-control)]` (6 px). `rounded-full` is reserved for avatars, dots, toggle knobs, the sheet handle and the user-location marker.
- Pulsing rings, spring "pill" animations behind tabs, hover scale-ups (`hover:scale-*`).
- Floating action buttons with glow.
- Emoji or decorative glyphs in UI copy (⚡ ★ ✨). Use lucide icons.
- Middot-chained eyebrow strings like "MODEL FIELD · CAMS VIA OPEN-METEO".
- `font-extralight` giant numerals with negative tracking beyond `tracking-tight`.

## 3. Tokens

| Token | Use |
|---|---|
| `bg-canvas` `#000` | Page background |
| `bg-surface-1` | Panels (`surface` utility, or the `<Panel>` component) |
| `bg-surface-2` | Inputs, segmented control track, hovered rows, secondary buttons |
| `bg-surface-3` | Selected/pressed state, meter tracks |
| `border-line` / `border-line-strong` | Hairlines (1 px) / emphasised hairlines |
| `text-ink` / `text-ink-2` / `text-ink-3` | Primary / secondary / tertiary text (all ≥ 4.5:1 on surface-1/2). Don't put `ink-3` text on `surface-3`. |
| `text-accent` / `bg-accent` / `border-accent` | Interactive emphasis only |
| `go` / `caution` / `nogo` | Status icons and data marks only, never text colour for body copy |
| `series-1/2/3`, `grid` | Charts |
| `rounded-[var(--radius-control)]` (6) / `--radius-panel` (10) / `--radius-sheet` (14) | Corners |
| `--topbar-h`, `--tabbar-h` | Fixed chrome heights (`--tabbar-h` is 0 on desktop) |

Utilities: `surface`, `overlay`, `label` (12 px caption, ink-3), `tabular`, `skeleton`, `no-scrollbar`. The `pointer-coarse:` variant targets touch devices.

## 4. Typography

| Role | Classes |
|---|---|
| Hero temperature | `text-7xl sm:text-8xl font-light tracking-tight tabular` |
| Page title | `text-xl sm:text-2xl font-semibold` |
| Panel title | Comes from `<Panel title>` (`text-sm font-semibold`) |
| Body | `text-sm` (14 px) / `text-[13px]` in dense lists |
| Caption / stat label | `label` utility (12 px, ink-3, sentence case) |
| Stat value | `text-lg font-medium tabular` (`<Stat>`), larger readouts `text-3xl font-light tabular` |
| Technical codes (N0B, KTLX, timestamps) | `font-mono text-xs` |

Numbers that update or align use `tabular`.

## 5. Components (`src/components/ui`)

- **`<Panel title subtitle action padded>`** replaces `GlassCard`. Map `eyebrow` → `subtitle`, and make the title descriptive ("Hourly forecast", subtitle "Next 24 hours").
- **`<Button variant="primary|secondary|ghost|danger" size="sm|md">`**, **`<IconButton label>`** and `buttonClass()` for `<Link>`s.
- **`<Segmented>`**: rectangular radio group (`stretch` for full width on mobile).
- **`<Tabs>`**: underline tabs for in-panel navigation.
- **`<StatusText status label>`** replaces `StatusBadge`. `statusColor()` remains.
- **`<ScoreReadout score color caption label>`** and **`<Meter>`** replace `ScoreRing`.
- **`<Stat>`**, **`<Row>`** (dense key–value line), `EmptyState`, `ErrorNote`, `Skeleton`, `Toggle`, `Avatar`.
- **`<Sheet detent onDetentChange header ariaLabel desktopClassName>`**: a bottom sheet with peek/half/full detents on phones, and a side panel on desktop.
- `WeatherIcon`: Makin-Things illustrations are for **weather data** (current conditions, hourly, daily, report category). Don't use them as navigation or decoration icons; use lucide icons there.
- `useIsDesktop()` (`hooks/use-media-query.ts`): the md (768 px) breakpoint in JS, for behaviour that differs, not just layout.

Recipes:

- **List of things**: rows separated by `divide-y divide-line`, not a card per item.
- **Inputs**: `h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm outline-none placeholder:text-ink-3 focus:border-accent pointer-coarse:h-11`.
- **Selected list row**: `bg-surface-2` plus a 2 px left border in accent (`border-l-2 border-accent`).
- **Tags/chips** (e.g. "PDS", report category): `rounded-[4px] border border-line px-1.5 py-px text-[11px] font-medium text-ink-2`. A hazard colour may appear as a 6–8 px square swatch beside the text, not as the chip fill.

## 6. Mobile (< 768 px)

- Layout widths: 16 px side gutter (`px-4`), no horizontal page scroll. Every grid declares explicit tracks (`grid-cols-1`, `minmax(0,1fr)`) so wide content can't stretch the page.
- **Navigation:** a fixed bottom **tab bar** (`--tabbar-h`, safe-area padded) with the 5 modes (lucide icon + `short` label). The top bar is compact (`--topbar-h`): logo, location button, search and account. Page content pads by both heights.
- **Touch targets ≥ 44 px** (`pointer-coarse:` variants are built into Button/Segmented/Toggle). No hover-only affordances; anything revealed on hover must also work on tap.
- **Map-first screens (Severe):** the map fills the space between top bar and tab bar. Controls, warnings and details live in a `<Sheet>`. The radar transport sits just above the sheet peek. Nothing permanently covers more than ~40% of the map.
- Dialogs (search, report composer) are full-height sheets on phones.
- Charts: tap-to-inspect works (pointer events) and vertical page scroll is never blocked (`touch-action: pan-y`).
- Test at 360 × 740, 390 × 844, 430 × 932 and landscape 844 × 390.

## 7. Motion

Motion explains change; it doesn't decorate. Use short (150–250 ms) opacity/translate transitions for appearing panels and mode changes, no springy overshoot on UI chrome, and no hover scale. The weather background may animate; `prefers-reduced-motion` turns it static.
