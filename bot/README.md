# Storm Central X bot

Posts live severe weather to the Storm Central account on X, from the same
National Weather Service data the app uses. It runs in GitHub Actions every 5
minutes (`.github/workflows/x-bot.yml`); nothing to host.

## What it posts

Most important first, each once when issued, and once more if upgraded:

| Priority | Posts |
|---|---|
| 1 | Tornado emergencies, flash flood emergencies, particularly dangerous tornado warnings |
| 2 | Tornado warnings, extreme wind warnings |
| 3 | Destructive severe thunderstorm warnings (or with a tornado possible, hail 2 in or larger, wind 80 mph or more); tornado watches |
| 4 | Severe thunderstorm watches |

Example:

```
TORNADO WARNING for Cleveland and McClain, OK until 5:15 PM CDT.
Tornado observed. Hail up to 1.75 in.
Take shelter now if you are in the warned area.
#okwx
https://storm-central-pi.vercel.app/?mode=severe&lat=35.280&lon=-97.480
```

The link opens Storm Central's radar centred on the storm. Warnings more than
20 minutes old (watches: 60) are never posted, and the first run only notes
what's already in effect instead of posting a backlog.

**Limits.** At most 16 posts a day by default (about 500 a month, X's free API
tier) and 4 per run; emergencies are always posted. Change the daily limit
with the repository variable `BOT_DAILY_LIMIT` if your X plan allows more.

## Set up

1. **X developer app.** Sign in to <https://developer.x.com> with the Storm
   Central account, create a Project and an App (the free tier is enough).
2. In the app's **User authentication settings**, set **App permissions** to
   **Read and write** (type: Web App, Automated App or Bot; any callback URL,
   e.g. `https://storm-central-pi.vercel.app`, and the same as the website).
   Do this *before* the next step, or the tokens can only read.
3. In **Keys and tokens**, copy the **API Key and Secret**, then generate the
   **Access Token and Secret** (they must say "Read and Write").
4. In this repository on GitHub: **Settings → Secrets and variables →
   Actions → New repository secret**, add `X_API_KEY`, `X_API_SECRET`,
   `X_ACCESS_TOKEN` and `X_ACCESS_SECRET`.
5. **Try it:** **Actions → X weather bot → Run workflow** (dry run ticked)
   prints what it would post right now, without posting.
6. **Switch it on:** **Settings → Secrets and variables → Actions →
   Variables → New repository variable** `BOT_ENABLED` = `true`. From then
   on it checks every 5 minutes. To pause it, set it to `false`.

Also on X: **Settings → Your account → Account information → Automation**
adds the "Automated" label X asks bot accounts to show.

## Notes

- GitHub can delay scheduled runs by a few minutes when it's busy, and it
  pauses schedules in repositories with no activity for 60 days (a commit or
  a manual run wakes them).
- What was posted is remembered in the Actions cache (`bot/.state`), so
  nothing is posted twice across runs.
- Code: `select.ts` (what to post and the wording, tested in
  `select.test.ts`), `x-client.ts` (signed posting), `main.ts` (one run).
