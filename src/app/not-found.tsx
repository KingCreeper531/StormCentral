import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <p className="text-[11px] font-medium tracking-[0.14em] text-ink-3 uppercase">404</p>
        <h1 className="mt-2 text-3xl font-semibold">Nothing on radar here</h1>
        <p className="mt-2 text-sm text-ink-2">That page drifted off the scope.</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-white px-5 py-2 text-sm font-semibold text-black">
          Back to StormCentral
        </Link>
      </div>
    </main>
  );
}
