"use client";

import { Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { desktopBridge } from "@/lib/native/desktop";
import { GITHUB_REPO, isNativeApp } from "@/lib/platform";
import { buttonClass, IconButton } from "../ui/button";

const KEY = "stormcentral:open-in-app-dismissed";
const PACKAGE = "io.github.kingcreeper531.stormcentral";
const RELEASES = `https://github.com/${GITHUB_REPO}/releases/latest`;

type Target = "android" | "windows";

/**
 * Website only (not inside the apps): on Android and Windows browsers, offers
 * to open the installed app, or download it. Android also opens the app
 * straight from links via App Links (assetlinks.json); this covers typing the
 * address. Dismissing hides it for 30 days.
 */
export function OpenInApp() {
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    if (isNativeApp() || desktopBridge()) return;
    try {
      const until = Number(localStorage.getItem(KEY) ?? 0);
      if (until > Date.now()) return;
    } catch {
      /* storage blocked: show it */
    }
    const ua = navigator.userAgent;
    const t: Target | null = /Android/i.test(ua) ? "android" : /Windows NT/i.test(ua) ? "windows" : null;
    // Decided after mount so server markup and first render match.
    const id = requestAnimationFrame(() => setTarget(t));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!target) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now() + 30 * 86_400_000));
    } catch {
      /* ignore */
    }
    setTarget(null);
  };
  // Android: the intent opens the app, or falls back to the download page when it isn't installed.
  const open =
    target === "android"
      ? `intent://${location.host}${location.pathname}#Intent;scheme=https;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(RELEASES)};end`
      : "stormcentral://open";

  return (
    <div
      role="region"
      aria-label="StormCentral app"
      className="surface fixed inset-x-4 bottom-[calc(var(--tabbar-h)_+_12px)] z-50 flex items-center gap-3 py-2 pr-2 pl-3 md:inset-x-auto md:right-6 md:bottom-6 md:w-[420px]"
    >
      <Smartphone className="size-4 shrink-0 text-ink-3" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] text-ink-2">
        <span className="font-medium text-ink">StormCentral app</span> adds warning notifications{target === "android" ? " and a widget" : " and a tray icon"}.
      </p>
      <a href={open} className={buttonClass("primary", "sm")}>
        Open
      </a>
      <a href={RELEASES} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
        Get it
      </a>
      <IconButton label="Dismiss" size="sm" onClick={dismiss}>
        <X className="size-4" aria-hidden />
      </IconButton>
    </div>
  );
}
