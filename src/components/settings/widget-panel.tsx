"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { qk } from "@/hooks/queries";
import type { Forecast } from "@/lib/api/open-meteo";
import { describeSnapshot } from "@/lib/alerting/engine";
import { readShared, writeShared } from "@/lib/native/runner-bridge";
import { buildWidget } from "../alerts/alert-watcher";
import { isNativeApp } from "@/lib/platform";
import { useAppStore } from "@/store/app-store";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";
import { Segmented } from "../ui/segmented";

const noSubscribe = () => () => {};

/**
 * Android only: saves the home-screen widget's data now and reads it back, so
 * a widget stuck on "Open Storm Central to set up" shows what's going wrong.
 */
export function WidgetPanel() {
  const native = useSyncExternalStore(noSubscribe, isNativeApp, () => false);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const background = useAppStore((s) => s.widgetBackground);
  const setBackground = useAppStore((s) => s.setWidgetBackground);
  if (!native) return null;

  const refresh = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { location: loc, units } = useAppStore.getState();
      const f = qc.getQueryData<Forecast>(qk.forecast(loc)) ?? null;
      const snap = buildWidget(qc, loc, units.temp);
      await writeShared({ widget: JSON.stringify(snap) });
      const back = await readShared("widget");
      if (!back) throw new Error("saved, but reading it back returned nothing");
      setResult({ ok: true, text: `Saved: ${describeSnapshot(snap)}${f ? "" : " (no forecast loaded yet, open Daily first)"}. Go to the home screen to see the widget.` });
    } catch (err) {
      setResult({ ok: false, text: `Couldn't save widget data: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Home-screen widgets" subtitle="Show the selected location's weather and top warning">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink">Background</p>
          <p className="text-xs text-ink-3">Transparent shows your wallpaper behind white text.</p>
        </div>
        <Segmented
          ariaLabel="Widget background"
          size="sm"
          value={background}
          onChange={setBackground}
          options={[
            { value: "solid", label: "Solid" },
            { value: "transparent", label: "Transparent" },
          ]}
        />
      </div>
      <Button size="sm" onClick={() => void refresh()} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
        Refresh widget
      </Button>
      {result && (
        <p role="status" className={`mt-3 text-sm ${result.ok ? "text-ink-2" : "text-nogo"}`}>
          {result.text}
        </p>
      )}
      <p className="label mt-3">
        Five styles: Weather, Clock and weather, Temperature, Hourly forecast and 5-day forecast. Long-press your home screen, tap Widgets, then Storm Central.
        They follow your theme and clock settings and update when you leave the app.
      </p>
    </Panel>
  );
}
