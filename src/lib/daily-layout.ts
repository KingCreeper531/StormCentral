/**
 * The Daily page's customisable layout: which panels show, in what order, and
 * where on wide screens (the wide left column, the narrow right one, or full
 * width). Phones show the visible panels in order, one column.
 */

export const DAILY_PANELS = [
  { id: "hero", label: "Current conditions", col: "main" },
  { id: "nowcast", label: "Next 3 hours", col: "side" },
  { id: "hourly", label: "Hourly forecast", col: "main" },
  { id: "radar", label: "Radar", col: "side" },
  { id: "severe", label: "Severe weather outlook", col: "full", hint: "Shows when you're in an SPC risk area" },
  { id: "compare", label: "Forecast comparison", col: "full" },
  { id: "conditions", label: "Conditions", col: "main" },
  { id: "outlook", label: "10-day forecast", col: "side" },
  { id: "sunmoon", label: "Sun and moon", col: "main" },
  { id: "notes", label: "Forecaster notes", col: "main", hint: "US only" },
  { id: "climate", label: "Compared with normal", col: "side", hint: "US only" },
  { id: "rainfall", label: "Rainfall and flooding", col: "main" },
  { id: "fire", label: "Fire and smoke", col: "side" },
  { id: "reports", label: "Reports near you", col: "full" },
] as const satisfies readonly { id: string; label: string; col: DailyColumn; hint?: string }[];

export type DailyPanelId = (typeof DAILY_PANELS)[number]["id"];
export type DailyColumn = "main" | "side" | "full";

export interface DailyItem {
  id: DailyPanelId;
  col: DailyColumn;
  hidden: boolean;
}

const IDS = new Set<string>(DAILY_PANELS.map((p) => p.id));
const COLS = new Set<string>(["main", "side", "full"]);

export const panelInfo = (id: DailyPanelId) => DAILY_PANELS.find((p) => p.id === id)!;

export const defaultDailyLayout = (): DailyItem[] => DAILY_PANELS.map((p) => ({ id: p.id, col: p.col, hidden: false }));

/**
 * A saved layout made safe: unknown or repeated panels dropped, bad columns
 * reset, and panels added in later versions appended (visible) where they
 * sit in the default order.
 */
export function normalizeDailyLayout(saved: unknown): DailyItem[] {
  if (!Array.isArray(saved)) return defaultDailyLayout();
  const out: DailyItem[] = [];
  const seen = new Set<string>();
  for (const raw of saved) {
    const r = raw as Partial<DailyItem> | null;
    if (!r || typeof r.id !== "string" || !IDS.has(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, col: typeof r.col === "string" && COLS.has(r.col) ? r.col : panelInfo(r.id).col, hidden: r.hidden === true });
  }
  DAILY_PANELS.forEach((p, i) => {
    if (seen.has(p.id)) return;
    // After the nearest default-order predecessor that is present.
    const before = DAILY_PANELS.slice(0, i).map((q) => q.id).reverse().find((id) => seen.has(id));
    const at = before ? out.findIndex((x) => x.id === before) + 1 : 0;
    out.splice(at, 0, { id: p.id, col: p.col, hidden: false });
    seen.add(p.id);
  });
  return out;
}

/**
 * The visible panel a move would swap with. On wide screens (`columns`) a
 * panel moves within its own column, or past a full-width panel into the
 * next section; full-width panels step past any panel.
 */
function neighbor(layout: DailyItem[], id: DailyPanelId, dir: -1 | 1, columns: boolean): DailyItem | null {
  const visible = layout.filter((x) => !x.hidden);
  const i = visible.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const me = visible[i]!;
  for (let j = i + dir; j >= 0 && j < visible.length; j += dir) {
    const x = visible[j]!;
    if (!columns || me.col === "full" || x.col === "full" || x.col === me.col) return x;
  }
  return null;
}

export const canMoveDailyItem = (layout: DailyItem[], id: DailyPanelId, dir: -1 | 1, columns = false) => neighbor(layout, id, dir, columns) != null;

/** Moves a panel one step (hidden panels keep their place). */
export function moveDailyItem(layout: DailyItem[], id: DailyPanelId, dir: -1 | 1, columns = false): DailyItem[] {
  const target = neighbor(layout, id, dir, columns);
  if (!target) return layout;
  const next = [...layout];
  const a = next.findIndex((x) => x.id === id);
  const b = next.findIndex((x) => x.id === target.id);
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

/** Wide screens: runs of main/side panels become two-column sections; full-width panels sit between them. */
export function dailySections(items: DailyItem[]): ({ kind: "full"; item: DailyItem } | { kind: "split"; main: DailyItem[]; side: DailyItem[] })[] {
  const out: ({ kind: "full"; item: DailyItem } | { kind: "split"; main: DailyItem[]; side: DailyItem[] })[] = [];
  for (const item of items) {
    if (item.col === "full") {
      out.push({ kind: "full", item });
      continue;
    }
    let last = out[out.length - 1];
    if (!last || last.kind !== "split") {
      last = { kind: "split", main: [], side: [] };
      out.push(last);
    }
    last[item.col].push(item);
  }
  return out;
}
