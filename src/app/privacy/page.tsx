import type { Metadata } from "next";
import { SubpageShell } from "@/components/shell/subpage-shell";
import { GITHUB_REPO } from "@/lib/platform";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What StormCentral handles, why, and the control you have over it.",
};

const EFFECTIVE = "October 13, 2026";

const P = "text-sm leading-relaxed text-ink-2";
const UL = "list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2 marker:text-ink-3";
const A = "text-accent underline-offset-2 hover:underline";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

/** Plain-language privacy policy (also the Microsoft Store's privacy policy URL). */
export default function PrivacyPage() {
  const issues = `https://github.com/${GITHUB_REPO}/issues`;
  return (
    <SubpageShell width="max-w-3xl">
      <article className="surface space-y-7 p-5 sm:p-7">
        <header className="space-y-2">
          <h1 className="text-xl font-semibold text-ink sm:text-2xl">Privacy policy</h1>
          <p className="text-[13px] text-ink-3">Effective {EFFECTIVE}</p>
          <p className={P}>
            StormCentral is a free, open-source weather app for the web, Windows and Android. This policy explains what information StormCentral handles, why,
            and the control you have over it. The short version: StormCentral has no ads, no analytics and no tracking, and it doesn&apos;t sell or share your
            information.
          </p>
        </header>

        <Section title="Information that stays on your device">
          <p className={P}>Most of what you do in StormCentral never leaves your device, including:</p>
          <ul className={UL}>
            <li>Your settings and preferences, such as theme, units, layout, widget style and chosen forecast source.</li>
            <li>Your saved places and custom alerts.</li>
            <li>Your Google Weather API key, if you add one. It is stored only on your device and sent only to Google.</li>
            <li>
              Your location. When you allow it, StormCentral uses your device&apos;s location to show local weather, warnings and widgets. It isn&apos;t stored on
              our servers unless you include it in a report you choose to post.
            </li>
          </ul>
          <p className={P}>On the Windows app, everything (including any account and reports you create there) is stored on your own PC.</p>
        </Section>

        <Section title="Information sent to weather data services">
          <p className={P}>
            To show weather, StormCentral requests data from public weather services such as the U.S. National Weather Service, NOAA and Open-Meteo, and loads
            map and radar images from map providers. These requests include the coordinates of the places you view and, like any internet request, your IP
            address. StormCentral doesn&apos;t send your name, account or other personal details with them. Each service handles requests under its own privacy
            policy.
          </p>
          <p className={P}>
            On Android, StormCentral checks for weather warnings in the background so it can notify you and update widgets. These checks run on your phone and
            contact the same weather services directly; no StormCentral server is involved.
          </p>
          <p className={P}>
            If you choose Google as your forecast source, StormCentral sends the coordinates of the places you view to Google&apos;s Weather API using your own
            key, under Google&apos;s privacy policy.
          </p>
        </Section>

        <Section title="Accounts and the Spotter Network">
          <p className={P}>Creating an account is optional and only needed to post or interact with weather reports. If you create one, we store:</p>
          <ul className={UL}>
            <li>Your username, display name, email address, and optional bio and profile photo.</li>
            <li>Your password as a secure one-way hash. We never store or see your actual password.</li>
            <li>A sign-in cookie that keeps you signed in. It is used for nothing else.</li>
          </ul>
          <p className={P}>
            When you post to the Spotter Network, the following is <strong className="font-semibold text-ink">public</strong> and visible to anyone using
            StormCentral:
          </p>
          <ul className={UL}>
            <li>Your report&apos;s text, category and photo.</li>
            <li>The location and place name you attach, rounded to about 1 km unless you choose to share a precise position.</li>
            <li>The weather conditions at the time.</li>
            <li>Your comments and confirmations of other reports.</li>
            <li>Your username, display name, bio and profile photo.</li>
          </ul>
          <p className={P}>
            Photos have their hidden metadata, such as GPS location and camera details, removed when you upload them. Your email address is never shown
            publicly; it is used only to sign you in and to send password reset emails you request.
          </p>
        </Section>

        <Section title="How we use information">
          <p className={P}>
            Account information is used only to run the Spotter Network: signing you in, showing your reports and profile, and resetting your password. It
            isn&apos;t used for advertising, profiling or marketing, and it isn&apos;t sold, rented or traded.
          </p>
        </Section>

        <Section title="Service providers">
          <p className={P}>
            The StormCentral website and its database are hosted by third-party providers (currently Vercel), which store and process data only to run the
            service. Password reset emails are sent through an email delivery service. Like most web hosts, the hosting provider may keep basic technical logs,
            such as IP addresses and request times, for security and reliability.
          </p>
        </Section>

        <Section title="App updates">
          <p className={P}>
            The Windows and Android apps check GitHub Releases for new versions, and GitHub sees those requests under its own privacy policy. Copies installed
            from the Microsoft Store may be updated by the Store instead.
          </p>
        </Section>

        <Section title="Keeping and deleting your information">
          <p className={P}>
            Your account and reports are kept until you delete them. You can delete your account at any time in Settings → Account, which permanently removes
            your profile, reports, photos, comments and sign-in sessions from our servers. Information stored on your device stays until you clear it, remove it
            in Settings or uninstall the app.
          </p>
        </Section>

        <Section title="Security">
          <p className={P}>
            Connections to StormCentral use HTTPS, passwords are hashed, and sign-in cookies are restricted to the StormCentral website. No system is perfectly
            secure, but we take reasonable steps to protect your information.
          </p>
        </Section>

        <Section title="Children">
          <p className={P}>
            StormCentral isn&apos;t directed at children under 13, and we don&apos;t knowingly collect personal information from them. If you believe a child has
            created an account, contact us and we&apos;ll delete it.
          </p>
        </Section>

        <Section title="Your rights">
          <p className={P}>
            Depending on where you live, you may have rights to access, correct, export or delete your personal information. You can view and edit your profile
            and delete your account in the app at any time. For anything else, contact us using the details below.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p className={P}>
            If this policy changes, the effective date above will be updated. Significant changes will be noted in the app or on the project&apos;s release page.
          </p>
        </Section>

        <Section title="Contact">
          <p className={P}>
            Questions or requests about privacy can be sent through the project&apos;s GitHub page:{" "}
            <a href={issues} target="_blank" rel="noreferrer" className={A}>
              {issues.replace("https://", "")}
            </a>
            .
          </p>
        </Section>
      </article>
    </SubpageShell>
  );
}
