"use client";

import { FileUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNow } from "@/hooks/use-now";
import { useT } from "@/lib/i18n/use-t";
import { layerName, readLayer } from "@/lib/gis";
import { fetchLayerText } from "@/lib/gis/load";
import { GIS_PRESETS } from "@/lib/gis/presets";
import { paintSwatch } from "@/lib/gis/symbol-art";
import { symbolsUsed, type SymbolId } from "@/lib/gis/symbols";
import { timeAgo } from "@/lib/time";
import { MAX_GIS_LAYERS, useGisStore, type GisLayerConfig } from "@/store/gis-store";
import { Button, IconButton } from "../ui/button";
import { Toggle } from "../ui/misc";
import { useGisData } from "./layers/gis-layers";

/** Files are kept in the browser's storage, which holds a few megabytes in all. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const FORMAT_LABEL = { placefile: "Placefile", kml: "KML", geojson: "GeoJSON" } as const;

const SYMBOL_LABEL: Record<SymbolId, string> = {
  "spotter-live": "Spotter or chaser, reported in the last 15 min",
  "spotter-recent": "Reported in the last hour",
  "spotter-old": "Last report over an hour ago",
  heading: "On the move: the arrow points where they're heading",
};

/** A legend swatch: the symbol exactly as the map draws it. */
function Swatch({ id }: { id: SymbolId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const ratio = Math.ceil(window.devicePixelRatio || 1);
    c.width = c.height = 22 * ratio;
    g.scale(ratio, ratio);
    paintSwatch(g, id);
  }, [id]);
  return <canvas ref={ref} aria-hidden className="size-[22px] shrink-0" />;
}

function LayerRow({ layer }: { layer: GisLayerConfig }) {
  const t = useT();
  const now = useNow(30_000);
  const setLayer = useGisStore((s) => s.setLayer);
  const remove = useGisStore((s) => s.remove);
  const q = useGisData(layer);
  const count = q.data?.features.length ?? 0;
  const symbols = q.data ? symbolsUsed(q.data) : [];
  const status = q.error
    ? t("Couldn't load: {reason}", { reason: t(q.error.message) })
    : q.isLoading
      ? t("Loading")
      : layer.url
        ? t("{n} items · updated {ago}", { n: count, ago: timeAgo(q.dataUpdatedAt, now, t) })
        : t("{n} items · from a file", { n: count });
  return (
    <li className="space-y-1.5 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Toggle label={layer.name} checked={layer.enabled} onChange={(enabled) => setLayer(layer.id, { enabled })} />
          <p className={q.error ? "-mt-1 text-[11px] text-caution" : "-mt-1 text-[11px] text-ink-3"}>
            {t(FORMAT_LABEL[layer.format])} · {status}
          </p>
        </div>
        <IconButton size="sm" label={t("Remove {name}", { name: layer.name })} onClick={() => remove(layer.id)}>
          <Trash2 className="size-3.5" aria-hidden />
        </IconButton>
      </div>
      {layer.enabled && symbols.length > 0 && (
        <ul className="space-y-0.5">
          {symbols.map((id) => (
            <li key={id} className="flex items-center gap-2 text-[11px] text-ink-3">
              <Swatch id={id} />
              {t(SYMBOL_LABEL[id])}
            </li>
          ))}
        </ul>
      )}
      {layer.enabled && (
        <label className="flex items-center gap-2 text-[11px] text-ink-3">
          {t("Opacity")}
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(layer.opacity * 100)}
            onChange={(e) => setLayer(layer.id, { opacity: Number(e.target.value) / 100 })}
            className="h-6 flex-1 accent-[var(--color-accent)]"
          />
        </label>
      )}
    </li>
  );
}

/**
 * Your own map layers: GRLevelX placefiles, KML and GeoJSON, by link or from
 * a file, plus a few checked public feeds to add with one tap. Shown on the
 * radar map and every Professional mode panel.
 */
export function GisManager() {
  const t = useT();
  const layers = useGisStore((s) => s.layers);
  const add = useGisStore((s) => s.add);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const full = layers.length >= MAX_GIS_LAYERS;

  const explain = (err: unknown) => {
    const m = err instanceof Error ? err.message : String(err);
    if (m === "not-a-layer") return t("That isn't a placefile, KML or GeoJSON layer.");
    if (m === "unreadable") return t("That layer couldn't be read; it may be damaged.");
    if (m === "no-room") return t("There's no room left on this device for that file.");
    if (m === "too-many") return t("You can have up to {n} layers.", { n: MAX_GIS_LAYERS });
    return t("Couldn't load: {reason}", { reason: m });
  };

  const addLink = async (raw: string) => {
    const url = raw.trim();
    setError(null);
    if (!/^https?:\/\/\S+$/i.test(url)) return setError(t("Paste a link starting with http:// or https://."));
    if (layers.some((l) => l.url === url)) return setError(t("That layer is already on your list."));
    setBusy(true);
    try {
      const { format, data } = readLayer(await fetchLayerText(url), url, url);
      add({ name: layerName(data, url), url, fileName: null, format });
      setLink("");
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const addFile = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (f.size > MAX_FILE_BYTES) return setError(t("Files can be up to 2 MB."));
    setBusy(true);
    try {
      const text = await f.text();
      const { format, data } = readLayer(text, f.name);
      add({ name: layerName(data, f.name), url: null, fileName: f.name, format }, text);
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const suggestions = GIS_PRESETS.filter((p) => !layers.some((l) => l.url === p.url));

  return (
    <div className="space-y-3">
      <p className="label">{t("GRLevelX placefiles, KML and GeoJSON: chaser positions, threat areas, roads, your own notes. Add them by link or from a file.")}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void addLink(link);
        }}
      >
        <input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://…/placefile.txt"
          aria-label={t("Link to a placefile, KML or GeoJSON")}
          disabled={full}
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
        />
        <Button type="submit" size="sm" disabled={busy || full || !link.trim()}>
          <Plus className="size-3.5" aria-hidden />
          {t("Add")}
        </Button>
      </form>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={busy || full} onClick={() => file.current?.click()}>
          <FileUp className="size-3.5" aria-hidden />
          {t("Open a file")}
        </Button>
        <input ref={file} type="file" accept=".txt,.placefile,.kml,.geojson,.json,text/plain,application/json,application/geo+json,application/vnd.google-earth.kml+xml" className="hidden" onChange={(e) => void addFile(e.target.files?.[0])} />
        {busy && <span className="text-[12px] text-ink-3">{t("Checking the layer…")}</span>}
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-caution">
          {error}
        </p>
      )}

      {layers.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {layers.map((l) => (
            <LayerRow key={l.id} layer={l} />
          ))}
        </ul>
      )}

      {suggestions.length > 0 && !full && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-ink-3">{t("Suggested")}</p>
          <ul className="space-y-2">
            {suggestions.map((p) => (
              <li key={p.url} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink">{t(p.name)}</p>
                  <p className="text-[11px] text-ink-3">{t(p.note)}</p>
                </div>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void addLink(p.url)}>
                  {t("Add")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
