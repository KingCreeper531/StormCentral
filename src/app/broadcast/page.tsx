import type { Metadata } from "next";
import { BroadcastPage } from "@/components/broadcast/broadcast-page";

export const metadata: Metadata = {
  title: "Broadcast mode",
  robots: { index: false },
};

/** Broadcast mode, on its own page: the radar full screen with on-air graphics. */
export default function Broadcast() {
  return <BroadcastPage />;
}
