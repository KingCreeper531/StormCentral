"use client";

import { Play, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { BASICS, GLOSSARY, HOW_TOS, matchesQuery, PRODUCT_GUIDE, productNeeds, TOOL_GUIDE, type GuideTopic } from "@/lib/pro/guide";
import { PRO_PRODUCT_IDS, PRO_PRODUCTS, type ProGroup } from "@/lib/pro/products";
import { Button } from "../ui/button";
import { Tabs } from "../ui/tabs";
import { TOOLS } from "./toolbar";

type Section = "start" | "products" | "tools" | "howto" | "glossary";
const GROUPS: ProGroup[] = ["Radar (site)", "Radar (volume)", "Radar (national)", "Radar (other countries)", "Satellite"];

function Topic({ topic, steps }: { topic: GuideTopic; steps?: readonly string[] }) {
  const t = useT();
  return (
    <div className="space-y-2 pt-1.5 text-[12px] leading-relaxed text-ink-2">
      <p>{t(topic.what)}</p>
      {steps && (
        <div>
          <p className="text-[11px] font-semibold text-ink-3">{t("How to use it")}</p>
          <ol className="mt-0.5 list-decimal space-y-0.5 pl-4">
            {steps.map((s) => (
              <li key={s}>{t(s)}</li>
            ))}
          </ol>
        </div>
      )}
      {topic.read && (
        <div>
          <p className="text-[11px] font-semibold text-ink-3">{t("How to read it")}</p>
          <p>{t(topic.read)}</p>
        </div>
      )}
      {topic.look && (
        <div>
          <p className="text-[11px] font-semibold text-ink-3">{t("Look for")}</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
            {topic.look.map((s) => (
              <li key={s}>{t(s)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One collapsible entry. */
function Entry({ title, badge, open, children }: { title: React.ReactNode; badge?: string | null; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group border-b border-line py-1.5 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[12.5px] font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span className="text-ink-3 transition-transform group-open:rotate-90" aria-hidden>
          ›
        </span>
        <span className="min-w-0 flex-1">{title}</span>
        {badge && <span className="shrink-0 rounded-sm bg-surface-3 px-1 text-[10px] text-ink-3">{badge}</span>}
      </summary>
      {children}
    </details>
  );
}

/**
 * The guide's reference, in the side panel: the basics, every product and
 * tool (what it shows, how to read it, what to look for), how-tos and a
 * glossary, with a search over all of it. Optional: it only opens from the
 * toolbar's Guide button, and the button itself can be hidden.
 */
export function GuidePanel({ onTour, onHide }: { onTour: () => void; onHide: () => void }) {
  const t = useT();
  const [section, setSection] = useState<Section>("start");
  const [query, setQuery] = useState("");
  const q = query.trim();
  const tools = TOOLS.map((x) => x.id);

  const products = useMemo(
    () =>
      PRO_PRODUCT_IDS.filter((id) => {
        const g = PRODUCT_GUIDE[id];
        return matchesQuery(q, PRO_PRODUCTS[id].short, t(PRO_PRODUCTS[id].label), t(g.what), g.read ? t(g.read) : "", ...(g.look ?? []).map((s) => t(s)));
      }),
    [q, t],
  );
  const toolHits = tools.filter((id) => {
    const g = TOOL_GUIDE[id];
    const label = TOOLS.find((x) => x.id === id)!.label;
    return matchesQuery(q, t(label), t(g.what), ...g.steps.map((s) => t(s)), g.read ? t(g.read) : "", ...(g.look ?? []).map((s) => t(s)));
  });
  const howtos = HOW_TOS.filter((h) => (h.id !== "warngen" || tools.includes("warngen")) && matchesQuery(q, t(h.title), ...h.steps.map((s) => t(s))));
  const terms = GLOSSARY.filter((g) => matchesQuery(q, t(g.term), g.term, t(g.meaning))).sort((a, b) => t(a.term).localeCompare(t(b.term)));
  const basics = BASICS.filter((b) => matchesQuery(q, t(b.title), t(b.body)));

  const need = (id: (typeof PRO_PRODUCT_IDS)[number]) => {
    const n = productNeeds(id);
    return n === "desktop" ? t("Desktop only") : n === "server" ? t("Needs the Pro data server") : null;
  };

  const productList = (ids: typeof products) =>
    GROUPS.map((g) => {
      const inGroup = ids.filter((id) => PRO_PRODUCTS[id].group === g);
      if (!inGroup.length) return null;
      return (
        <section key={g} className="pt-2">
          <h3 className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{t(g)}</h3>
          {inGroup.map((id) => (
            <Entry
              key={id}
              badge={need(id)}
              open={!!q && ids.length <= 3}
              title={
                <>
                  <span className="mr-1.5 font-mono text-[11px] text-ink-3">{PRO_PRODUCTS[id].short}</span>
                  {t(PRO_PRODUCTS[id].label)}
                </>
              }
            >
              <Topic topic={PRODUCT_GUIDE[id]} />
            </Entry>
          ))}
        </section>
      );
    });
  const toolList = (ids: typeof toolHits) =>
    ids.map((id) => {
      const def = TOOLS.find((x) => x.id === id)!;
      return (
        <Entry
          key={id}
          open={!!q && ids.length <= 2}
          title={
            <span className="flex items-center gap-1.5">
              <def.Icon className="size-3.5 text-ink-3" aria-hidden />
              {t(def.label)}
            </span>
          }
        >
          <Topic topic={TOOL_GUIDE[id]} steps={TOOL_GUIDE[id].steps} />
        </Entry>
      );
    });
  const howtoList = (list: typeof howtos) =>
    list.map((h) => (
      <Entry key={h.id} title={t(h.title)} open={!!q && list.length <= 2}>
        <ol className="list-decimal space-y-0.5 pt-1.5 pl-4 text-[12px] leading-relaxed text-ink-2">
          {h.steps.map((s) => (
            <li key={s}>{t(s)}</li>
          ))}
        </ol>
      </Entry>
    ));
  const termList = (list: typeof terms) => (
    <dl className="divide-y divide-line">
      {list.map((g) => (
        <div key={g.term} className="py-1.5">
          <dt className="text-[12.5px] font-medium text-ink">{t(g.term)}</dt>
          <dd className="text-[12px] leading-relaxed text-ink-2">{t(g.meaning)}</dd>
        </div>
      ))}
    </dl>
  );

  const found = basics.length + products.length + toolHits.length + howtos.length + terms.length;

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-surface-1 px-3 pt-2.5">
        <label className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface-2 px-2">
          <Search className="size-3.5 shrink-0 text-ink-3" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search the guide")}
            aria-label={t("Search the guide")}
            className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
          />
        </label>
        {!q && (
          <Tabs<Section>
            ariaLabel={t("Professional mode guide")}
            value={section}
            onChange={setSection}
            className="gap-3 overflow-x-auto"
            items={[
              { value: "start", label: t("Start") },
              { value: "products", label: t("Products") },
              { value: "tools", label: t("Tools") },
              { value: "howto", label: t("How to") },
              { value: "glossary", label: t("Glossary") },
            ]}
          />
        )}
      </div>

      <div className="flex-1 px-3 pb-3">
        {q ? (
          found ? (
            <>
              {basics.map((b) => (
                <Entry key={b.title} title={t(b.title)} open>
                  <p className="pt-1.5 text-[12px] leading-relaxed text-ink-2">{t(b.body)}</p>
                </Entry>
              ))}
              {productList(products)}
              {toolList(toolHits)}
              {howtoList(howtos)}
              {terms.length > 0 && <div className="pt-2">{termList(terms)}</div>}
            </>
          ) : (
            <p className="pt-3 text-[12px] text-ink-3">{t("Nothing in the guide matches that.")}</p>
          )
        ) : section === "start" ? (
          <div className="space-y-3 pt-3">
            <p className="text-[12.5px] leading-relaxed text-ink-2">{t("A tour of the workspace and what every product, tool and term means. It's all optional: open it whenever you like.")}</p>
            <Button size="sm" variant="primary" onClick={onTour}>
              <Play className="size-3.5" aria-hidden />
              {t("Take the tour")}
            </Button>
            <div>
              {BASICS.map((b, i) => (
                <Entry key={b.title} title={t(b.title)} open={i === 0}>
                  <p className="pt-1.5 text-[12px] leading-relaxed text-ink-2">{t(b.body)}</p>
                </Entry>
              ))}
            </div>
          </div>
        ) : section === "products" ? (
          productList(products)
        ) : section === "tools" ? (
          <div className="pt-1">{toolList(toolHits)}</div>
        ) : section === "howto" ? (
          <div className="pt-1">{howtoList(howtos)}</div>
        ) : (
          <div className="pt-1">{termList(terms)}</div>
        )}
      </div>

      <div className="border-t border-line px-3 py-2 text-[11px] text-ink-3">
        <button type="button" onClick={onHide} className="font-medium text-ink-2 underline-offset-2 hover:underline">
          {t("Hide the guide button")}
        </button>{" "}
        {t("Settings → Professional mode brings it back.")}
      </div>
    </div>
  );
}
