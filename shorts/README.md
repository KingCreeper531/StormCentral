# Storm Central YouTube Shorts

Every morning, once NOAA's Storm Prediction Center issues its morning Day 1
Convective Outlook, GitHub Actions renders a 33-second vertical video of it
and uploads it to the Storm Central YouTube channel. Nothing runs on your PC.

What's in the video, all from the live outlook:

1. Intro: "Severe weather outlook" and the date.
2. The US map, with the risk areas appearing from thunderstorms up to the
   highest risk.
3. A zoom into the highest risk with city labels, and the risk in big
   letters: "SLIGHT RISK, Level 2 of 5".
4. Tornado, damaging wind and large hail odds, with each one's area on the map.
5. SPC's summary of what to expect.
6. End card: stormcentralwx.com.

There's no music; add a sound in the YouTube app if you want one. Quiet
days get a "No severe risk" video (or none, with `SHORTS_SKIP_QUIET`).

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
   `https://www.googleapis.com/auth/youtube.upload` and click **Authorize
   APIs**.
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

- With **Upload** unticked, it renders today's latest outlook. Download
  the video from the run's **Artifacts** to check it.
- With **Upload** ticked, it also uploads it.

### 7. Switch it on

**Settings → Secrets and variables → Actions → Variables → New repository
variable**: `SHORTS_ENABLED` = `true`. From then on it runs every morning
at about 8:15 AM Central, waits for the outlook if it isn't out yet, and
posts one Short a day.

## Private until Google's audit

YouTube makes videos uploaded through a new API project **private** until
the project passes a free audit. Until then, each morning's Short arrives as
private: in the YouTube Studio app, open it and set it to **Public**.

To lift that, fill in the YouTube API Services audit form:
<https://support.google.com/youtube/contact/yt_api_form>. Say it uploads
one automated weather outlook video a day to your own channel. Approval
usually takes a few weeks.

## Settings (repository variables)

| Variable | Default | |
|---|---|---|
| `SHORTS_ENABLED` | unset | `true` to post every morning |
| `SHORTS_PRIVACY` | `public` | `public`, `unlisted` or `private` |
| `SHORTS_SKIP_QUIET` | `false` | `true` for no video on days with no severe risk |

## Notes

- YouTube's free quota allows about 6 uploads a day; this uses 1.
- GitHub can start scheduled runs a few minutes late, and pauses schedules
  in a repository with no activity for 60 days (any commit wakes them).
- Code: `main.ts` (one run: wait for the outlook, render, upload),
  `meta.ts` (the title, description and tags; tested in `meta.test.ts`),
  `render.ts` (Chromium draws `template.html` frame by frame into ffmpeg),
  `youtube.ts` (OAuth and the upload), `vendor/` (the map, fonts and
  libraries; see its README).
- Try it locally: `npx esbuild shorts/main.ts --bundle --platform=node
  --format=esm --external:playwright-core --outfile=shorts/out/shorts.mjs`
  then `SHORTS_LATEST=1 node shorts/out/shorts.mjs` (needs ffmpeg and
  `npx playwright-core install chromium`).
