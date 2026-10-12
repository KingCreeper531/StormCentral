"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { COMPARE_SOURCES, type CompareSourceId } from "@/lib/compare-sources";
import { fetchGoogleWeather, GoogleKeyError } from "@/lib/google-weather";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";

const FIELD =
  "h-9 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong pointer-coarse:h-11";

function SourceSelect({ label, value, other, onChange }: { label: string; value: CompareSourceId; other: CompareSourceId; onChange: (v: CompareSourceId) => void }) {
  return (
    <label className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-ink">{label}</span>
      <select className={cn(FIELD, "sm:w-80")} value={value} onChange={(e) => onChange(e.target.value as CompareSourceId)}>
        {COMPARE_SOURCES.map((s) => (
          <option key={s.id} value={s.id} disabled={s.id === other}>
            {s.label}
            {"region" in s ? ` (${s.region} only)` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Settings → General: the two forecasts the comparison panel shows, and the person's own Google key. */
export function CompareSettings() {
  const pair = useAppStore((s) => s.compare);
  const setCompare = useAppStore((s) => s.setCompare);
  const savedKey = useAppStore((s) => s.googleKey);
  const setGoogleKey = useAppStore((s) => s.setGoogleKey);
  const location = useAppStore((s) => s.location);
  const [draft, setDraft] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false });
  const key = draft ?? savedKey;
  const usesGoogle = pair.a === "google" || pair.b === "google";

  const save = async () => {
    const k = key.trim();
    setTest({ busy: true });
    try {
      await fetchGoogleWeather(k, location.lat, location.lon);
      setGoogleKey(k);
      setDraft(null);
      setTest({ busy: false, ok: true, text: "Key works. Google's forecast now shows in the comparison." });
    } catch (err) {
      setTest({ busy: false, ok: false, text: err instanceof GoogleKeyError ? err.message : `Couldn't reach Google: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  return (
    <Panel title="Forecast comparison" subtitle="The two forecasts the Daily page lines up">
      <SourceSelect label="Compare" value={pair.a} other={pair.b} onChange={(a) => setCompare({ a })} />
      <SourceSelect label="With" value={pair.b} other={pair.a} onChange={(b) => setCompare({ b })} />

      <div className="mt-3 border-t border-line pt-3">
        <p className="text-sm text-ink">Your Google Weather API key</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
          {usesGoogle ? "Needed for Google's forecast. " : "Only needed if you pick Google above. "}
          It stays on this device and goes straight to Google, so it uses your own free allowance (10,000 calls a month). In{" "}
          <a href="https://console.cloud.google.com/apis/library/weather.googleapis.com" target="_blank" rel="noreferrer" className="text-ink-2 underline underline-offset-2">
            Google Cloud
          </a>
          , enable the Weather API, then create a key under APIs &amp; Services → Credentials.
        </p>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) void save();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <input
              type={show ? "text" : "password"}
              value={key}
              onChange={(e) => {
                setDraft(e.target.value);
                setTest({ busy: false });
              }}
              placeholder="AIza…"
              aria-label="Google Weather API key"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={cn(FIELD, "pr-10")}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide key" : "Show key"}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-3 hover:text-ink"
            >
              {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
            </button>
          </div>
          <Button type="submit" variant="primary" disabled={test.busy || !key.trim() || (draft === null && !!savedKey && test.ok)}>
            {test.busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {savedKey && draft === null ? "Test" : "Save"}
          </Button>
          {savedKey && (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setGoogleKey("");
                setDraft(null);
                setTest({ busy: false });
              }}
            >
              Remove
            </Button>
          )}
        </form>
        {test.text && (
          <p role="status" className={cn("mt-2 text-xs", test.ok ? "text-ink-2" : "text-nogo")}>
            {test.text}
          </p>
        )}
      </div>
    </Panel>
  );
}
