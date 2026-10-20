# Running Storm Central on your own server

`setup.sh` turns a fresh Ubuntu 24.04 server (4 cores / 12 GB recommended,
for example an OVHcloud VPS) into:

| Part | What it does | Where |
|---|---|---|
| **Pro data server** | MESH, rotation tracks, VIL and GOES RGBs for Professional mode | `pro-server/`, Docker, capped at 1 CPU / 2 GB |
| **24/7 live stream** | Storm Central's radar on YouTube Live: scenes cycle through the national radar, the most serious warnings and Professional mode; new tornado warnings and emergencies are read aloud; a short briefing every 20 minutes | `stream/` (`run.sh` + `director.ts`), systemd `stormcentral-stream` |
| **Local AI** (optional) | rewords the briefings (gemma3:4b); any version with a number or hazard that isn't in the facts is thrown out for the plain facts | Ollama, lowest CPU priority |

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
