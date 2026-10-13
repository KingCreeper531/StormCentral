"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Layers, Palette, Puzzle, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { ADDON_TOPICS, fetchAddon, MANIFEST_FILE, searchAddons } from "@/lib/addons/github";
import { FEATURED_PLUGINS, FEATURED_THEMES } from "@/lib/addons/featured";
import { AddonError, type PluginAddon, type ThemeAddon } from "@/lib/addons/manifest";
import { GITHUB_REPO } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAddonsStore, type InstalledPlugin } from "@/store/addons-store";
import { Button, IconButton } from "../ui/button";
import { Toggle } from "../ui/misc";
import { Panel } from "../ui/panel";
import { Segmented } from "../ui/segmented";

const GUIDE = `https://github.com/${GITHUB_REPO}/tree/main/examples/addons#readme`;
const errText = (e: unknown) => (e instanceof AddonError ? e.message : "Something went wrong. Try again.");

/** Four colour chips that preview a theme. */
function Swatch({ theme, className }: { theme: Pick<ThemeAddon, "colors" | "base">; className?: string }) {
  const c = theme.colors;
  const fallback = theme.base === "light" ? ["#f3f4f6", "#ffffff", "#111316", "#2563d4"] : ["#000000", "#0e0f11", "#ececed", "#5b9cf6"];
  const chips = [c.canvas ?? fallback[0], c["surface-1"] ?? fallback[1], c.ink ?? fallback[2], c.accent ?? fallback[3]];
  return (
    <span className={cn("inline-flex overflow-hidden rounded-[4px] border border-line", className)} aria-hidden>
      {chips.map((bg, i) => (
        <span key={i} className="h-5 w-3" style={{ background: bg }} />
      ))}
    </span>
  );
}

/** Appearance tab: pick a custom theme (or none). */
export function ThemePicker({ onBrowse }: { onBrowse: () => void }) {
  const themes = useAddonsStore((s) => s.themes);
  const active = useAddonsStore((s) => s.activeTheme);
  const setActive = useAddonsStore((s) => s.setActiveTheme);
  const option = (id: string | null, label: string, swatch: React.ReactNode) => (
    <button
      key={id ?? "none"}
      type="button"
      role="radio"
      aria-checked={active === id}
      onClick={() => setActive(id)}
      className={cn(
        "flex min-h-11 items-center gap-2.5 rounded-[var(--radius-control)] border px-3 py-2 text-left text-[13px] transition-colors",
        active === id ? "border-accent bg-surface-2 text-ink" : "border-line text-ink-2 hover:border-line-strong",
      )}
    >
      {swatch}
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {active === id && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
    </button>
  );
  return (
    <div>
      <div role="radiogroup" aria-label="Color theme" className="grid gap-2 sm:grid-cols-2">
        {option(null, "Storm Central", <Palette className="size-4 text-ink-3" aria-hidden />)}
        {themes.map((t) => option(t.id, t.name, <Swatch theme={t} />))}
      </div>
      <button type="button" onClick={onBrowse} className="mt-2 text-xs text-ink-2 underline-offset-2 hover:underline">
        Get themes from GitHub
      </button>
    </div>
  );
}

function InstallForm() {
  const install = useAddonsStore((s) => s.install);
  const [url, setUrl] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "busy" } | { kind: "done"; text: string } | { kind: "error"; text: string }>({ kind: "idle" });
  const submit = async (input: string) => {
    if (!input.trim()) return;
    setState({ kind: "busy" });
    try {
      const a = await fetchAddon(input);
      install(a);
      setUrl("");
      setState({ kind: "done", text: a.type === "theme" ? `Installed and switched to "${a.name}".` : `Installed "${a.name}". Its layers are on the Radar and Air maps.` });
    } catch (e) {
      setState({ kind: "error", text: errText(e) });
    }
  };
  return (
    <Panel title="Install from GitHub" subtitle={`A repository, folder or link to its ${MANIFEST_FILE}`}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(url);
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="owner/repo or github.com link"
          aria-label="GitHub link"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong pointer-coarse:h-11"
        />
        <Button type="submit" variant="primary" disabled={state.kind === "busy" || !url.trim()}>
          {state.kind === "busy" ? "Installing" : "Install"}
        </Button>
      </form>
      {(state.kind === "done" || state.kind === "error") && (
        <p role="status" className={cn("mt-2 text-sm", state.kind === "error" ? "text-nogo" : "text-ink-2")}>
          {state.text}
        </p>
      )}
      <p className="label mt-3">
        Add-ons are JSON only (colours and map layers), never code.{" "}
        <a href={GUIDE} target="_blank" rel="noreferrer" className="text-ink-2 underline-offset-2 hover:underline">
          Make your own
        </a>
      </p>
      <BrowseList onInstall={(repo) => void submit(repo)} busy={state.kind === "busy"} />
    </Panel>
  );
}

function BrowseList({ onInstall, busy }: { onInstall: (repo: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<keyof typeof ADDON_TOPICS>("theme");
  const q = useQuery({
    queryKey: ["addon-search", type],
    queryFn: ({ signal }) => searchAddons(type, signal),
    enabled: open,
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (!open) {
    return (
      <Button size="sm" className="mt-3" onClick={() => setOpen(true)}>
        <Puzzle className="size-4" aria-hidden /> Browse community add-ons
      </Button>
    );
  }
  return (
    <div className="mt-4 border-t border-line pt-4">
      <Segmented<keyof typeof ADDON_TOPICS>
        ariaLabel="Add-on type"
        size="sm"
        value={type}
        onChange={setType}
        options={[
          { value: "theme", label: "Themes" },
          { value: "plugin", label: "Plugins" },
        ]}
      />
      <p className="label mt-2">
        Public repositories tagged <span className="font-mono">{ADDON_TOPICS[type]}</span>. Community-made; check the repository before installing.
      </p>
      {q.isPending ? (
        <p className="mt-3 text-sm text-ink-3">Searching GitHub</p>
      ) : q.isError ? (
        <p className="mt-3 text-sm text-nogo">{errText(q.error)}</p>
      ) : !q.data.length ? (
        <p className="mt-3 text-sm text-ink-3">Nothing tagged yet. Be the first: add the topic to your repository.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {q.data.map((r) => (
            <li key={r.fullName} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <a href={r.url} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium text-ink hover:underline">
                  {r.fullName}
                </a>
                {r.description && <span className="block truncate text-xs text-ink-3">{r.description}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-ink-3 tabular">
                <Star className="size-3" aria-hidden /> {r.stars}
              </span>
              <Button size="sm" disabled={busy} onClick={() => onInstall(r.fullName)}>
                Install
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label="Open on GitHub" className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] text-ink-3 hover:bg-surface-2 hover:text-ink pointer-coarse:size-11">
      <ExternalLink className="size-4" aria-hidden />
    </a>
  );
}

function PluginRow({ p }: { p: InstalledPlugin }) {
  const setPlugin = useAddonsStore((s) => s.setPlugin);
  const setLayerVisible = useAddonsStore((s) => s.setLayerVisible);
  const remove = useAddonsStore((s) => s.remove);
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-2 text-ink-2">
          <Layers className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">
            {p.name}
            {p.version && <span className="font-normal text-ink-3"> {p.version}</span>}
          </span>
          <span className="block truncate text-xs text-ink-3">{p.description ?? p.layers.map((l) => l.name).join(", ")}</span>
        </span>
        <SourceLink href={p.homepage} />
        <IconButton label={`Remove ${p.name}`} size="sm" variant="danger" onClick={() => remove(p.id)}>
          <Trash2 className="size-4" aria-hidden />
        </IconButton>
      </div>
      {p.layers.length > 1 && (
        <div className="mt-2 sm:pl-11">
          <p className="label mb-1.5">Choose what it shows</p>
          <div className="flex flex-wrap gap-1.5">
            {p.layers.map((l) => {
              const on = !p.hidden.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!p.enabled}
                  onClick={() => setLayerVisible(p.id, l.id, !on)}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors disabled:opacity-40 pointer-coarse:min-h-10",
                    on ? "border-accent bg-surface-2 text-ink" : "border-line text-ink-3 hover:text-ink",
                  )}
                >
                  {on && <Check className="size-3.5 text-accent" aria-hidden />}
                  {l.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-1 grid gap-x-6 sm:grid-cols-2 sm:pl-11">
        <Toggle label="Show on maps" checked={p.enabled} onChange={(enabled) => setPlugin(p.id, { enabled })} />
        <label className="flex min-h-10 items-center gap-3 text-[13px] text-ink-2">
          <span>Opacity</span>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(p.opacity * 100)}
            onChange={(e) => setPlugin(p.id, { opacity: Number(e.target.value) / 100 })}
            disabled={!p.enabled}
            className="min-w-0 flex-1 accent-[var(--color-accent)] disabled:opacity-40"
          />
        </label>
      </div>
    </li>
  );
}

function ThemeRow({ t }: { t: ThemeAddon }) {
  const remove = useAddonsStore((s) => s.remove);
  const active = useAddonsStore((s) => s.activeTheme === t.id);
  return (
    <li className="flex items-center gap-3 py-3">
      <Swatch theme={t} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">
          {t.name}
          {active && <span className="font-normal text-accent"> · in use</span>}
        </span>
        <span className="block truncate text-xs text-ink-3">{[t.author && `by ${t.author}`, t.base === "light" ? "Light" : "Dark"].filter(Boolean).join(" · ")}</span>
      </span>
      <SourceLink href={t.homepage} />
      <IconButton label={`Remove ${t.name}`} size="sm" variant="danger" onClick={() => remove(t.id)}>
        <Trash2 className="size-4" aria-hidden />
      </IconButton>
    </li>
  );
}

/** Ready-made themes and plugins, installed with one tap (bundled, no download). */
function FeaturedPanel() {
  const install = useAddonsStore((s) => s.install);
  const setActive = useAddonsStore((s) => s.setActiveTheme);
  const themes = useAddonsStore((s) => s.themes);
  const active = useAddonsStore((s) => s.activeTheme);
  const plugins = useAddonsStore((s) => s.plugins);
  const wearTheme = (t: ThemeAddon) => (themes.some((x) => x.id === t.id) ? setActive(t.id) : install(t));
  const addPlugin = (p: PluginAddon) => install(p);
  return (
    <Panel title="Featured" subtitle="Made for Storm Central. Tap a theme to wear it; add a plugin, then choose what it shows.">
      <p className="label mb-2">Themes</p>
      <div role="radiogroup" aria-label="Featured themes" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {FEATURED_THEMES.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => (on ? setActive(null) : wearTheme(t))}
              title={t.description ?? undefined}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-2.5 py-2 text-left text-[13px] transition-colors",
                on ? "border-accent bg-surface-2 text-ink" : "border-line text-ink-2 hover:border-line-strong",
              )}
            >
              <Swatch theme={t} />
              <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
              {on && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="label mt-1.5">Tap the theme in use again to go back to Storm Central&apos;s own colours.</p>

      <p className="label mt-5 mb-1">Plugins</p>
      <ul className="divide-y divide-line">
        {FEATURED_PLUGINS.map((p) => {
          const added = plugins.some((x) => x.id === p.id);
          return (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-2 text-ink-2">
                <Layers className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink">{p.name}</span>
                <span className="block text-xs text-ink-3">{p.description}</span>
                <span className="block truncate text-[11px] text-ink-3">{p.layers.map((l) => l.name).join(" · ")}</span>
              </span>
              <Button size="sm" variant={added ? "ghost" : "secondary"} disabled={added} onClick={() => addPlugin(p)}>
                {added ? (
                  <>
                    <Check className="size-4" aria-hidden /> Added
                  </>
                ) : (
                  "Add"
                )}
              </Button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Add-ons tab: install from GitHub, manage installed themes and plugins. */
export function AddonsSection() {
  const themes = useAddonsStore((s) => s.themes);
  const plugins = useAddonsStore((s) => s.plugins);
  return (
    <div className="space-y-4">
      <FeaturedPanel />
      <Panel title="Your plugins" subtitle="Extra map layers on the Radar and Air maps">
        {plugins.length ? (
          <ul className="-my-3 divide-y divide-line">
            {plugins.map((p) => (
              <PluginRow key={p.id} p={p} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">No plugins yet. Add one from Featured above.</p>
        )}
      </Panel>
      <Panel title="Your themes" subtitle="Pick one here or under General → Appearance">
        {themes.length ? (
          <ul className="-my-3 divide-y divide-line">
            {themes.map((t) => (
              <ThemeRow key={t.id} t={t} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">No themes yet.</p>
        )}
      </Panel>
      <InstallForm />
    </div>
  );
}
