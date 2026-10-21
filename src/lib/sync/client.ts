"use client";
/**
 * Keeps this device's settings (lib/sync/settings.ts) in step with the
 * signed-in account. Changes here go up a moment after they settle; the
 * account's are fetched when the app opens, comes back into view, and every
 * few minutes. When both sides changed, the later change wins. Applying the
 * account's settings rewrites the stores' saved state and rehydrates them,
 * so each store's own checks run; that never counts as a change here.
 */
import { create } from "zustand";
import { useAddonsStore } from "@/store/addons-store";
import { useAlertsStore } from "@/store/alerts-store";
import { useAppStore } from "@/store/app-store";
import { useBroadcastStore } from "@/store/broadcast-store";
import { useGisStore } from "@/store/gis-store";
import { useMapStyleStore } from "@/store/map-style-store";
import { usePaletteStore } from "@/store/palette-store";
import { useProStore } from "@/store/pro-store";
import { applySettings, collect, fingerprint, type SectionId, type SyncedSettings } from "./settings";

interface PersistedStore {
  persist: { rehydrate: () => Promise<void> | void };
  subscribe: (listener: () => void) => () => void;
}

const STORES: Record<SectionId, PersistedStore> = {
  app: useAppStore,
  mapStyle: useMapStyleStore,
  palettes: usePaletteStore,
  pro: useProStore,
  alerts: useAlertsStore,
  addons: useAddonsStore,
  layers: useGisStore,
  broadcast: useBroadcastStore,
};

// ── What this device remembers about syncing ────────────────────────────────

const META_KEY = "stormcentral:sync:v1";

interface Meta {
  /** Sync is on for this account on this device. */
  userId: string | null;
  /** When this device's synced settings last changed (epoch ms). */
  changedAt: number;
  /** The settings both sides last agreed on, as a fingerprint. */
  agreed: string;
}

const NO_META: Meta = { userId: null, changedAt: 0, agreed: "" };

function readMeta(): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) ?? "null") as Partial<Meta> | null;
    return { userId: typeof m?.userId === "string" ? m.userId : null, changedAt: Number(m?.changedAt) || 0, agreed: typeof m?.agreed === "string" ? m.agreed : "" };
  } catch {
    return NO_META;
  }
}
function writeMeta(patch: Partial<Meta>) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
  } catch {
    /* storage full or blocked: syncing still works this session */
  }
}

/** Sync is on here for this account. */
export const syncOnFor = (userId: string | null | undefined) => !!userId && readMeta().userId === userId;

// ── Status for the settings panel ───────────────────────────────────────────

export type SyncState = "off" | "syncing" | "synced" | "error";

export const useSyncStatus = create<{ state: SyncState; at: number | null; error: string | null }>()(() => ({ state: "off", at: null, error: null }));
const status = (state: SyncState, error: string | null = null) =>
  useSyncStatus.setState((s) => ({ state, error, at: state === "synced" ? Date.now() : s.at }));

// ── Talking to the account ──────────────────────────────────────────────────

interface Remote {
  data: SyncedSettings | null;
  changedAt: number;
}

async function fetchRemote(): Promise<Remote> {
  const res = await fetch("/api/settings", { credentials: "same-origin", cache: "no-store" });
  if (res.status === 401) throw new Error("Signed out");
  if (!res.ok) throw new Error(`The server said ${res.status}`);
  return (await res.json()) as Remote;
}

/** Send settings up; the account's newer ones when another device got there first. */
async function sendRemote(data: SyncedSettings, changedAt: number): Promise<{ ok: true; changedAt: number } | { ok: false; current: Remote }> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, changedAt }),
  });
  if (res.status === 409) return { ok: false, current: (await res.json()) as Remote };
  if (!res.ok) throw new Error(res.status === 413 ? "These settings are too big to keep on your account" : `The server said ${res.status}`);
  return { ok: true, changedAt: ((await res.json()) as { changedAt: number }).changedAt };
}

/** Remove the settings kept on the account. */
export async function forgetRemote() {
  const res = await fetch("/api/settings", { method: "DELETE", credentials: "same-origin" });
  if (!res.ok && res.status !== 204) throw new Error(`The server said ${res.status}`);
}

// ── Local settings ──────────────────────────────────────────────────────────

const local = () => collect((k) => localStorage.getItem(k));

let applying = false;

/** Use the account's settings on this device. */
async function applyRemote(data: SyncedSettings) {
  applying = true;
  try {
    const changed = applySettings(data, (k) => localStorage.getItem(k), (k, v) => localStorage.setItem(k, v));
    await Promise.all(changed.map((id) => STORES[id].persist.rehydrate()));
  } finally {
    // Store listeners run during the rehydrate; let them pass first.
    await Promise.resolve();
    applying = false;
  }
}

// ── The sync itself ─────────────────────────────────────────────────────────

let running: Promise<void> | null = null;
/** A change here not yet stamped (its push is waiting for edits to settle): when it started, else 0. */
let pendingSince = 0;
/** Asked again while a round was running: one more round after it, so a change made meanwhile isn't left behind. */
let again = false;

/** One round: fetch the account's settings, then use them or send ours, whichever is newer. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = round().finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return running;
}

async function round() {
  const meta = readMeta();
  if (!meta.userId) return;
  status("syncing");
  try {
    const remote = await fetchRemote();
    const mine = local();
    const myPrint = fingerprint(mine);
    if (!remote.data) return await push(mine, meta.changedAt);
    const theirPrint = fingerprint(remote.data);
    if (theirPrint === myPrint) {
      writeMeta({ agreed: myPrint });
      return status("synced");
    }
    // Nothing changed here since we last agreed, or the account's change is the later one: take it.
    const mineAt = Math.max(meta.changedAt, pendingSince);
    if (myPrint === meta.agreed || remote.changedAt > mineAt) return await take(remote);
    await push(mine, mineAt);
  } catch (err) {
    status("error", (err as Error).message);
  }
}

async function take(remote: Remote) {
  await applyRemote(remote.data!);
  // Stored as the stores keep it (their checks may have tidied it).
  writeMeta({ agreed: fingerprint(local()), changedAt: remote.changedAt });
  status("synced");
}

async function push(mine: SyncedSettings, at: number) {
  const changedAt = at || Date.now();
  const r = await sendRemote(mine, changedAt);
  if (!r.ok) {
    if (r.current.data) return take(r.current);
    return;
  }
  writeMeta({ agreed: fingerprint(mine), changedAt: r.changedAt });
  status("synced");
}

// ── Watching for changes ────────────────────────────────────────────────────

let stop: (() => void) | null = null;
const PUSH_AFTER_MS = 2500;
const PULL_EVERY_MS = 5 * 60_000;

/** Start keeping this device in step with the account (sync must be on for it). */
export function startSync() {
  if (stop || !readMeta().userId) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // When the first change of a burst happened: the later change wins a conflict, so it's
  // the time of the change, not of sending it.
  let firstAt = 0;
  const changed = () => {
    if (applying) return;
    if (!timer) firstAt = pendingSince = Date.now();
    else clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pendingSince = 0;
      // Only when something that travels changed (a mode switch or a new location doesn't).
      if (fingerprint(local()) === readMeta().agreed) return;
      writeMeta({ changedAt: firstAt });
      void syncNow();
    }, PUSH_AFTER_MS);
  };
  const offs = Object.values(STORES).map((s) => s.subscribe(changed));
  const visible = () => {
    if (document.visibilityState === "visible") void syncNow();
  };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("focus", visible);
  const every = setInterval(visible, PULL_EVERY_MS);
  void syncNow();
  stop = () => {
    offs.forEach((off) => off());
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("focus", visible);
    clearInterval(every);
    if (timer) clearTimeout(timer);
    pendingSince = 0;
  };
}

export function stopSync() {
  stop?.();
  stop = null;
  status("off");
}

/**
 * Turn sync on for an account. `keep` says which settings win the first
 * time: the ones already on the account, or this device's.
 */
export async function enableSync(userId: string, keep: "account" | "device") {
  stopSync();
  writeMeta({ userId, agreed: "", changedAt: 0 });
  status("syncing");
  try {
    if (keep === "account") {
      const remote = await fetchRemote();
      if (remote.data) await take(remote);
      else await push(local(), Date.now());
    } else {
      writeMeta({ changedAt: Date.now() });
      const mine = local();
      const r = await sendRemote(mine, Date.now() + 1);
      if (!r.ok) throw new Error("Another device changed the settings just now; try again");
      writeMeta({ agreed: fingerprint(mine), changedAt: r.changedAt });
      status("synced");
    }
    startSync();
  } catch (err) {
    status("error", (err as Error).message);
  }
}

export function disableSync() {
  stopSync();
  writeMeta(NO_META);
}

/** Whether the account holds settings, and whether they differ from this device's (to ask which to keep). */
export async function remoteDiffers(): Promise<{ has: boolean; differs: boolean }> {
  const remote = await fetchRemote();
  if (!remote.data) return { has: false, differs: false };
  return { has: true, differs: fingerprint(remote.data) !== fingerprint(local()) };
}
