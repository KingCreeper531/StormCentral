"use client";

import { useRef, useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { BUILTIN_PALETTES, LIMITS, parsePal } from "@/lib/pro/palettes";
import type { DecodedScaleId } from "@/lib/pro/scales";
import { cn } from "@/lib/utils";
import { palettesFor, usePaletteStore } from "@/store/palette-store";

const SCALE_NAME: Record<DecodedScaleId, string> = {
  ref: "reflectivity",
  vel: "velocity",
  cc: "correlation coefficient",
  zdr: "differential reflectivity",
  kdp: "specific differential phase",
  hc: "hydrometeor classes",
  vil: "VIL",
  eet: "echo tops",
};

const BUILTIN = new Set(BUILTIN_PALETTES.map((p) => p.id));
const MAX_FILE = 200_000;

/**
 * The colour table for a decoded product (lib/pro/palettes.ts): the
 * standard one, a built-in alternative or an imported GRLevelX palette. One
 * pick per product, shared by every panel showing it.
 */
export function ColourTablePicker({ scaleId }: { scaleId: DecodedScaleId }) {
  const t = useT();
  const chosen = usePaletteStore((s) => s.chosen[scaleId] ?? "");
  const imported = usePaletteStore((s) => s.imported);
  const { choose, add, remove } = usePaletteStore.getState();
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const list = palettesFor(scaleId, imported);
  const removable = chosen && !BUILTIN.has(chosen);

  const load = async (f: File) => {
    if (f.size > MAX_FILE) return setNote({ ok: false, text: t("That file is too big for a palette.") });
    const r = parsePal(await f.text(), f.name, scaleId);
    if (!r.ok) return setNote({ ok: false, text: t(r.error, r.params) });
    if (!add(r.palette)) return setNote({ ok: false, text: t("You can keep up to {n} palettes. Remove one first.", { n: LIMITS.imported }) });
    setNote({ ok: true, text: r.palette.scale === scaleId ? t("Added and picked.") : t("Added to the {product} colour tables.", { product: t(SCALE_NAME[r.palette.scale]) }) });
  };

  return (
    <div>
      <label className="block">
        <span className="label">{t("Colour table")}</span>
        <select
          value={chosen}
          onChange={(e) => {
            choose(scaleId, e.target.value || null);
            setNote(null);
          }}
          className="mt-1 h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 text-[12px] text-ink outline-none focus:border-accent"
        >
          <option value="">{t("Standard")}</option>
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {BUILTIN.has(p.id) ? t(p.name) : p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        <button type="button" onClick={() => file.current?.click()} className="text-[11px] text-accent hover:underline">
          {t("Import a GRLevelX palette (.pal)")}
        </button>
        {removable && (
          <button
            type="button"
            onClick={() => {
              remove(chosen);
              setNote(null);
            }}
            className="text-[11px] text-ink-3 hover:text-ink"
          >
            {t("Remove this palette")}
          </button>
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept=".pal,.txt,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void load(f);
        }}
      />
      {note && (
        <p role="status" className={cn("mt-1 text-[11px]", note.ok ? "text-ink-3" : "text-caution")}>
          {note.text}
        </p>
      )}
    </div>
  );
}
