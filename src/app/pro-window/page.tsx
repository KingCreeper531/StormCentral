import type { Metadata } from "next";
import { ProWindow } from "@/components/pro/pro-window";

export const metadata: Metadata = {
  title: "Professional mode panel",
  robots: { index: false },
};

/** A Professional-mode panel popped out of the workspace onto another monitor. */
export default function ProWindowPage() {
  return <ProWindow />;
}
