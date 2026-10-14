"use client";

import { ChevronDown } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { TIERS } from "@/lib/community";
import { useT } from "@/lib/i18n/use-t";

const PROSE = "text-[13px] leading-relaxed text-ink-2";

/** Sentence with one emphasized word: `{x}` in the (translated) template becomes `word`. */
function Emphasis({ template, word }: { template: string; word: string }) {
  return template.split(/(\{x\})/).map((part, i) =>
    part === "{x}" ? (
      <span key={i} className="font-medium text-ink">
        {word}
      </span>
    ) : (
      part
    ),
  );
}

function HowItWorks() {
  const t = useT();
  return (
    <p className={PROSE}>
      <Emphasis
        template={t("If you are nearby and seeing the same conditions, press {x} on a report. Confirmations raise the reporter’s rank and move reliable reports up the Top 24 h list.")}
        word={t("Confirm")}
      />
    </p>
  );
}

function Ranks() {
  const t = useT();
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="label pb-1.5 text-left font-normal">
            {t("Rank")}
          </th>
          <th scope="col" className="label pb-1.5 text-right font-normal">
            {t("Confirmations")}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {[...TIERS].reverse().map((tier) => (
          <tr key={tier.name}>
            <td className="py-1.5 text-ink">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: tier.color }} />
                {t(tier.name)}
              </span>
            </td>
            <td className="py-1.5 text-right text-ink-2 tabular">{tier.min}+</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Privacy() {
  const t = useT();
  return (
    <p className={PROSE}>
      {t(
        "Report locations are rounded to about 1 km (half a mile) unless you choose to share precise GPS. Photo metadata, including GPS, is removed on your device and again on the server.",
      )}
    </p>
  );
}

function Guidelines() {
  const t = useT();
  return (
    <div className="space-y-2">
      <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-ink-2 marker:text-ink-3">
        <li>{t("Post real weather you saw yourself. No fake or exaggerated reports.")}</li>
        <li>{t("Be respectful. No harassment, hate, threats or sexual content.")}</li>
        <li>{t("Don’t share anyone’s private information, or photos of people without their consent.")}</li>
        <li>{t("No spam or advertising.")}</li>
      </ul>
      <p className={PROSE}>
        <Emphasis
          template={t(
            "Use the {x} menu to report a post, comment or account, or to block someone. Reported content is hidden once several people report it, and moderators can remove it and suspend accounts.",
          )}
          word="⋯"
        />
      </p>
    </div>
  );
}

const ABOUT = [
  { title: "How confirmation works", Body: HowItWorks },
  { title: "Ranks", Body: Ranks },
  { title: "Community guidelines", Body: Guidelines },
  { title: "Privacy", Body: Privacy },
] as const;

/** Phones and tablets: the sidebar folds into one collapsed section above the feed. */
export function AboutDetails() {
  const t = useT();
  return (
    <details className="surface group overflow-hidden lg:hidden">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-medium text-ink select-none [&::-webkit-details-marker]:hidden">
        {t("About the spotter network")}
        <ChevronDown className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="divide-y divide-line border-t border-line">
        {ABOUT.map(({ title, Body }) => (
          <section key={title} className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">{t(title)}</h2>
            <Body />
          </section>
        ))}
      </div>
    </details>
  );
}

/** Desktop sidebar. */
export function AboutAside() {
  const t = useT();
  return (
    <aside className="hidden space-y-4 lg:block" aria-label={t("About the spotter network")}>
      {ABOUT.map(({ title, Body }) => (
        <Panel key={title} title={t(title)}>
          <Body />
        </Panel>
      ))}
    </aside>
  );
}
