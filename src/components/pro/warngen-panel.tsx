"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { qk, useSession, useSpotterWarnings } from "@/hooks/queries";
import { useNow } from "@/hooks/use-now";
import { reverseGeocode } from "@/lib/api/open-meteo";
import { compassPoint, pointInRing, type LatLon } from "@/lib/geo";
import { eventName } from "@/lib/i18n/nws-events";
import { useT } from "@/lib/i18n/use-t";
import { motionFrom } from "@/lib/pro/storm-tools";
import { cn } from "@/lib/utils";
import { openRing, ringAreaKm2, type Ring } from "@/lib/warngen/geometry";
import { HAIL_SIZES, SEVERE_HAIL, SEVERE_WIND, WARN_BASES, WARN_KINDS, WARN_PRODUCTS, WIND_GUSTS_MPH, type WarnKind, type WarnThreat } from "@/lib/warngen/products";
import { draftProblems, type SpotterWarningDto } from "@/lib/warngen/schema";
import { productName, warningText } from "@/lib/warngen/text";
import { clockIn } from "@/lib/weather/view";
import { newDraft, useProStore } from "@/store/pro-store";
import { Button, buttonClass } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { useWarnGeometry } from "./use-warngen";

const SELECT = "w-full rounded-[4px] border border-line bg-surface-2 px-1.5 py-1 text-ink";
const KT_TO_MPH = 1.150779;

const BASIS_LABEL = { radar: "Radar indicated", spotter: "Spotter confirmed", observed: "Observed" } as const;
const THREAT_LABEL: Record<WarnKind, Partial<Record<WarnThreat, string>>> = {
  TOR: { base: "Base", considerable: "PDS", catastrophic: "Emergency" },
  SVR: { base: "Base", considerable: "Considerable", destructive: "Destructive" },
  FFW: { base: "Base", considerable: "Considerable", catastrophic: "Emergency" },
  SQW: { base: "Base" },
  SPS: { base: "Base" },
};

async function send<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Reverse-geocoded names, cached for the session (rounded to ~1 km). */
const nameCache = new Map<string, Promise<string | null>>();
function placeAt(p: LatLon): Promise<string | null> {
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  let v = nameCache.get(key);
  if (!v) {
    v = reverseGeocode(p.lat, p.lon)
      .then((n) => (n && !/^my location$/i.test(n) ? n : null))
      .catch(() => null);
    nameCache.set(key, v);
  }
  return v;
}

/** Points to name: the polygon's centre and a 3×3 grid of points inside it. */
function samplePoints(ring: Ring): LatLon[] {
  const pts = openRing(ring);
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const out: LatLon[] = [{ lon: lons.reduce((a, b) => a + b, 0) / lons.length, lat: lats.reduce((a, b) => a + b, 0) / lats.length }];
  for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) out.push({ lon: w + ((e - w) * i) / 4, lat: s + ((n - s) * j) / 4 });
  return out.filter((p) => pointInRing(p.lon, p.lat, ring)).slice(0, 10);
}

/** The town nearest the storm and the towns in the polygon, looked up once the drawing settles. */
function usePlaces(storm: LatLon | null, ring: Ring | null) {
  const [state, setState] = useState<{ key: string; place: string | null; locations: string[] }>({ key: "", place: null, locations: [] });
  const key = `${storm ? `${storm.lat.toFixed(2)},${storm.lon.toFixed(2)}` : "-"}|${ring ? JSON.stringify(ring) : "-"}`;
  const latest = useRef({ storm, ring });
  useEffect(() => {
    latest.current = { storm, ring };
  });
  useEffect(() => {
    const { storm, ring } = latest.current;
    if (!storm && !ring) return;
    let alive = true;
    const id = setTimeout(async () => {
      const [place, ...names] = await Promise.all([storm ? placeAt(storm) : Promise.resolve(null), ...(ring ? samplePoints(ring).map(placeAt) : [])]);
      if (!alive) return;
      // "Norman, OK" → "Norman"; "Wayne Township, Noble County, OH" → "Wayne Township".
      const locations = [...new Set(names.filter((n): n is string => !!n).map((n) => n.split(",")[0]!.trim()))].slice(0, 12);
      setState({ key, place, locations });
    }, 900);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [key]);
  return { place: state.key === key ? state.place : null, locations: state.key === key ? state.locations : [], looking: state.key !== key && !!(storm || ring) };
}

/**
 * WarnGen for the spotter network. Pick the storm (and track it) on any
 * panel, pick the product and its tags, adjust the polygon, check the
 * generated text, and issue it to signed-in spotter-network members. Never an
 * NWS product: the text, the map style and every view of it say so.
 */
export function WarnGenPanel({ timeZone }: { timeZone?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const session = useSession();
  const list = useSpotterWarnings();
  const draft = useProStore((s) => s.warnDraft);
  const setDraft = useProStore((s) => s.setWarnDraft);
  const resetDraft = useProStore((s) => s.resetWarnDraft);
  const setVector = useProStore((s) => s.setVector);
  const g = useWarnGeometry();
  const places = usePlaces(g.storm, g.polygon);
  const now = useNow(30_000);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motionText, setMotionText] = useState({ from: "", kt: "" });
  const p = WARN_PRODUCTS[draft.kind];

  const problems = useMemo(() => {
    if (!g.storm) return [t("Click the storm on a panel first.")];
    if (!g.polygon) return [];
    return draftProblems({ ...draft, polygon: g.polygon }).map((m) => t(m));
  }, [draft, g.storm, g.polygon, t]);

  const preview = useMemo(() => {
    if (!g.polygon) return "";
    const user = session.data;
    return warningText(
      {
        ...draft,
        number: null,
        polygon: g.polygon,
        issuedAt: now,
        expiresAt: now + draft.minutes * 60_000,
        revision: draft.editing ? 1 : 0,
        cancelledAt: null,
        storm: g.storm,
        motion: g.motion,
        notes: draft.notes.trim() || null,
        place: places.place,
        locations: places.locations,
        issuer: user ? { username: user.username, displayName: user.displayName } : null,
      },
      { timeZone },
    );
  }, [draft, g, places.place, places.locations, session.data, timeZone, now]);

  if (session.isPending) return <p className="p-3 text-[12px] text-ink-3">{t("Loading")}</p>;
  if (!session.data)
    return (
      <div className="space-y-3 p-3 text-[12px]">
        <p className="text-ink-2">{t("WarnGen issues unofficial warnings to the StormCentral spotter network. Sign in to your spotter account to use it.")}</p>
        <div className="flex gap-2">
          <Link href="/login?next=/" className={buttonClass("primary", "sm")}>
            {t("Sign in")}
          </Link>
          <Link href="/register?next=/" className={buttonClass("secondary", "sm")}>
            {t("Create account")}
          </Link>
        </div>
      </div>
    );

  const canIssue = list.data?.canIssue ?? false;
  const pickKind = (kind: WarnKind) => setDraft({ ...newDraft(kind), polygon: draft.polygon, motion: draft.motion, notes: draft.notes, editing: draft.editing });

  const submit = async () => {
    if (!g.polygon || !g.storm) return;
    setBusy(true);
    setError(null);
    const body = {
      polygon: g.polygon,
      minutes: draft.minutes,
      storm: g.storm,
      motion: g.motion,
      basis: draft.basis,
      hail: draft.hail,
      wind: draft.wind,
      tornadoPossible: draft.tornadoPossible,
      threat: draft.threat,
      notes: draft.notes.trim() || null,
      place: places.place,
      locations: places.locations,
    };
    try {
      if (draft.editing) await send(`/api/spotter-warnings/${draft.editing}`, "PATCH", { action: "update", ...body });
      else await send("/api/spotter-warnings", "POST", { kind: draft.kind, ...body });
      resetDraft();
      setVector(null);
      setAgree(false);
      await qc.invalidateQueries({ queryKey: qk.spotterWarnings });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (w: SpotterWarningDto) => {
    if (!window.confirm(t("Cancel {name}?", { name: productName(w.kind, w.number) }))) return;
    try {
      await send(`/api/spotter-warnings/${w.id}`, "PATCH", { action: "cancel" });
      if (draft.editing === w.id) resetDraft();
      await qc.invalidateQueries({ queryKey: qk.spotterWarnings });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const edit = (w: SpotterWarningDto) => {
    const remaining = Math.max(10, Math.round((w.expiresAt - now) / 60_000));
    const minutes = WARN_PRODUCTS[w.kind].minutes.reduce((best, m) => (Math.abs(m - remaining) < Math.abs(best - remaining) ? m : best));
    setVector(w.storm ? { a: w.storm, b: null } : null);
    setDraft({ kind: w.kind, minutes, basis: w.basis, hail: w.hail, wind: w.wind, tornadoPossible: w.tornadoPossible, threat: w.threat, notes: w.notes ?? "", polygon: w.polygon, motion: w.motion, editing: w.id });
  };

  const applyMotion = () => {
    const from = Number(motionText.from);
    const kt = Number(motionText.kt);
    if (!Number.isFinite(from) || !Number.isFinite(kt) || kt < 0 || kt > 120) return;
    setDraft({ motion: { headingDeg: (((from + 180) % 360) + 360) % 360, speedKt: kt } });
  };

  const hailOptions = HAIL_SIZES.filter((h) => (draft.kind === "SPS" ? h.inches < SEVERE_HAIL : h.inches >= SEVERE_HAIL));
  const windOptions = WIND_GUSTS_MPH.filter((w) => (draft.kind === "SPS" ? w < SEVERE_WIND : draft.kind === "SVR" ? w >= SEVERE_WIND : true));
  const active = (list.data?.warnings ?? []).filter((w) => w.status === "active");
  const ended = (list.data?.warnings ?? []).filter((w) => w.status !== "active");

  return (
    <div className="space-y-3 p-3 text-[12px]">
      <p className="rounded-[4px] bg-caution/15 px-2 py-1.5 font-semibold text-ink">
        {t("Spotter network only: these warnings are unofficial and go to signed-in StormCentral spotters, not the public or the NWS.")}
      </p>

      {list.data && !canIssue && <p className="rounded-[4px] border border-line px-2 py-1.5 text-ink-2">{t(list.data.reason ?? "You can't issue spotter warnings yet.")}</p>}

      {canIssue && (
        <>
          {draft.editing && (
            <div className="flex items-center justify-between gap-2 rounded-[4px] bg-accent/15 px-2 py-1.5 text-ink">
              <span>{t("Updating an issued warning")}</span>
              <button type="button" className="text-ink-3 hover:text-ink" onClick={() => (resetDraft(), setVector(null))}>
                {t("Stop")}
              </button>
            </div>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <label className="min-w-0">
              <span className="label">{t("Product")}</span>
              <select aria-label={t("Product")} className={SELECT} value={draft.kind} disabled={!!draft.editing} onChange={(e) => pickKind(e.target.value as WarnKind)}>
                {WARN_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {eventName(t.lang, WARN_PRODUCTS[k].label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">{t("Duration")}</span>
              <select aria-label={t("Duration")} className={SELECT} value={draft.minutes} onChange={(e) => setDraft({ minutes: Number(e.target.value) })}>
                {p.minutes.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 || m % 60 ? `${m} min` : `${m / 60} h`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <section className="space-y-1.5 rounded-[4px] bg-surface-2 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">{t("Storm")}</span>
              {g.storm && (
                <button type="button" className="text-ink-3 hover:text-ink" onClick={() => (setVector(null), setDraft({ motion: null, polygon: null }))}>
                  {t("Re-pick")}
                </button>
              )}
            </div>
            {!g.storm ? (
              <p className="text-ink-2">{t("Click the storm's core on any panel (drag me to storm).")}</p>
            ) : g.motion ? (
              <p className="font-mono text-ink">
                {t("Moving {dir} at {mph} mph", { dir: compassPoint(g.motion.headingDeg), mph: Math.round(g.motion.speedKt * KT_TO_MPH) })} · {String(Math.round(motionFrom(g.motion))).padStart(3, "0")}°/{Math.round(g.motion.speedKt)} kt
              </p>
            ) : (
              <p className="text-ink-2">
                {g.tracking ? t("Step the loop a few frames and click the same core again to track it, or type the motion. Without it the polygon is drawn around a stationary storm.") : t("Stationary storm.")}
              </p>
            )}
            {g.storm && (
              <div className="flex items-end gap-1.5">
                <label className="w-16">
                  <span className="label">{t("From °")}</span>
                  <input aria-label={t("From °")} className={SELECT} inputMode="numeric" value={motionText.from} onChange={(e) => setMotionText((m) => ({ ...m, from: e.target.value }))} placeholder="240" />
                </label>
                <label className="w-20">
                  <span className="label">{t("Speed, kt")}</span>
                  <input aria-label={t("Speed, kt")} className={SELECT} inputMode="numeric" value={motionText.kt} onChange={(e) => setMotionText((m) => ({ ...m, kt: e.target.value }))} placeholder="30" />
                </label>
                <Button size="sm" variant="secondary" onClick={applyMotion}>
                  {t("Set motion")}
                </Button>
                {draft.motion && (
                  <button type="button" className="pb-1.5 text-ink-3 hover:text-ink" onClick={() => setDraft({ motion: null })}>
                    {t("Use picks")}
                  </button>
                )}
              </div>
            )}
          </section>

          {g.polygon && (
            <section className="space-y-1 rounded-[4px] bg-surface-2 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{t("Polygon")}</span>
                <span className="font-mono text-ink-3">
                  {openRing(g.polygon).length} · {Math.round(ringAreaKm2(g.polygon)).toLocaleString(t.locale)} km²
                </span>
              </div>
              <p className="text-ink-3">{t("Drag corners on any panel. Drag a midpoint to add a corner; right-click or double-click a corner to remove it.")}</p>
              {!g.auto && (
                <button type="button" className="text-accent hover:underline" onClick={() => setDraft({ polygon: null })}>
                  {t("Redraw from the track")}
                </button>
              )}
            </section>
          )}

          <div>
            <span className="label">{t("Source")}</span>
            <Segmented ariaLabel={t("Source")} size="sm" stretch value={draft.basis} onChange={(basis) => setDraft({ basis })} options={WARN_BASES.map((b) => ({ value: b, label: t(BASIS_LABEL[b]) }))} />
          </div>

          {(p.hail || p.wind) && (
            <div className="grid grid-cols-2 gap-2">
              {p.hail && (
                <label>
                  <span className="label">{t("Max hail")}</span>
                  <select aria-label={t("Max hail")} className={SELECT} value={draft.hail} onChange={(e) => setDraft({ hail: Number(e.target.value) })}>
                    <option value={0}>{t("None")}</option>
                    {hailOptions.map((h) => (
                      <option key={h.inches} value={h.inches}>
                        {h.inches.toFixed(2)}″ · {t(h.name)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {p.wind && (
                <label>
                  <span className="label">{t("Max wind")}</span>
                  <select aria-label={t("Max wind")} className={SELECT} value={draft.wind} onChange={(e) => setDraft({ wind: Number(e.target.value) })}>
                    <option value={0}>{t("None")}</option>
                    {windOptions.map((w) => (
                      <option key={w} value={w}>
                        {w} mph
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {p.tornadoPossible && (
            <label className="flex items-center gap-2 text-ink-2">
              <input type="checkbox" checked={draft.tornadoPossible} onChange={(e) => setDraft({ tornadoPossible: e.target.checked })} />
              {t("Tornado possible")}
            </label>
          )}
          {p.threats.length > 1 && (
            <div>
              <span className="label">{t("Damage threat")}</span>
              <Segmented ariaLabel={t("Damage threat")} size="sm" stretch value={draft.threat} onChange={(threat) => setDraft({ threat })} options={p.threats.map((x) => ({ value: x, label: t(THREAT_LABEL[draft.kind][x] ?? x) }))} />
            </div>
          )}
          <label className="block">
            <span className="label">{t("Notes for other spotters (optional)")}</span>
            <textarea aria-label={t("Notes for other spotters (optional)")} className={cn(SELECT, "min-h-14 resize-y")} maxLength={300} value={draft.notes} onChange={(e) => setDraft({ notes: e.target.value })} />
          </label>

          {preview && (
            <details open className="rounded-[4px] border border-line">
              <summary className="cursor-pointer px-2 py-1 font-semibold text-ink">
                {t("Product text")} {places.looking && <span className="font-normal text-ink-3">· {t("looking up towns…")}</span>}
              </summary>
              <pre className="max-h-72 overflow-auto px-2 pb-2 font-mono text-[11px] leading-snug whitespace-pre-wrap text-ink-2">{preview}</pre>
            </details>
          )}

          {problems.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-caution">
              {problems.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          <label className="flex items-start gap-2 text-ink-2">
            <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{t("I understand this goes only to the StormCentral spotter network, is not an official warning, and that misusing WarnGen can get my account suspended.")}</span>
          </label>
          {error && <p className="text-nogo">{error}</p>}
          <Button variant="primary" className="w-full" disabled={busy || !agree || problems.length > 0 || !g.polygon} onClick={submit}>
            {busy ? t("Sending…") : draft.editing ? t("Update warning") : t("Issue to spotter network")}
          </Button>
        </>
      )}

      <section className="space-y-1.5 border-t border-line pt-3">
        <h3 className="font-semibold text-ink">{t("Spotter network warnings")}</h3>
        {!active.length && !ended.length && <p className="text-ink-3">{t("None right now.")}</p>}
        {[...active, ...ended].map((w) => (
          <div key={w.id} className={cn("rounded-[4px] border border-line p-2", w.status !== "active" && "opacity-60")}>
            <div className="flex items-start gap-2">
              <span className="mt-1 size-2.5 shrink-0 rounded-[2px]" style={{ background: WARN_PRODUCTS[w.kind].color }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{productName(w.kind, w.number)}</p>
                <p className="truncate text-ink-3">
                  @{w.issuer.username} ·{" "}
                  {w.status === "active"
                    ? t("until {time}", { time: clockIn(timeZone, w.expiresAt, t.locale) })
                    : w.status === "cancelled"
                      ? t("cancelled")
                      : t("expired")}
                  {w.revision > 0 && ` · ${t("updated")}`}
                </p>
              </div>
            </div>
            {w.status === "active" && (w.mine || list.data?.moderator) && (
              <div className="mt-1.5 flex gap-1.5">
                {w.mine && canIssue && (
                  <Button size="sm" variant="secondary" onClick={() => edit(w)}>
                    {t("Edit and update")}
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => cancel(w)}>
                  {t("Cancel warning")}
                </Button>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
