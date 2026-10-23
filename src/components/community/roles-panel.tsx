"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { getJson } from "@/lib/api/http";
import { GRANTABLE_ROLES, ROLE_LABELS, type GrantableRole, type GrantedListDto, type RoleChange, type RoleInfoDto } from "@/lib/community";
import { useT } from "@/lib/i18n/use-t";
import { Button } from "../ui/button";
import { ErrorNote, Skeleton, Toggle } from "../ui/misc";
import { Panel } from "../ui/panel";
import { errorText, sendJson } from "./moderation";

const ROLE_HELP: Record<GrantableRole, string> = {
  trusted: "The Trusted Spotter badge, whatever their confirmations.",
  warngen: "Can issue spotter warnings in WarnGen.",
  moderator: "Can review reports, suspend accounts and give roles.",
};
const LIST_KEY = ["roles", "list"] as const;
const userKey = (username: string) => ["roles", "user", username.toLowerCase()] as const;
const date = (at: number, locale: string) => new Date(at).toLocaleDateString(locale, { dateStyle: "medium" });

/** One account's roles: each one switched on or off, with built-in ones shown but fixed. */
function AccountRoles({ info }: { info: RoleInfoDto }) {
  const t = useT();
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: (c: RoleChange) => sendJson<RoleInfoDto>("/api/moderation/roles", "POST", c),
    onSuccess: (data) => {
      qc.setQueryData(userKey(data.username), data);
      return qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
  return (
    <div className="mt-4 rounded-[var(--radius-control)] border border-line p-3">
      <p className="text-[13px] font-medium text-ink">
        {info.displayName} <span className="font-normal text-ink-3">@{info.username}</span>
        {info.builtIn.developer && <span className="ml-2 rounded-[4px] border border-line px-1.5 py-px text-[11px] text-ink-2">{t("Developer")}</span>}
      </p>
      <ul className="mt-2 divide-y divide-line">
        {[...GRANTABLE_ROLES].reverse().map((role) => {
          const given = info.granted.find((g) => g.role === role);
          const builtIn = info.builtIn[role];
          return (
            <li key={role} className="py-2">
              {builtIn ? (
                <div className="flex min-h-10 items-center justify-between gap-3 text-[13px] text-ink-2">
                  <span>{t(ROLE_LABELS[role])}</span>
                  <span className="text-xs text-ink-3">{t("Built in")}</span>
                </div>
              ) : info.canChange[role] ? (
                <Toggle label={t(ROLE_LABELS[role])} checked={!!given} onChange={(on) => change.mutate({ username: info.username, role, on })} />
              ) : (
                <div className="flex min-h-10 items-center justify-between gap-3 text-[13px] text-ink-2">
                  <span>{t(ROLE_LABELS[role])}</span>
                  <span className="text-xs text-ink-3">{given ? t("Yes") : t("No")}</span>
                </div>
              )}
              <p className="text-xs text-ink-3">
                {t(ROLE_HELP[role])}
                {given && ` ${t("Given by {name} on {date}.", { name: given.by ? `@${given.by}` : t("a deleted account"), date: date(given.at, t.locale) })}`}
              </p>
            </li>
          );
        })}
      </ul>
      {change.isPending && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-3">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("Saving")}
        </p>
      )}
      {change.error && (
        <p role="alert" className="mt-2 text-xs text-nogo">
          {errorText(t, change.error.message)}
        </p>
      )}
      {!info.canChange.trusted && !info.canChange.moderator && <p className="mt-2 text-xs text-ink-3">{t("You can't change your own roles.")}</p>}
    </div>
  );
}

/**
 * The moderators' Roles panel: look up an account and give or take away
 * Trusted Spotter, WarnGen and Moderator, and see every role given in the app.
 */
export function RolesPanel() {
  const t = useT();
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState("");
  const info = useQuery({
    queryKey: userKey(lookup),
    queryFn: () => getJson<RoleInfoDto>(`/api/moderation/roles?username=${encodeURIComponent(lookup)}`),
    enabled: lookup.length > 0,
    retry: false,
  });
  const list = useQuery({ queryKey: LIST_KEY, queryFn: () => getJson<GrantedListDto>("/api/moderation/roles") });
  const remove = useMutation({
    mutationFn: (c: RoleChange) => sendJson<RoleInfoDto>("/api/moderation/roles", "POST", c),
    onSuccess: (data) => {
      qc.setQueryData(userKey(data.username), data);
      return qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });

  return (
    <Panel title={t("Roles")} subtitle={t("Give spotters a role, or take it away. Roles set in the site's settings show as built in.")}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setLookup(input.trim().replace(/^@/, ""));
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("Username")}
          aria-label={t("Username")}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={25}
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong pointer-coarse:h-11"
        />
        <Button type="submit" disabled={!input.trim()}>
          <Search className="size-4" aria-hidden />
          {t("Look up")}
        </Button>
      </form>
      {lookup && info.isLoading && <Skeleton className="mt-4 h-40" />}
      {lookup && info.error && (
        <p role="alert" className="mt-3 text-sm text-nogo">
          {errorText(t, info.error.message)}
        </p>
      )}
      {info.data && <AccountRoles key={info.data.username} info={info.data} />}

      <h3 className="mt-6 mb-1 text-[13px] font-semibold text-ink">{t("Given in the app")}</h3>
      {list.isLoading ? (
        <Skeleton className="h-16" />
      ) : list.error ? (
        <ErrorNote error={list.error} what={t("roles")} />
      ) : list.data && list.data.granted.length ? (
        <ul className="divide-y divide-line">
          {list.data.granted.map((g) => {
            const canRemove = list.data.canChange[g.role] && g.username.toLowerCase() !== list.data.you.toLowerCase();
            return (
              <li key={`${g.username}:${g.role}`} className="flex items-center gap-3 py-2">
                <ShieldCheck className="size-4 shrink-0 text-ink-3" aria-hidden />
                <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px] text-ink hover:underline" onClick={() => (setInput(g.username), setLookup(g.username))}>
                  {g.displayName} <span className="text-ink-3">@{g.username}</span>
                </button>
                <span className="shrink-0 text-xs text-ink-2">{t(ROLE_LABELS[g.role])}</span>
                {canRemove && (
                  <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate({ username: g.username, role: g.role, on: false })}>
                    {t("Remove")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">{t("No roles given in the app yet.")}</p>
      )}
      {remove.error && (
        <p role="alert" className="mt-2 text-xs text-nogo">
          {errorText(t, remove.error.message)}
        </p>
      )}
    </Panel>
  );
}
