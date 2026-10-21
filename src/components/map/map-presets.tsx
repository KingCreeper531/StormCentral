"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { BUILTIN_PRESETS, encodeStyle, LIMITS, matchingPreset, type MapPreset } from "@/lib/map/presets";
import { PUBLIC_APP_URL } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useMapStyleStore } from "@/store/map-style-store";
import { Button } from "../ui/button";

const INPUT = "h-8 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 text-[12px] text-ink outline-none focus:border-accent pointer-coarse:h-10";

const BUILTIN = new Set(BUILTIN_PRESETS.map((p) => p.id));

/** A link that opens the app with this style (lib/map/presets share codes). */
export const shareLink = (preset: { name: string; style: MapPreset["style"] }) => `${PUBLIC_APP_URL}/?mode=severe&mapstyle=${encodeStyle(preset.name, preset.style)}`;

/**
 * Map style presets: the built-in ones and the person's own, one tap to
 * apply; saving the current style under a name; and sharing a style as a
 * link or using one someone shared.
 */
export function MapPresets() {
  const t = useT();
  const style = useMapStyleStore((s) => s.style);
  const saved = useMapStyleStore((s) => s.presets);
  const { apply, savePreset, deletePreset, importCode } = useMapStyleStore.getState();
  const [form, setForm] = useState<"save" | "import" | "share" | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Your own preset wins over a built-in one with the same style.
  const current = matchingPreset(style, [...saved, ...BUILTIN_PRESETS]);
  const nameOf = (p: MapPreset) => (BUILTIN.has(p.id) ? t(p.name) : p.name);
  const link = shareLink({ name: current ? nameOf(current) : t("My map style"), style });

  // A pending delete is forgotten after a few seconds.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(id);
  }, [confirming]);

  const open = (f: typeof form) => {
    setForm(form === f ? null : f);
    setText(f === "save" && current && !BUILTIN.has(current.id) ? current.name : "");
    setNote(null);
  };
  const share = async () => {
    open("share");
    try {
      await navigator.clipboard.writeText(link);
      setNote({ ok: true, text: t("Link copied. Anyone who opens it gets this map style.") });
    } catch {
      setNote({ ok: true, text: t("Copy this link to share the map style.") });
    }
  };

  const chip = (p: MapPreset) => {
    const on = current?.id === p.id;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => {
          apply(p.style);
          setNote(null);
        }}
        className={cn(
          "h-7 max-w-[11rem] truncate rounded-full border px-2.5 text-[12px] pointer-coarse:h-9",
          on ? "border-accent bg-accent/15 text-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
        )}
      >
        {nameOf(p)}
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <p className="label">{t("Presets")}</p>
      <div className="flex flex-wrap gap-1.5">
        {BUILTIN_PRESETS.map((p) => (
          <span key={p.id}>{chip(p)}</span>
        ))}
        {saved.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-0.5">
            {chip(p)}
            {confirming === p.id ? (
              <button
                type="button"
                onClick={() => {
                  deletePreset(p.id);
                  setConfirming(null);
                }}
                className="h-7 rounded-full bg-nogo/15 px-2 text-[11px] font-medium text-nogo pointer-coarse:h-9"
              >
                {t("Delete")}
              </button>
            ) : (
              <button
                type="button"
                aria-label={t("Delete the preset {name}", { name: p.name })}
                onClick={() => setConfirming(p.id)}
                className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink pointer-coarse:size-9"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
        <button type="button" aria-expanded={form === "save"} onClick={() => open("save")} className="text-accent hover:underline">
          {t("Save as a preset")}
        </button>
        <button type="button" aria-expanded={form === "share"} onClick={() => void share()} className="text-accent hover:underline">
          {t("Share this style")}
        </button>
        <button type="button" aria-expanded={form === "import"} onClick={() => open("import")} className="text-accent hover:underline">
          {t("Use a shared style")}
        </button>
      </div>

      {form === "save" && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (savePreset(text)) {
              setForm(null);
              setNote({ ok: true, text: t("Saved.") });
            } else setNote({ ok: false, text: text.trim() ? t("You can keep up to {n} presets. Delete one first.", { n: LIMITS.saved }) : t("Give it a name.") });
          }}
        >
          <input autoFocus aria-label={t("Preset name")} placeholder={t("Name")} maxLength={LIMITS.name} value={text} onChange={(e) => setText(e.target.value)} className={INPUT} />
          <Button size="sm" type="submit">
            <Check className="size-3.5" aria-hidden />
            {t("Save")}
          </Button>
        </form>
      )}
      {form === "import" && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const r = importCode(text);
            if (!r) return setNote({ ok: false, text: t("That isn't a Storm Central map style link or code.") });
            setForm(null);
            setNote({ ok: true, text: r.saved ? t("Using “{name}”, saved to your presets.", { name: r.preset.name }) : t("Using “{name}”. Your presets are full, so it wasn't saved.", { name: r.preset.name }) });
          }}
        >
          <input autoFocus aria-label={t("Shared link or code")} placeholder={t("Paste a link or code")} value={text} onChange={(e) => setText(e.target.value)} className={INPUT} />
          <Button size="sm" type="submit">
            {t("Use")}
          </Button>
        </form>
      )}
      {form === "share" && (
        <input readOnly aria-label={t("Link to this map style")} value={link} onFocus={(e) => e.currentTarget.select()} className={cn(INPUT, "w-full font-mono text-[11px]")} />
      )}
      {note && (
        <p role="status" className={cn("text-[11px]", note.ok ? "text-ink-3" : "text-caution")}>
          {note.text}
        </p>
      )}
    </div>
  );
}
