"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Fragment, useState } from "react";
import type { Forecast } from "@/lib/api/open-meteo";
import { FORECAST_SOURCES, forecastSource, type ForecastSourceId } from "@/lib/forecast-sources";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { Button } from "../ui/button";

const FIELD =
  "h-9 min-w-0 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong pointer-coarse:h-11";

/** A translated template with React nodes in its `{placeholders}` (a link inside a sentence). */
function rich(text: string, parts: Record<string, React.ReactNode>): React.ReactNode[] {
  return text.split(/\{(\w+)\}/g).map((s, i) => (i % 2 ? <Fragment key={i}>{parts[s] ?? `{${s}}`}</Fragment> : s));
}

/** The person's own Google Weather API key: kept on this device, sent only to Google. */
function GoogleKeyForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const saved = useAppStore((s) => s.googleKey);
  const setKey = useAppStore((s) => s.setGoogleKey);
  const [draft, setDraft] = useState(saved);
  const [show, setShow] = useState(false);
  return (
    <form
      className="surface p-3 sm:p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setKey(draft);
        onDone();
      }}
    >
      <p className="text-sm font-medium text-ink">{t("Your Google Weather API key")}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
        {t("It stays on this device and goes straight to Google, so it uses your own free allowance (10,000 calls a month).")}{" "}
        {rich(t("In {link}, enable the Weather API, then create a key under APIs & Services → Credentials."), {
          link: (
            <a href="https://console.cloud.google.com/apis/library/weather.googleapis.com" target="_blank" rel="noreferrer" className="text-ink-2 underline underline-offset-2">
              Google Cloud
            </a>
          ),
        })}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <input
            type={show ? "text" : "password"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="AIza…"
            aria-label={t("Google Weather API key")}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={cn(FIELD, "w-full pr-10")}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? t("Hide key") : t("Show key")}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-3 hover:text-ink"
          >
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          {t("Save")}
        </Button>
        {saved && (
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              setKey("");
              setDraft("");
            }}
          >
            {t("Remove")}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Top of the Daily page: where the forecast comes from, for the whole app.
 * Picking Google asks for the person's own key; a source that can't serve
 * this place says so (the page shows Open-Meteo's best match instead).
 */
export function ForecastSourceBar({ f }: { f: Forecast }) {
  const t = useT();
  const source = useAppStore((s) => s.forecastSource);
  const setSource = useAppStore((s) => s.setForecastSource);
  const hasKey = useAppStore((s) => !!s.googleKey.trim());
  const [keyOpen, setKeyOpen] = useState(false);
  const showKey = source === "google" && (!hasKey || keyOpen);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
          <span className="shrink-0">{t("Forecast from")}</span>
          <select
            className={cn(FIELD, "max-w-[14rem]")}
            value={source}
            onChange={(e) => {
              setSource(e.target.value as ForecastSourceId);
              setKeyOpen(false);
            }}
            title={t(forecastSource(source).note)}
          >
            {FORECAST_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {"region" in s ? t("{label} ({region} only)", { label: t(s.label), region: t(s.region) }) : t(s.label)}
              </option>
            ))}
          </select>
        </label>
        {source === "google" && hasKey && (
          <Button size="sm" variant="ghost" onClick={() => setKeyOpen((v) => !v)} aria-expanded={keyOpen}>
            <KeyRound className="size-3.5" aria-hidden />
            {t("Key")}
          </Button>
        )}
      </div>
      {showKey && <GoogleKeyForm onDone={() => setKeyOpen(false)} />}
      {f.notice && !showKey && (
        <p role="status" className="rounded-[var(--radius-control)] border border-caution/40 bg-caution/10 px-3 py-2 text-xs text-ink-2">
          {f.notice}
        </p>
      )}
    </div>
  );
}
