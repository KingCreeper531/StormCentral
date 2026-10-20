# Running Storm Central on your own server

`setup.sh` turns fresh Ubuntu 24.04 servers (OVHcloud VPS, for example) into
any of these parts; each server gets the parts you answer for:

| Part | What it does | Where |
|---|---|---|
| **Pro data server** | MESH, rotation tracks, VIL and GOES RGBs for Professional mode | `pro-server/`, Docker, capped at 1 CPU / 2 GB |
| **24/7 live stream** | Storm Central's radar on YouTube Live: scenes cycle through the national radar, the most serious warnings and Professional mode; new tornado warnings and emergencies are read aloud; a short briefing every 20 minutes | `stream/` (`run.sh` + `director.ts`), systemd `stormcentral-stream` |
| **Local AI** (optional) | rewords the briefings (gemma3:4b); any version with a number or hazard that isn't in the facts is thrown out for the plain facts | Ollama, lowest CPU priority |
| **Web app** | the app itself, behind Cloudflare, building and switching to each new `main` by itself (rolling back if it doesn't come up) | Caddy + systemd `stormcentral-app`, `app-deploy.sh` every 5 minutes |
| **Failover watcher** | on a *different* server: checks the app server every minute and points the app's address at Vercel after 3 failures, back after 5 good checks | `failover.sh`, systemd timer |

A good split for three small servers: **web app** on one, **Pro data server** on another, **live stream +
failover watcher** on the third, ideally in a different data centre from the app so the watcher still works if
that data centre doesn't. The web app and the Pro data server can't share a server (both need ports 80 and 443).

## Your server first, Vercel as the backup

Vercel keeps deploying `main` exactly as now and both use the same Turso database, so it's always a ready,
up-to-date copy. Normally your server answers; if it stops, the watcher moves the address to Vercel within about
three minutes, and back once your server has been healthy for five.

One-time setup:

1. **Cloudflare** (free): add your domain and switch its nameservers to Cloudflare's (your registrar's DNS settings).
   Keep the Pro data server's record (`pro.…`) grey-clouded ("DNS only"); the watcher manages the app's record.
2. **A Cloudflare API token**: My Profile → API Tokens → Create Token → Custom, for your zone, with
   *Zone → DNS → Edit*, *Zone → Cache Rules → Edit* and *Zone → Zone Settings → Edit*.
3. **Vercel**: Project → Settings → Domains → add the app's address (e.g. `app.stormcentralwx.com`). Vercel asks for a
   `TXT` record to verify it: add that in Cloudflare. That's what lets Vercel answer on your address during a failover.
4. **The app server**: run the installer, answer the *web app* question with the address, and paste the app's
   environment variables from Vercel (Settings → Environment Variables) when asked — at least `DATABASE_URL` and
   `DATABASE_AUTH_TOKEN`.
5. **The watcher's server**: run the installer, answer the *failover watcher* questions: the app's address, the app
   server's IP, the token, and optionally an [ntfy](https://ntfy.sh) topic to get a push on your phone at every switch.
   It points the address at your server, sets Cloudflare's SSL to *Full* and adds a rule so Cloudflare caches the
   app's feeds (as their own `Cache-Control` headers allow).
6. **The apps**: GitHub → Settings → Secrets and variables → Actions → Variables: `STORMCENTRAL_URL` =
   `https://app.stormcentralwx.com`, so the next Windows and Android releases use the new address.

## Install

1. Point a subdomain at the server for the Pro data server, such as an A record `pro.stormcentralwx.com` → the server's IP.
2. Get the stream key: YouTube Studio → **Go live** → **Stream** → copy the stream key. Turn on **Auto-start** there, so the broadcast starts by itself when the server connects.
3. On the server:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/KingCreeper531/StormCentral/main/vps/setup.sh | sudo bash
   ```

   It asks for the domain, the stream key and whether to turn on the AI. Leave one empty to skip that part.
4. Add the Pro data server to the app (the script prints these again):
   - Vercel → Settings → Environment Variables: `NEXT_PUBLIC_PRO_SERVER` = `https://pro.stormcentralwx.com` (Production), then Redeploy.
   - GitHub → Settings → Secrets and variables → Actions → Variables: `PRO_SERVER_URL`, same value (desktop and Android builds).

Run the same command again to update; it keeps your answers (`/etc/stormcentral/setup.env`).

## Day to day

The web app:

```bash
journalctl -u stormcentral-app -f                # the app
journalctl -u stormcentral-app-deploy -f         # updates from main
sudo stormcentral-app-deploy --force             # rebuild now (even a commit that failed before)
journalctl -t stormcentral-failover -f           # on the watcher's server
```

The stream and the Pro data server:

```bash
journalctl -u stormcentral-stream -f            # what the stream is doing
sudo systemctl restart stormcentral-stream      # restart it (it also restarts itself nightly at 09:30 UTC)
cd /opt/stormcentral/StormCentral/pro-server && sudo docker compose logs -f processor
```

The stream key lives in `/etc/stormcentral/stream.env` (readable by root and the service only). Settings there:
`STREAM_FPS` (30), `STREAM_VIDEO_KBPS` (3500, YouTube's range for 720p), `OLLAMA_MODEL` (empty turns the AI off),
`STREAM_BRIEFING_MINUTES` (20). Restart the service after changing them.

## What the stream says

Warnings are read in fixed sentences from the NWS's own text, never by the AI: the product, the counties, when it ends,
and the warning's situation sentence. Every tornado warning, extreme wind warning and emergency is read, plus destructive
or considerable severe thunderstorm and flash flood warnings; the rest scroll on the ticker (on a busy day there are dozens).
Warnings already in effect when the stream starts aren't read. The ticker always says it's not an official warning source.
