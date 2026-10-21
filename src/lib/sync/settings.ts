/**
 * Settings that follow a signed-in person between their devices (the
 * desktop app, the web, the Android app), kept on their account
 * (/api/settings). Each section is one of the app's saved stores, read and
 * written as the store keeps it in local storage (`{ state, version }`);
 * after writing, the store is rehydrated, so its own `merge` checks and
 * repairs everything that came from the account, as it does for anything
 * read from storage.
 *
 * Some things stay on each device: where you are, which mode is open, your
 * own Google key, chaser position sharing, the notifications master switch
 * (it depends on that device's permission), files you loaded as custom
 * layers (only layers from links travel) and the broadcast logo (too big).
 * Pure; the engine is hooks/use-settings-sync.ts.
 */

export const SYNC_VERSION = 1;
/** The account keeps at most this much (JSON characters). */
export const MAX_SETTINGS_CHARS = 128 * 1024;

export type SectionId = "app" | "mapStyle" | "palettes" | "pro" | "alerts" | "addons" | "layers" | "broadcast";

type State = Record<string, unknown>;

interface SectionDef {
  id: SectionId;
  /** The store's local storage key. */
  key: string;
  /** The store's persist version, for a section this device hasn't stored yet. */
  version: number;
  /** The fields that travel. */
  pick: (local: State) => State;
  /** The device's own state with the account's fields laid over it. */
  overlay: (local: State, synced: State) => State;
}

const fields =
  (...keys: string[]) =>
  (s: State): State => {
    const out: State = {};
    for (const k of keys) if (k in s) out[k] = s[k];
    return out;
  };
const plain = (...keys: string[]): Pick<SectionDef, "pick" | "overlay"> => {
  const pick = fields(...keys);
  return { pick, overlay: (local, synced) => ({ ...local, ...pick(synced) }) };
};
const isObject = (v: unknown): v is State => !!v && typeof v === "object" && !Array.isArray(v);

export const SECTIONS: readonly SectionDef[] = [
  {
    id: "app",
    key: "stormcentral:v1",
    version: 1,
    ...plain("units", "theme", "radar", "drone", "airLayer", "radiusKm", "clock", "timeZoneMode", "followLocation", "widgetBackground", "forecastSource", "dailyLayout", "language", "professional"),
  },
  { id: "mapStyle", key: "stormcentral:map-style:v1", version: 1, ...plain("style", "presets") },
  { id: "palettes", key: "stormcentral:palettes:v1", version: 1, ...plain("chosen", "imported") },
  { id: "pro", key: "stormcentral:pro", version: 1, ...plain("layout", "panes", "site", "frames", "speed", "guideButton", "meteogramModels", "meteogramEnsemble", "volume3d") },
  {
    id: "alerts",
    key: "stormcentral:alerts:v1",
    version: 1,
    // Places, custom alerts and what to be told about; not whether this device notifies at all.
    pick: (s) => {
      const out = fields("places", "rules")(s);
      if (isObject(s.settings)) {
        const rest = { ...s.settings };
        delete rest.enabled;
        out.settings = rest;
      }
      return out;
    },
    overlay: (local, synced) => {
      const out = { ...local, ...fields("places", "rules")(synced) };
      if (isObject(synced.settings)) {
        const own = isObject(local.settings) ? local.settings : {};
        out.settings = { ...own, ...synced.settings, enabled: own.enabled ?? false };
      }
      return out;
    },
  },
  { id: "addons", key: "stormcentral:addons:v1", version: 1, ...plain("themes", "activeTheme", "plugins") },
  {
    id: "layers",
    key: "stormcentral:gis:v1",
    version: 1,
    // Layers from links; a file's text is on the device that loaded it.
    pick: (s) => (Array.isArray(s.layers) ? { layers: s.layers.filter((l) => isObject(l) && typeof l.url === "string") } : {}),
    overlay: (local, synced) => {
      if (!Array.isArray(synced.layers)) return local;
      const files = Array.isArray(local.layers) ? local.layers.filter((l) => isObject(l) && typeof l.url !== "string") : [];
      return { ...local, layers: [...files, ...synced.layers] };
    },
  },
  { id: "broadcast", key: "stormcentral:broadcast:v1", version: 1, ...plain("name", "tagline", "accent", "parts", "scenes", "tourSeconds") },
];

export interface SyncedSettings {
  v: typeof SYNC_VERSION;
  sections: Partial<Record<SectionId, State>>;
}

/** What `get(key)` holds for a store: its saved state, or null. */
function readStored(get: (key: string) => string | null, key: string): { state: State; version: number } | null {
  try {
    const raw = JSON.parse(get(key) ?? "null") as { state?: unknown; version?: unknown } | null;
    if (!raw || !isObject(raw.state)) return null;
    return { state: raw.state, version: typeof raw.version === "number" ? raw.version : 0 };
  } catch {
    return null;
  }
}

/** This device's settings that travel, from local storage. */
export function collect(get: (key: string) => string | null): SyncedSettings {
  const sections: SyncedSettings["sections"] = {};
  for (const d of SECTIONS) {
    const stored = readStored(get, d.key);
    if (stored) sections[d.id] = d.pick(stored.state);
  }
  return { v: SYNC_VERSION, sections };
}

/**
 * Lay the account's settings over this device's in local storage. Returns
 * the sections whose stored state changed (their stores need rehydrating).
 */
export function applySettings(remote: SyncedSettings, get: (key: string) => string | null, set: (key: string, value: string) => void): SectionId[] {
  const changed: SectionId[] = [];
  for (const d of SECTIONS) {
    const synced = remote.sections[d.id];
    if (!isObject(synced)) continue;
    const stored = readStored(get, d.key) ?? { state: {}, version: d.version };
    const next = d.overlay(stored.state, synced);
    // Only what travels counts: the same settings in another order aren't a change.
    if (JSON.stringify(d.pick(next)) === JSON.stringify(d.pick(stored.state))) continue;
    set(d.key, JSON.stringify({ state: next, version: stored.version || d.version }));
    changed.push(d.id);
  }
  return changed;
}

/** Settings sent to the account, checked: the known sections only, each an object, within the size limit. */
export function validateSettings(raw: unknown): SyncedSettings | null {
  if (!isObject(raw) || raw.v !== SYNC_VERSION || !isObject(raw.sections)) return null;
  const sections: SyncedSettings["sections"] = {};
  for (const d of SECTIONS) {
    const s = raw.sections[d.id];
    if (s === undefined) continue;
    if (!isObject(s)) return null;
    sections[d.id] = s;
  }
  const out = { v: SYNC_VERSION, sections } as SyncedSettings;
  return JSON.stringify(out).length <= MAX_SETTINGS_CHARS ? out : null;
}

/** A short fingerprint of some settings, to tell whether they changed (FNV-1a). */
export function fingerprint(s: SyncedSettings): string {
  const text = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
