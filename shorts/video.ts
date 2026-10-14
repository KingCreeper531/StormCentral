/**
 * One Short to make: the page that draws it and its DATA, and what YouTube
 * shows (title, description, tags, the Spanish version, the playlist). Each
 * kind (kinds/*.ts) turns live data into zero or more of these.
 */
export interface Localized {
  title: string;
  description: string;
}

export interface Video extends Localized {
  /** For logs and file names, e.g. "outlook", "tropical-al182026". */
  key: string;
  /** The page in shorts/ that draws it, e.g. "outlook.html". */
  template: string;
  /** window.DATA for the page (render.ts adds the logo). */
  data: Record<string, unknown>;
  tags: string[];
  /** The Spanish title and description (YouTube localizations). */
  es: Localized;
  /** The playlist it goes into, by title (created when missing). */
  playlist: string;
}

export interface KindContext {
  env: Record<string, string | undefined>;
  /** A folder of saved source files to use instead of fetching (testing). */
  fixtures?: string;
  /** A folder to save the fetched source files into (to make fixtures). */
  save?: string;
}

export type Kind = (ctx: KindContext) => Promise<Video[]>;
