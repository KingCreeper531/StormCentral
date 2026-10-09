"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { qk } from "@/hooks/queries";
import type { Forecast } from "@/lib/api/open-meteo";
import type { AlertsResponse } from "@/lib/api/types";
import { describeSnapshot, widgetSnapshot } from "@/lib/alerting/engine";
import { CURRENT_PLACE_ID } from "@/lib/alerting/types";
import { readShared, writeShared } from "@/lib/native/runner-bridge";
import { isNativeApp } from "@/lib/platform";
import { useAppStore } from "@/store/app-store";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";

const noSubscribe = () => () => {};

/**
 * Android only: saves the home-screen widget's data now and reads it back, so
 * a widget stuck on "Open StormCentral to set up" shows what's going wrong.
 */
export function WidgetPanel() {
  const native = useSyncExternalStore(noSubscribe, isNativeApp, () => false);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (!native) return null;

  const refresh = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { location: loc, units } = useAppStore.getState();
      const f = qc.getQueryData<Forecast>(qk.forecast(loc)) ?? null;
      const local = qc.getQueryData<AlertsResponse>(qk.localAlerts(loc))?.alerts ?? null;
      const snap = widgetSnapshot({ id: CURRENT_PLACE_ID, name: loc.name, lat: loc.lat, lon: loc.lon }, units.temp, f, local, Date.now());
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
    <Panel title="Home-screen widget" subtitle="Shows the selected location's weather and top warning">
      <Button size="sm" onClick={() => void refresh()} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
        Refresh widget
      </Button>
      {result && (
        <p role="status" className={`mt-3 text-sm ${result.ok ? "text-ink-2" : "text-nogo"}`}>
          {result.text}
        </p>
      )}
    </Panel>
  );
}
