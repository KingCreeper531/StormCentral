import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { T } from "@/components/ui/t";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm text-center">
        <p className="font-mono text-xs text-ink-3">404</p>
        <h1 className="mt-2 text-xl font-semibold text-ink sm:text-2xl">
          <T>Page not found</T>
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          <T>The page you’re looking for doesn’t exist.</T>
        </p>
        <Link href="/" className={buttonClass("primary", "md", "mt-6")}>
          <T>Back to Storm Central</T>
        </Link>
      </div>
    </main>
  );
}
