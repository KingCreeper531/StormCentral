"use client";

import { useEffect } from "react";
import { useMapStyleStore } from "@/store/map-style-store";

/** Opening a shared link (`?mapstyle=…`): use the style, save it, and tidy the address. */
export function useMapStyleLink() {
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const code = sp.get("mapstyle");
    if (!code) return;
    useMapStyleStore.getState().importCode(code);
    sp.delete("mapstyle");
    const q = sp.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`);
  }, []);
}
