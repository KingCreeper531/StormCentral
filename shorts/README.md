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
schedule (the table at the top) and posts at most once a day.

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
| `SHORTS_VOICE` | `true` | `false` turns off the narrator (Andrew, via edge-tts; no key needed) |
| `SHORTS_VOICE_NAME` | `en-US-AndrewNeural` | another Microsoft neural voice for the narrator |
| `SHORTS_PLAYLISTS` | `true` | `false` to leave videos out of playlists |

## A reliable schedule (cron-job.org)

GitHub often starts scheduled runs late or drops them. For posts on time, let a free outside scheduler start the workflow instead (the GitHub schedules stay as a backup; each kind still posts once a day):

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate: only this repository, permission **Actions: Read and write**.
2. At cron-job.org, add a job per kind: `POST https://api.github.com/repos/KingCreeper531/StormCentral/actions/workflows/youtube-shorts.yml/dispatches`, headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, body `{"ref":"main","inputs":{"kind":"recap","scheduled":"true"}}`, in your own time zone (daylight saving is then handled for you).

| Kind | Time (Eastern) |
|---|---|
| outlook | 9:12 AM daily |
| tropical | 11:40 AM daily |
| fire | 4:30 PM daily |
| weekly | 9:40 AM Sundays |
| recap | 11:15 PM daily |

## Notes

- YouTube's free quota (10,000 units a day) allows about 6 uploads a day.
  A busy day is the outlook, the recap and two hurricane updates (plus the
  week ahead on Sundays): 4 or 5.
- GitHub can start scheduled runs a few minutes late, and pauses schedules
  in a repository with no activity for 60 days (any commit wakes them).
- Code: `main.ts` (one run: make a kind's videos, render, upload),
  `kinds/` (each kind: fetch its data, decide whether to post, write the
  English and Spanish text; tested in `kinds/kinds.test.ts`), `meta.ts`
  (shared text and the outlook's; tested in `meta.test.ts`), the pages
  that draw each Short (`outlook.html`, `recap.html`, `weekly.html`,
  `tropical.html`, on `common.js`), `render.ts` (Chromium draws a page
  frame by frame into ffmpeg), `youtube.ts` (OAuth, the upload, playlists),
  `vendor/` (maps, fonts and libraries; see its README).
- Try it locally: `npx esbuild shorts/main.ts --bundle --platform=node
  --format=esm --external:playwright-core --outfile=shorts/out/shorts.mjs`
  then `SHORTS_KIND=recap SHORTS_LATEST=1 node shorts/out/shorts.mjs`
  (needs ffmpeg and `npx playwright-core install chromium`). Add
  `SHORTS_SAVE=some/folder` to keep the data it fetched, and
  `SHORTS_FIXTURES=some/folder` to render from it again offline.
