# Storm Central YouTube Shorts

GitHub Actions makes vertical videos from live NOAA data and uploads them
to the Storm Central YouTube channel. Nothing runs on your PC.

| Short | When | Playlist |
|---|---|---|
| **Severe weather outlook**: the US map with SPC's risk areas, a zoom into the highest risk, the tornado, wind and hail odds, and SPC's summary | Every morning, once SPC's 13Z Day 1 outlook is out (about 8:15 AM Central) | Daily Severe Weather Outlook |
| **Storm report recap**: the day's tornado, wind and hail reports popping up on the map in time order, the totals, then the biggest hail, strongest gust and tornado states | 10:15 PM Central (9:15 PM in winter), on active days only: at least one tornado report or 15 severe reports | Storm Reports |
| **Week ahead**: SPC's outlook for each of the next eight days, then the most active day | Sunday mornings | Severe Weather: Week Ahead |
| **Hurricane update**: the National Hurricane Center's cone, track and forecast, with winds, pressure and movement | Every day at 11:40 AM Eastern, one per named storm (up to 2, strongest first); none when the tropics are quiet | Tropical Updates |
| **Wildfire update**: the large active fires on the US map, then a zoom to the most significant one with its mapped perimeter, acres burned, containment, and how much it grew since the day before | Every day at 4:30 PM Eastern, when a fire is at least 5,000 acres and no more than 80% contained, or grew 1,000+ acres in a day; none otherwise | Wildfire Updates |
| **Breaking news**: a Tornado Emergency, Flash Flood Emergency, Extreme Wind Warning, PDS tornado warning or watch, or SPC High Risk, with the polygon over radar, the counties, the end time, the damage tags and what to do | Within about 10 to 20 minutes of the NWS issuing it (checked every 10 minutes), at most 2 a day | Breaking Severe Weather |
| **Radar School** (a full-length 16:9 video, not a Short): a lesson on reading weather radar, in chapters, with real storms from NOAA's NEXRAD archive (Moore 2013, Mayfield 2021, Rolling Fork 2023, the 2020 Iowa derecho) and labelled simulated examples, YouTube chapters and a thumbnail | Wednesdays 1:20 PM Eastern, one lesson a week while there's one scheduled | Radar School |

Every video ends with stormcentralwx.com. Each upload has a Spanish title
and description as a YouTube translation, so viewers with Spanish set get
those. There's no music; add a sound in the YouTube app if you want one.

## Set up the YouTube API (once, about 15 minutes)

You need a Google Cloud project with the YouTube Data API, an OAuth client,
and a refresh token for the Storm Central channel. All free.

### 1. Google Cloud project

1. Go to <https://console.cloud.google.com> and sign in with the Google
   account that owns the Storm Central channel.
2. Top bar: **Select a project → New project**, name it `Storm Central`,
   **Create**, then select it.
3. **APIs & Services → Library**, search **YouTube Data API v3**, open it,
   **Enable**.

### 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen** (it may be called **Google
   Auth Platform**). **Get started**.
2. App name `Storm Central`, your email as the support and contact email,
   audience **External**. Create.
3. Under **Audience**, click **Publish app** so it's **In production**.
   This matters: while it's in "Testing", Google expires the token after 7
   days and the uploads stop. You don't need Google's verification for your
   own channel.

### 3. OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   (or **Clients → Create client**).
2. Application type **Web application**, name `Storm Central Shorts`.
3. Under **Authorized redirect URIs**, add exactly:
   `https://developers.google.com/oauthplayground`
4. **Create**. Copy the **Client ID** and **Client secret**.

### 4. Refresh token (OAuth Playground)

1. Open <https://developers.google.com/oauthplayground>.
2. Click the **gear icon** (top right), tick **Use your own OAuth
   credentials**, and paste the Client ID and Client secret.
3. On the left, in **Input your own scopes**, type
   `https://www.googleapis.com/auth/youtube` and click **Authorize APIs**.
   (This scope covers uploads and playlists. A token made with only
   `youtube.upload` still uploads, but can't add videos to playlists; the
   run then shows a warning.)
4. Sign in. If it asks which channel, pick **Storm Central**. Google warns
   "Google hasn't verified this app": click **Advanced → Go to Storm
   Central (unsafe)**. It's your own app. Allow.
5. Back in the Playground, click **Exchange authorization code for
   tokens**. Copy the **Refresh token**.

### 5. GitHub secrets

In this repository on GitHub: **Settings → Secrets and variables → Actions
→ New repository secret**, add:

| Secret | Value |
|---|---|
| `YT_CLIENT_ID` | the Client ID |
| `YT_CLIENT_SECRET` | the Client secret |
| `YT_REFRESH_TOKEN` | the refresh token |

### 6. Try it

**Actions → YouTube Shorts → Run workflow.**

- Pick the **kind** (outlook, recap, weekly or tropical).
- With **Upload** unticked, it renders it from the latest data. Download
  the video from the run's **Artifacts** to check it.
- With **Upload** ticked, it also uploads it.

### 7. Switch it on

**Settings → Secrets and variables → Actions → Variables → New repository
variable**: `SHORTS_ENABLED` = `true`. From then on each kind runs on its
schedule (the table at the top) and posts at most once a day. The day is
Eastern time, ending at 4 AM, so a run GitHub starts hours late (even past
midnight UTC) still counts for the day it was meant for.

## Private until Google's audit

YouTube makes videos uploaded through a new API project **private** until
the project passes a free audit. Until then, each Short arrives as
private: in the YouTube Studio app, open it and set it to **Public**.

To lift that, fill in the YouTube API Services audit form:
<https://support.google.com/youtube/contact/yt_api_form>. Say it uploads
a few automated weather videos a day to your own channel. Approval
usually takes a few weeks.

## Settings (repository variables)

| Variable | Default | |
|---|---|---|
| `SHORTS_ENABLED` | unset | `true` to post on schedule |
| `SHORTS_PRIVACY` | `public` | `public`, `unlisted` or `private` |
| `SHORTS_KINDS` | all | only these kinds on schedule, e.g. `outlook,recap` |
| `SHORTS_SKIP_QUIET` | `false` | `true` for no outlook video on days with no severe risk |
| `SHORTS_TROPICAL_MAX` | `2` | at most this many hurricane updates a day |
| `SHORTS_FIRE_MAX` | `1` | at most this many wildfire updates a day |
| `SHORTS_BREAKING_DAILY_MAX` | `2` | at most this many breaking-news Shorts a day |
| `SHORTS_VOICE` | `true` | `false` turns off the narrator (Andrew, via edge-tts; no key needed) |
| `SHORTS_VOICE_NAME` | `en-US-AndrewNeural` | another Microsoft neural voice for the narrator |
| `SHORTS_PLAYLISTS` | `true` | `false` to leave videos out of playlists |
| `SHORTS_AI` | `true` | `false` for the plain narration (AI narration, below) |
| `SHORTS_AI_MODEL` | `gemma3:12b` | the Ollama model that writes it (and drafts Radar School lessons) |
| `REVIEW_MODEL` | `qwen3:8b` | the second model that reviews every line of a Radar School draft |

## Livelier narration with AI

The narrator's plain script is filled in from the data ("The tornado
threat peaks at 10 percent."). With AI narration (on by default), a language
model rewrites each line the way an upbeat TV meteorologist would say it,
using only that line's facts. It runs in [Ollama](https://ollama.com) on
the GitHub runner itself: free, no API key, no GPU, about 3 to 5 extra
minutes per run.

Every rewritten line is checked against the data before it's used: its
numbers, places, days, risk level, hazards, times of day and directions
must all come from the facts, a "no" or "not" has to stay (and can't be
added), and alarm words ("outbreak", "deadly", "baseball-size") and advice
("take cover") are only allowed when the source says them. A line that
fails, or runs too long for its scene, is read the plain way instead; if
Ollama can't start, the whole plain script is read. The run's log shows
every line the model wrote and why any was turned down.

- **Try it:** Run workflow (**AI narration** is ticked). The artifact has
  the Short plus `<kind>-plain.mp4`, the same video with the plain
  narration, to compare.
- **Turn it off:** repository variable `SHORTS_AI` = `false`.
- **Another model:** `SHORTS_AI_MODEL`, any Ollama model that fits in the
  runner's 16 GB. The default, Gemma 3 12B, sounded the most natural in tests; Gemma 4 12B is more literal but flatter.

## Radar School

A weekly full-length lesson (`kinds/lesson.ts`, drawn by `lesson.html`), about 6 minutes at 1920x1080, with chapters in the description and its own thumbnail (set on YouTube when the channel is verified for custom thumbnails).

- **Real radar**: `radar-archive.ts` downloads a historic storm's Level II volume from NOAA's archive on AWS, decodes reflectivity, velocity and CC with the app's own decoder, and finds the debris signature and velocity couplet in the data so the rings land on them. Each real storm has a simulated stand-in in case the archive can't be reached.
- **Simulated examples** (`radar-sim.js`) show what's hard to find in the archive (ground clutter, the bright band, bugs) and are always labelled.
- **New lessons** come from **Actions → Draft a Radar School lesson**, which also runs by itself on Sundays, taking the next topic in `shorts/lessons/topics.txt`:
  1. It reads Wikipedia and NOAA's JetStream pages on the topic.
  2. The local model writes the lesson from that text, quoting a source for every factual line.
  3. Each quote must appear in a source word for word and carry the line's numbers, and a second model (`REVIEW_MODEL`) has to agree each line is supported. Lines that fail are dropped.
  4. A draft that passes every gate (enough lines kept, few dropped, safety advice only from NOAA/NWS, full length) is committed to `main` and scheduled for the next free Wednesday. One that doesn't becomes a pull request with its review report, and doesn't post.
- The hand-written lessons are read as written; the narrator's AI rewrite is off for them.

## Breaking news

`.github/workflows/youtube-breaking.yml` checks every 10 minutes for:

- a **Tornado Emergency** or a **PDS Tornado Warning** (the NWS's "catastrophic"
  or "considerable" tornado damage threat, or the words in the text),
- a **Flash Flood Emergency**,
- an **Extreme Wind Warning**,
- a **PDS Tornado Watch** (SPC's PDS flag, via the Iowa Environmental Mesonet,
  or the words in the watch),
- a **High Risk** on SPC's Day 1 outlook.

Each check is a few seconds with no browser. Only a new event installs the
renderer and makes the Short. Each warning posts once, and again only if it's
upgraded (a PDS warning that becomes an emergency); one ending within 20
minutes is skipped. The narrator reads the NWS's own facts in fixed sentences
(the AI narrator stays off for these), and every description says it's not an
official warning source.

- **On/off:** it runs with the other Shorts (`SHORTS_ENABLED`). To switch it
  off on its own, set `SHORTS_KINDS` to the kinds you want without `breaking`
  (e.g. `outlook,recap,weekly,tropical,fire`).
- **Daily cap:** `SHORTS_BREAKING_DAILY_MAX` (default `2`). YouTube's quota
  allows about 6 uploads a day across all the Shorts.
- **Try it:** Run workflow → YouTube Breaking Shorts with a **fixture**
  (tornado-emergency, pds-watch or high-risk) to render a saved scenario
  (never uploaded), or with none to make whatever qualifies right now.
- **On time:** GitHub runs a 10-minute schedule late or skips runs when it's
  busy, so for breaking news an outside scheduler is worth it: a cron-job.org
  job every 10 minutes posting to
  `https://api.github.com/repos/KingCreeper531/StormCentral/actions/workflows/youtube-breaking.yml/dispatches`
  with body `{"ref":"main","inputs":{"scheduled":"true"}}` (same token and
  headers as below).

## A reliable schedule (cron-job.org)

GitHub often starts scheduled runs late or drops them. For posts on time, let a free outside scheduler start the workflows instead (the GitHub schedules stay as a backup; each kind still posts once a day, and each breaking event once).

**Let GitHub set it up** (the "Set up cron-job.org" workflow creates or updates one job per Short, plus breaking news every 10 minutes, offset 5 minutes from GitHub's own run):

1. cron-job.org → **Settings → API**: create an API key, with no IP restriction (GitHub's runners change address). Save it as the repository secret `CRONJOB_API_KEY`.
2. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate: only this repository, permission **Actions: Read and write**. Save it as the repository secret `SHORTS_DISPATCH_TOKEN` (cron-job.org sends it to start the workflows).
3. **Actions → Set up cron-job.org → Run workflow.** Run it again whenever the times in `shorts/cron-job-org.ts` change; it updates the jobs it made instead of adding more.

**Or by hand:** with that token, add a job per kind at cron-job.org: `POST https://api.github.com/repos/KingCreeper531/StormCentral/actions/workflows/youtube-shorts.yml/dispatches`, headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, body `{"ref":"main","inputs":{"kind":"recap","scheduled":"true"}}`, in your own time zone (daylight saving is then handled for you).

| Kind | Time (Eastern) |
|---|---|
| outlook | 9:12 AM daily |
| tropical | 11:40 AM daily |
| fire | 4:30 PM daily |
| weekly | 9:40 AM Sundays |
| recap | 11:15 PM daily |
| breaking | every 10 minutes (`youtube-breaking.yml`, body `{"ref":"main","inputs":{"scheduled":"true"}}`) |

## Notes

- YouTube's free quota (10,000 units a day) allows about 6 uploads a day.
  A busy day is the outlook, the recap and two hurricane updates (plus the
  week ahead on Sundays): 4 or 5, which leaves room for the 2 breaking-news
  Shorts a day at most. On a big outbreak day with hurricanes too, lower
  `SHORTS_BREAKING_DAILY_MAX` or `SHORTS_TROPICAL_MAX`.
- GitHub can start scheduled runs a few minutes late, and pauses schedules
  in a repository with no activity for 60 days (any commit wakes them).
- Code: `main.ts` (one run: make a kind's videos, render, upload),
  `kinds/` (each kind: fetch its data, decide whether to post, write the
  English and Spanish text; tested in `kinds/kinds.test.ts` and
  `kinds/breaking.test.ts`), `breaking-check.ts` (the breaking-news quick
  look), `fixtures/breaking/` (saved scenarios for tests and trial runs),
  `meta.ts` (shared text and the outlook's; tested in `meta.test.ts`), the
  pages that draw each Short (`outlook.html`, `recap.html`, `weekly.html`,
  `tropical.html`, `fire.html`, `breaking.html`, on `common.js`), `render.ts` (Chromium draws a page
  frame by frame into ffmpeg), `youtube.ts` (OAuth, the upload, playlists),
  `vendor/` (maps, fonts and libraries; see its README).
- Try it locally: `npx esbuild shorts/main.ts --bundle --platform=node
  --format=esm --external:playwright-core --outfile=shorts/out/shorts.mjs`
  then `SHORTS_KIND=recap SHORTS_LATEST=1 node shorts/out/shorts.mjs`
  (needs ffmpeg and `npx playwright-core install chromium`). Add
  `SHORTS_SAVE=some/folder` to keep the data it fetched, and
  `SHORTS_FIXTURES=some/folder` to render from it again offline.
