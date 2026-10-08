/**
 * Layout constants shared by the fixed chrome and the page shells, so the
 * top bar, the content column and the tab bar line up on every breakpoint.
 */

/** Side gutter: 16 px on phones, 24 px from sm, and never under a landscape notch. */
export const GUTTER =
  "pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]";

/** Vertical padding that clears the fixed top bar and (on phones) the bottom tab bar. */
export const PAGE_PAD =
  "pt-[calc(var(--topbar-h)_+_16px)] pb-[calc(var(--tabbar-h)_+_24px)] sm:pt-[calc(var(--topbar-h)_+_24px)] md:pb-10";
