import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm text-center">
        <p className="font-mono text-xs text-ink-3">404</p>
        <h1 className="mt-2 text-xl font-semibold text-ink sm:text-2xl">Page not found</h1>
        <p className="mt-2 text-sm text-ink-2">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/" className={buttonClass("primary", "md", "mt-6")}>
          Back to StormCentral
        </Link>
      </div>
    </main>
  );
}
