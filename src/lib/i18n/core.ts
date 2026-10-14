/**
 * Translation core, free of React and the DOM (notification text uses it in
 * the alert engine too).
 *
 * English is the source language and the lookup key: code says
 * `t("Rain starting in about {n} min", { n })`, and each language maps the
 * English text to its own. Anything missing falls back to English, so a new
 * string never shows blank.
 */
import { ES } from "./es";
import { localeFor, type Lang } from "./lang";

export { isLangPref, LANGS, localeFor, resolveLang, type Lang, type LangPref } from "./lang";
export type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Readonly<Record<string, string>> | null> = { en: null, es: ES };

/** Fills `{name}` placeholders. Unknown placeholders are left as they are. */
export function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** The text in `lang`, with placeholders filled. */
export function translate(lang: Lang, en: string, vars?: Vars): string {
  return fill(DICTS[lang]?.[en] ?? en, vars);
}

/** Singular or plural English form by `n` (`{n}` is filled), then translated. */
export function translatePlural(lang: Lang, n: number, one: string, other: string, vars?: Vars): string {
  return translate(lang, n === 1 ? one : other, { n, ...vars });
}

export interface Translator {
  (en: string, vars?: Vars): string;
  /** `t.plural(3, "{n} report", "{n} reports")` */
  plural(n: number, one: string, other: string, vars?: Vars): string;
  readonly lang: Lang;
  /** For Intl: "en-US" or "es-US". */
  readonly locale: string;
}

const cache = new Map<Lang, Translator>();

/** A translator bound to one language (stable per language, safe in deps arrays). */
export function translator(lang: Lang): Translator {
  const hit = cache.get(lang);
  if (hit) return hit;
  const t = ((en: string, vars?: Vars) => translate(lang, en, vars)) as Translator;
  Object.assign(t, {
    plural: (n: number, one: string, other: string, vars?: Vars) => translatePlural(lang, n, one, other, vars),
    lang,
    locale: localeFor(lang),
  });
  cache.set(lang, t);
  return t;
}
