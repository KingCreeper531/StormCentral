#!/usr/bin/env bash
# Storm Central on your own servers (Ubuntu 24.04). Each server gets the parts
# you answer for; leave a question empty to skip that part:
#   • the Pro data server (MESH, rotation tracks, VIL, GOES RGBs for Professional mode), behind HTTPS
#   • the 24/7 live stream to YouTube (radar, warnings read aloud, briefings), and optionally a vertical copy for the Shorts feed
#   • the local AI (Ollama, gemma3:4b) that rewords the stream's briefings
#   • the web app itself, behind Cloudflare, updating itself from main (Vercel stays as the backup)
#   • the failover watcher: on another server, switches the app's address to Vercel if the app server stops answering
#
# Install, or update later (your answers are kept; press Enter to keep each one):
#   curl -fsSL https://raw.githubusercontent.com/KingCreeper531/StormCentral/main/vps/setup.sh | sudo bash
set -euo pipefail

# Everything is in main(), so bash has read the whole script before running any
# of it: with `curl … | bash`, a command reading stdin would otherwise eat the rest.
main() {

REPO=https://github.com/KingCreeper531/StormCentral.git
BRANCH=${STORMCENTRAL_BRANCH:-main}
BASE=/opt/stormcentral
SRC=$BASE/StormCentral
RUNTIME=$BASE/stream
BROWSERS=$BASE/browsers
CONF=/etc/stormcentral
STREAM_ENV=$CONF/stream.env
VERTICAL_ENV=$CONF/stream-vertical.env
SETTINGS=$CONF/setup.env
SVC_USER=stormcentral

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run it as root: curl -fsSL … | sudo bash"; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || warn "Made for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}. Carrying on."

# ── Your settings ───────────────────────────────────────────────────────────
mkdir -p "$CONF"
chmod 755 "$CONF"
DOMAIN="" YT_STREAM_KEY="" YT_VERTICAL_STREAM_KEY="" YT_CLIENT_ID="" YT_CLIENT_SECRET="" YT_REFRESH_TOKEN="" ANTHROPIC_API_KEY="" GEMINI_API_KEY="" STREAM_EXTRA_OUTPUTS="" AI="no" APP_DOMAIN="" WATCHER_IP="" WATCH_DOMAIN="" WATCH_IP="" CF_API_TOKEN="" NTFY_TOPIC="" BACKUP_HOST="storm-central-pi.vercel.app"
# shellcheck disable=SC1090
[ -f "$SETTINGS" ] && . "$SETTINGS"

ask() { # ask VAR "Question" [secret]
  local var=$1 q=$2 secret=${3:-} cur ans=""
  cur=${!var}
  # No terminal (piped without one, or automation): keep the saved answers.
  { : </dev/tty; } 2>/dev/null || return 0
  if [ -n "$secret" ]; then
    read -r -s -p "$q${cur:+ [Enter keeps the current one]}: " ans </dev/tty
    echo >/dev/tty
  else
    read -r -p "$q${cur:+ [$cur]}: " ans </dev/tty
  fi
  [ -n "$ans" ] && printf -v "$var" '%s' "$ans"
  return 0
}

echo "Storm Central server setup. Leave an answer empty to skip that part."
ask DOMAIN "Pro data server on this server? Its domain (e.g. pro.stormcentralwx.com; DNS A record pointing here, not proxied)"
ask YT_STREAM_KEY "Live stream on this server? YouTube stream key (YouTube Studio → Go live → Stream)" secret
if [ -n "$YT_STREAM_KEY" ]; then
  # Enter keeps a saved key, so "none" is how to turn the vertical stream off again.
  ask YT_VERTICAL_STREAM_KEY "Vertical live stream for the Shorts feed too? A second stream key (YouTube Studio → Go live → Stream → the stream key list → Create new stream key; empty skips, none turns it off)" secret
  [ "${YT_VERTICAL_STREAM_KEY,,}" = none ] && YT_VERTICAL_STREAM_KEY=""
  [ "$YT_VERTICAL_STREAM_KEY" = "$YT_STREAM_KEY" ] && { echo "The vertical stream needs its own stream key, not the main one's." >&2; exit 1; }
else
  YT_VERTICAL_STREAM_KEY=""
fi
if [ -n "$YT_STREAM_KEY" ]; then
  echo "Optional: YouTube API credentials let the stream retitle itself as storms change and post clips as Shorts"
  echo "(the same ones as the Shorts' GitHub secrets; the refresh token needs the https://www.googleapis.com/auth/youtube scope)."
  ask YT_CLIENT_ID "YouTube client ID"
  ask YT_CLIENT_SECRET "YouTube client secret" secret
  ask YT_REFRESH_TOKEN "YouTube refresh token" secret
fi
if [ -n "$YT_STREAM_KEY" ]; then
  echo "Optional: the AI that words the stream's commentary, best first. Each is fact-checked before it's read."
  ask ANTHROPIC_API_KEY "Anthropic API key (Haiku, a few dollars a month; empty to skip)" secret
  ask GEMINI_API_KEY "Google AI Studio API key (Gemini, free tier; empty to skip)" secret
  ask STREAM_EXTRA_OUTPUTS "Other platforms, RTMP URLs with keys, space-separated (Twitch, Kick…)"
fi
ask AI "Local AI on this server (free; the stream server)? yes/no"
case "${AI,,}" in y | yes) AI=yes ;; *) AI=no ;; esac
ask APP_DOMAIN "Web app on this server? Its domain (e.g. app.stormcentralwx.com, on Cloudflare)"
if [ -n "$APP_DOMAIN" ]; then
  ask WATCHER_IP "IP of the server that will watch this one for failover (it's let through the firewall)"
  # Without it the firewall turns the watcher away, it sees the app as down, and the address moves to Vercel for good.
  [ -n "$WATCHER_IP" ] || { echo "The watcher's IP is needed with the web app (the stream server's IP)." >&2; exit 1; }
fi
ask WATCH_DOMAIN "Failover watcher on this server? The web app's domain it watches (on another server)"
if [ -n "$WATCH_DOMAIN" ]; then
  ask WATCH_IP "That app server's public IP"
  ask CF_API_TOKEN "Cloudflare API token (Zone: DNS Edit, Cache Rules Edit, Zone Settings Edit)" secret
  ask BACKUP_HOST "Backup address (Vercel)"
  ask NTFY_TOPIC "ntfy topic for alerts on your phone (optional; pick something hard to guess)"
fi
if [ -n "$APP_DOMAIN" ] && [ -n "$DOMAIN" ]; then
  echo "The web app and the Pro data server both need ports 80 and 443: put them on different servers." >&2
  exit 1
fi
if [ -n "$APP_DOMAIN" ] && [ -n "$WATCH_DOMAIN" ]; then
  echo "The watcher has to run on a different server from the app it watches." >&2
  exit 1
fi
umask 077
for v in DOMAIN YT_STREAM_KEY YT_VERTICAL_STREAM_KEY YT_CLIENT_ID YT_CLIENT_SECRET YT_REFRESH_TOKEN ANTHROPIC_API_KEY GEMINI_API_KEY STREAM_EXTRA_OUTPUTS AI APP_DOMAIN WATCHER_IP WATCH_DOMAIN WATCH_IP CF_API_TOKEN BACKUP_HOST NTFY_TOPIC; do printf '%s=%q\n' "$v" "${!v}"; done >"$SETTINGS"
umask 022

# The web app's settings: the same environment variables as on Vercel (Settings → Environment Variables).
APP_ENV=$CONF/app.env
if [ -n "$APP_DOMAIN" ]; then
  if [ ! -s "$APP_ENV" ] || ! grep -q '^DATABASE_URL=' "$APP_ENV"; then
    { : </dev/tty; } 2>/dev/null || { echo "The web app needs its settings ($APP_ENV); run this from a terminal." >&2; exit 1; }
    echo
    echo "Paste the web app's environment variables from Vercel (Settings → Environment Variables), one KEY=value per line."
    echo "At least DATABASE_URL and DATABASE_AUTH_TOKEN (the same Turso database, so Vercel and this server share everything)."
    echo "Finish with an empty line:"
    (umask 077 && : >"$APP_ENV.new")
    while IFS= read -r line </dev/tty; do
      [ -z "$line" ] && break
      [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && printf '%s\n' "$line" >>"$APP_ENV.new"
    done
    grep -q '^DATABASE_URL=' "$APP_ENV.new" || { rm -f "$APP_ENV.new"; echo "No DATABASE_URL; nothing changed." >&2; exit 1; }
    grep -q '^NWS_USER_AGENT=' "$APP_ENV.new" || echo 'NWS_USER_AGENT="StormCentral (github.com/KingCreeper531/StormCentral)"' >>"$APP_ENV.new"
    mv "$APP_ENV.new" "$APP_ENV"
  fi
  grep -qE '^DATABASE_URL="?(libsql|https)://' "$APP_ENV" || warn "DATABASE_URL isn't a Turso (libsql://) address: Vercel and this server would keep separate data."
  # Links in emails (password reset) always point here, whatever headers a request carries.
  grep -q '^PUBLIC_SITE_URL=' "$APP_ENV" || echo "PUBLIC_SITE_URL=https://$APP_DOMAIN" >>"$APP_ENV"
  # The Pro data server on this server: Professional mode's products and the radar's lightning bolts (GOES flashes).
  [ -n "$DOMAIN" ] && ! grep -q '^NEXT_PUBLIC_PRO_SERVER=' "$APP_ENV" && echo "NEXT_PUBLIC_PRO_SERVER=https://$DOMAIN" >>"$APP_ENV"
fi

# ── Packages ────────────────────────────────────────────────────────────────
say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git jq ufw gnupg >/dev/null
# Only what this server's parts need (Docker isn't installed over one that's already there).
if [ -n "$DOMAIN" ] && ! command -v docker >/dev/null; then apt-get install -y -qq docker.io docker-compose-v2 >/dev/null; fi
if [ -n "$YT_STREAM_KEY" ]; then
  apt-get install -y -qq xvfb ffmpeg pulseaudio pulseaudio-utils pipx unzip fonts-inter fonts-dejavu-core fonts-noto-color-emoji >/dev/null
fi
if { [ -n "$YT_STREAM_KEY" ] || [ -n "$APP_DOMAIN" ]; } && { ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; }; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

# Room for memory spikes (a model loading while a GOES scan is processed).
if ! swapon --show | grep -q .; then
  say "Adding a 4 GB swap file"
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

say "Firewall: SSH, HTTP and HTTPS only"
ufw allow OpenSSH >/dev/null
if [ -n "$APP_DOMAIN" ]; then
  # The web app only answers Cloudflare (and the watcher), so nobody can get around Cloudflare's cache and protection.
  ufw delete allow 80/tcp >/dev/null 2>&1 || true
  ufw delete allow 443/tcp >/dev/null 2>&1 || true
  CF_RANGES=$( (curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6) | grep -E '^[0-9a-f:.]+/[0-9]+$')
  [ -n "$CF_RANGES" ] || { echo "Couldn't read Cloudflare's IP ranges." >&2; exit 1; }
  for r in $CF_RANGES ${WATCHER_IP:+$WATCHER_IP}; do
    ufw allow proto tcp from "$r" to any port 80,443 >/dev/null
  done
else
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
fi
ufw --force enable >/dev/null

# ── The code ────────────────────────────────────────────────────────────────
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$BASE" --shell /usr/sbin/nologin "$SVC_USER"
chmod 755 "$BASE"
say "Getting Storm Central ($BRANCH)"
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch -q --depth 1 origin "$BRANCH"
  git -C "$SRC" reset -q --hard FETCH_HEAD
else
  git clone -q --depth 1 -b "$BRANCH" "$REPO" "$SRC"
fi

# ── Pro data server ─────────────────────────────────────────────────────────
if [ -n "$DOMAIN" ]; then
  say "Pro data server for https://$DOMAIN"
  here=$(hostname -I | tr ' ' '\n' | grep -v ':' | head -1)
  there=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
  [ -n "$there" ] && [ "$there" != "$here" ] && warn "$DOMAIN points to $there, but this server is $here. HTTPS won't work until the DNS A record points here."
  [ -z "$there" ] && warn "$DOMAIN doesn't resolve yet. Add an A record for it pointing to $here; HTTPS starts working once it does."
  printf 'DOMAIN=%s\n' "$DOMAIN" >"$SRC/pro-server/.env"
  # Sharing the server with the stream: the processor is capped so it can't stall the video.
  compose=(-f docker-compose.yml)
  [ -n "$YT_STREAM_KEY" ] && compose+=(-f docker-compose.shared.yml)
  systemctl enable --now docker >/dev/null
  (cd "$SRC/pro-server" && docker compose "${compose[@]}" up -d --build --remove-orphans)
else
  warn "No domain: skipping the Pro data server."
fi

# ── Local AI ────────────────────────────────────────────────────────────────
OLLAMA_MODEL=""
if [ "$AI" = yes ]; then
  # The biggest model the server's memory allows next to the stream.
  mem_gb=$(awk '/MemTotal/ {print int($2 / 1024 / 1024 + 0.5)}' /proc/meminfo)
  LOCAL_MODEL=gemma3:1b
  [ "$mem_gb" -ge 7 ] && LOCAL_MODEL=gemma3:4b
  say "Local AI (Ollama, $LOCAL_MODEL for ${mem_gb} GB of memory)"
  command -v ollama >/dev/null || curl -fsSL https://ollama.com/install.sh | sh
  mkdir -p /etc/systemd/system/ollama.service.d
  # One request at a time, and the stream always comes first for the CPU.
  cat >/etc/systemd/system/ollama.service.d/stormcentral.conf <<'EOF'
[Service]
Environment=OLLAMA_NUM_PARALLEL=1
Environment=OLLAMA_MAX_LOADED_MODELS=1
Environment=OLLAMA_KEEP_ALIVE=10m
Nice=10
CPUWeight=50
CPUQuota=200%
EOF
  systemctl daemon-reload
  systemctl enable --now ollama >/dev/null
  for _ in $(seq 30); do curl -sf http://127.0.0.1:11434/api/version >/dev/null && break; sleep 1; done
  ollama pull "$LOCAL_MODEL"
  OLLAMA_MODEL=$LOCAL_MODEL
fi

# ── Live stream ─────────────────────────────────────────────────────────────
if [ -n "$YT_STREAM_KEY" ]; then
  say "Live stream: Chromium, the director and the narrator's voice"
  mkdir -p "$RUNTIME"
  # Playwright 1.63 or newer: 1.56 refuses to install Chromium on Ubuntu 26.04.
  npm install --prefix "$RUNTIME" --no-audit --no-fund --silent playwright-core@1.63.0 @grpc/grpc-js@1.14.5 @grpc/proto-loader@0.8.1
  PLAYWRIGHT_BROWSERS_PATH=$BROWSERS "$RUNTIME/node_modules/.bin/playwright-core" install --with-deps chromium >/dev/null
  (cd "$SRC" && npx --yes esbuild@0.28.2 stream/director.ts --bundle --platform=node --format=esm --target=node22 --external:playwright-core --external:@grpc/grpc-js --external:@grpc/proto-loader --outfile="$RUNTIME/director.mjs" --log-level=warning)
  PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install --force edge-tts==7.3.1 >/dev/null
  # US towns of 5,000 people and more, for "6 miles west of Bristow" and arrival times (GeoNames, CC BY 4.0).
  if curl -fsSL -o /tmp/cities5000.zip https://download.geonames.org/export/dump/cities5000.zip; then
    unzip -p /tmp/cities5000.zip cities5000.txt | awk -F'\t' '$9 == "US" && $11 ~ /^[A-Z][A-Z]$/ {print $3 "\t" $11 "\t" $5 "\t" $6 "\t" $15}' >"$RUNTIME/places.tsv"
    rm -f /tmp/cities5000.zip
    echo "$(wc -l <"$RUNTIME/places.tsv") towns for distances."
  else
    warn "Couldn't download the town list; the stream says where storms are without distances to towns."
  fi
  chmod -R a+rX "$RUNTIME" "$BROWSERS" /opt/pipx

  umask 027
  # The answers and paths are rewritten; any other setting already in the file (changed by hand) is kept.
  local answered="YT_STREAM_KEY YT_CLIENT_ID YT_CLIENT_SECRET YT_REFRESH_TOKEN ANTHROPIC_API_KEY GEMINI_API_KEY STREAM_EXTRA_OUTPUTS STREAM_PLACES OLLAMA_MODEL STREAM_RUNTIME PLAYWRIGHT_BROWSERS_PATH"
  {
    cat <<EOF
YT_STREAM_KEY=$YT_STREAM_KEY
YT_CLIENT_ID=$YT_CLIENT_ID
YT_CLIENT_SECRET=$YT_CLIENT_SECRET
YT_REFRESH_TOKEN=$YT_REFRESH_TOKEN
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
GEMINI_API_KEY=$GEMINI_API_KEY
STREAM_EXTRA_OUTPUTS=$STREAM_EXTRA_OUTPUTS
STREAM_PLACES=$RUNTIME/places.tsv
OLLAMA_MODEL=$OLLAMA_MODEL
STREAM_RUNTIME=$RUNTIME
PLAYWRIGHT_BROWSERS_PATH=$BROWSERS
EOF
    [ -f "$STREAM_ENV" ] && grep -E '^[A-Z_][A-Z0-9_]*=' "$STREAM_ENV" | grep -vE "^(${answered// /|})=" || true
  } >"$STREAM_ENV.new"
  # YouTube's 10,000 daily units are shared with the Shorts (1,600 an upload): a title is ~51, a clip 1,600.
  for kv in STREAM_APP_URL=https://app.stormcentralwx.com STREAM_FPS=30 STREAM_VIDEO_KBPS=3500 STREAM_TITLE_DAILY_MAX=20 STREAM_CLIPS_DAILY_MAX=1; do
    grep -q "^${kv%%=*}=" "$STREAM_ENV.new" || echo "$kv" >>"$STREAM_ENV.new"
  done
  mv "$STREAM_ENV.new" "$STREAM_ENV"
  umask 022
  chown root:"$SVC_USER" "$STREAM_ENV"
  chmod 640 "$STREAM_ENV"

  cat >/etc/systemd/system/stormcentral-stream.service <<EOF
[Unit]
Description=Storm Central 24/7 live stream
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
EnvironmentFile=$STREAM_ENV
Environment=XDG_RUNTIME_DIR=/run/stormcentral-stream
RuntimeDirectory=stormcentral-stream
RuntimeDirectoryMode=0700
ExecStart=$SRC/stream/run.sh
Restart=always
RestartSec=3
# The stream gets the CPU first; Ollama and the Pro server wait.
Nice=-5
CPUWeight=400

[Install]
WantedBy=multi-user.target
EOF
  # A fresh start every night at 5:30 AM Eastern-ish (09:30 UTC), when it's quietest, so Chromium never runs for days.
  cat >/etc/systemd/system/stormcentral-stream-restart.service <<'EOF'
[Unit]
Description=Restart the Storm Central live stream

[Service]
Type=oneshot
ExecStart=/bin/systemctl try-restart stormcentral-stream.service
# The vertical stream too, when there is one.
ExecStart=-/bin/systemctl try-restart stormcentral-stream-vertical.service
EOF
  cat >/etc/systemd/system/stormcentral-stream-restart.timer <<'EOF'
[Unit]
Description=Restart the Storm Central live stream nightly

[Timer]
OnCalendar=*-*-* 09:30:00 UTC
Persistent=false

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now stormcentral-stream-restart.timer >/dev/null
  systemctl enable stormcentral-stream >/dev/null
  systemctl restart stormcentral-stream
  # What earlier versions left in /tmp on every restart (a whole Chromium profile each); the stream now reuses one folder.
  find /tmp -maxdepth 1 -user "$SVC_USER" -mmin +1 \( -name 'scl-chromium-*' -o -name 'scl-chat-*' \) -exec rm -rf {} + 2>/dev/null || true
else
  warn "No stream key: skipping the live stream."
fi

# ── Vertical live stream (9:16, for the Shorts feed) ────────────────────────
# A second copy of the stream with its own key, 720x1280 (the overlay's portrait layout), screen, sound,
# Chromium profile and control port. It reads stream.env first, then its own file on top. The main stream keeps
# the titles, clips and chat commands: YouTube's 10,000 daily API units are already shared with the Shorts uploads.
if [ -n "$YT_STREAM_KEY" ] && [ -n "$YT_VERTICAL_STREAM_KEY" ]; then
  say "Vertical live stream for the Shorts feed"
  umask 027
  # The key and what keeps the two copies apart are rewritten; the rest stays as changed by hand.
  local vanswered="YT_STREAM_KEY STREAM_WIDTH STREAM_HEIGHT STREAM_DISPLAY STREAM_CONTROL_PORT STREAM_STATE STREAM_PROFILE STREAM_SEGMENTS STREAM_EXTRA_OUTPUTS"
  {
    cat <<EOF
YT_STREAM_KEY=$YT_VERTICAL_STREAM_KEY
STREAM_WIDTH=720
STREAM_HEIGHT=1280
STREAM_DISPLAY=98
STREAM_CONTROL_PORT=8788
STREAM_STATE=$BASE/stream-vertical-state.json
STREAM_PROFILE=/tmp/stormcentral-chromium-vertical
STREAM_SEGMENTS=/tmp/stormcentral-segments-vertical
STREAM_EXTRA_OUTPUTS=
EOF
    [ -f "$VERTICAL_ENV" ] && grep -E '^[A-Z_][A-Z0-9_]*=' "$VERTICAL_ENV" | grep -vE "^(${vanswered// /|})=" || true
  } >"$VERTICAL_ENV.new"
  for kv in STREAM_VIDEO_KBPS=3000 STREAM_TITLE_DAILY_MAX=0 STREAM_CLIPS_DAILY_MAX=0 STREAM_CHAT=off; do
    grep -q "^${kv%%=*}=" "$VERTICAL_ENV.new" || echo "$kv" >>"$VERTICAL_ENV.new"
  done
  mv "$VERTICAL_ENV.new" "$VERTICAL_ENV"
  umask 022
  chown root:"$SVC_USER" "$VERTICAL_ENV"
  chmod 640 "$VERTICAL_ENV"

  cat >/etc/systemd/system/stormcentral-stream-vertical.service <<EOF
[Unit]
Description=Storm Central vertical live stream (Shorts feed)
After=network-online.target stormcentral-stream.service
Wants=network-online.target

[Service]
User=$SVC_USER
EnvironmentFile=$STREAM_ENV
EnvironmentFile=$VERTICAL_ENV
Environment=XDG_RUNTIME_DIR=/run/stormcentral-stream-vertical
RuntimeDirectory=stormcentral-stream-vertical
RuntimeDirectoryMode=0700
ExecStart=$SRC/stream/run.sh
Restart=always
RestartSec=3
# After the main stream for the CPU, still ahead of Ollama and the Pro server.
Nice=0
CPUWeight=200

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable stormcentral-stream-vertical >/dev/null
  systemctl restart stormcentral-stream-vertical
elif [ -f /etc/systemd/system/stormcentral-stream-vertical.service ]; then
  say "Turning the vertical live stream off"
  systemctl disable --now stormcentral-stream-vertical >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/stormcentral-stream-vertical.service "$VERTICAL_ENV"
  systemctl daemon-reload
fi

# ── Web app ─────────────────────────────────────────────────────────────────
if [ -n "$APP_DOMAIN" ]; then
  say "Web app for https://$APP_DOMAIN"
  if ! command -v caddy >/dev/null || ! caddy version | grep -qE '^v2\.([7-9]|[1-9][0-9])'; then
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  chown root:"$SVC_USER" "$APP_ENV"
  chmod 640 "$APP_ENV"
  # Behind Cloudflare: the visitor's IP comes from CF-Connecting-IP, trusted only from Cloudflare's own ranges, and
  # replaces whatever X-Forwarded-For a visitor sent (the app's rate limits read it). Caddy's own certificate is
  # enough: Cloudflare encrypts to it ("Full" SSL mode) and visitors only ever see Cloudflare's.
  cat >/etc/caddy/Caddyfile <<EOF
{
	# Caddy's own certificate is only for Cloudflare, so it isn't added to this server's trust store.
	skip_install_trust
	servers {
		trusted_proxies static $(echo $CF_RANGES)
		client_ip_headers CF-Connecting-IP
	}
}

https://$APP_DOMAIN {
	tls internal
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Forwarded-For {client_ip}
		header_up X-Real-IP {client_ip}
		header_up X-Forwarded-Host {host}
	}
}
EOF
  systemctl enable caddy >/dev/null
  systemctl reload caddy 2>/dev/null || systemctl restart caddy

  mkdir -p "$BASE/app"
  chown "$SVC_USER:" "$BASE/app"
  install -m 755 "$SRC/vps/app-deploy.sh" /usr/local/bin/stormcentral-app-deploy
  cat >/etc/systemd/system/stormcentral-app.service <<EOF
[Unit]
Description=Storm Central web app
After=network-online.target
Wants=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$BASE/app/current
EnvironmentFile=$APP_ENV
EnvironmentFile=-$BASE/app/current/.deploy.env
Environment=NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
ExecStart=$(command -v node) node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  cat >/etc/systemd/system/stormcentral-app-deploy.service <<'EOF'
[Unit]
Description=Update the Storm Central web app from main

[Service]
Type=oneshot
ExecStart=/usr/local/bin/stormcentral-app-deploy
EOF
  cat >/etc/systemd/system/stormcentral-app-deploy.timer <<'EOF'
[Unit]
Description=Check for a new Storm Central version every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable stormcentral-app >/dev/null
  say "Building the web app (a few minutes the first time)"
  /usr/local/bin/stormcentral-app-deploy --force || warn "The first build failed (journalctl -u stormcentral-app-deploy); it tries again every 5 minutes."
  systemctl enable --now stormcentral-app-deploy.timer >/dev/null
fi

# ── Failover watcher ────────────────────────────────────────────────────────
if [ -n "$WATCH_DOMAIN" ]; then
  say "Failover watcher for $WATCH_DOMAIN"
  CF=https://api.cloudflare.com/client/v4
  cfapi() { curl -sS -m 20 -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" "$@"; }
  # The zone is the longest suffix of the domain that Cloudflare knows.
  ZONE_ID="" ZONE_NAME="" d=$WATCH_DOMAIN
  while [[ "$d" == *.* ]]; do
    d=${d#*.}
    z=$(cfapi "$CF/zones?name=$d" | jq -r '.result[0].id // empty')
    [ -n "$z" ] && { ZONE_ID=$z ZONE_NAME=$d; break; }
  done
  [ -n "$ZONE_ID" ] || { echo "Cloudflare doesn't list a zone for $WATCH_DOMAIN with that token." >&2; exit 1; }
  echo "Cloudflare zone: $ZONE_NAME"
  # "Full" SSL: Cloudflare encrypts to both the app server (Caddy's own certificate) and Vercel.
  cfapi -X PATCH "$CF/zones/$ZONE_ID/settings/ssl" --data '{"value":"full"}' | jq -e .success >/dev/null ||
    warn "Couldn't set SSL to Full (token without Zone Settings Edit?). Set it yourself: Cloudflare → SSL/TLS → Overview → Full."
  # Cache the app's feeds at Cloudflare as the app's Cache-Control headers say (private and no-store responses aren't).
  desc="Storm Central: cache the app's feeds"
  rules=$(cfapi "$CF/zones/$ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint" | jq -c '[.result.rules[]? | {expression, action, action_parameters, description, enabled}]' 2>/dev/null)
  [ -n "$rules" ] || rules='[]'
  rule=$(jq -nc --arg d "$desc" --arg h "$WATCH_DOMAIN" '{description: $d, enabled: true, action: "set_cache_settings",
    expression: ("(http.host eq \"" + $h + "\" and starts_with(http.request.uri.path, \"/api/\"))"),
    action_parameters: {cache: true, edge_ttl: {mode: "bypass_by_default"}, browser_ttl: {mode: "respect_origin"}}}')
  body=$(jq -nc --argjson r "$rules" --argjson n "$rule" --arg d "$desc" '{rules: ([$r[] | select(.description != $d)] + [$n])}')
  cfapi -X PUT "$CF/zones/$ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint" --data "$body" | jq -e .success >/dev/null ||
    warn "Couldn't add the cache rule (token without Cache Rules Edit?). The app works without it, just with more load on the server."

  umask 077
  cat >"$CONF/failover.env" <<EOF
CF_API_TOKEN=$CF_API_TOKEN
CF_ZONE_ID=$ZONE_ID
APP_DOMAIN=$WATCH_DOMAIN
APP_IP=$WATCH_IP
BACKUP_HOST=$BACKUP_HOST
NTFY_TOPIC=$NTFY_TOPIC
EOF
  umask 022
  install -m 755 "$SRC/vps/failover.sh" /usr/local/bin/stormcentral-failover
  cat >/etc/systemd/system/stormcentral-failover.service <<'EOF'
[Unit]
Description=Storm Central failover check

[Service]
Type=oneshot
ExecStart=/usr/local/bin/stormcentral-failover
EOF
  cat >/etc/systemd/system/stormcentral-failover.timer <<'EOF'
[Unit]
Description=Check the Storm Central app server every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now stormcentral-failover.timer >/dev/null
  /usr/local/bin/stormcentral-failover || true
fi

# ── Done ────────────────────────────────────────────────────────────────────
say "Done"
if [ -n "$DOMAIN" ]; then
  cat <<EOF
Pro data server:  https://$DOMAIN/index.json   (products appear within a few minutes)
  The web app on this server already uses it. Add it to the others too:
    • Vercel → Settings → Environment Variables: NEXT_PUBLIC_PRO_SERVER = https://$DOMAIN (Production), then Redeploy
    • GitHub → Settings → Secrets and variables → Actions → Variables: PRO_SERVER_URL = https://$DOMAIN
  Logs:  cd $SRC/pro-server && docker compose logs -f processor
EOF
fi
if [ -n "$YT_STREAM_KEY" ]; then
  cat <<EOF
Live stream:  on its way to YouTube (YouTube Studio → Go live shows it within a minute)
  Logs:     journalctl -u stormcentral-stream -f
  Stop:     sudo systemctl stop stormcentral-stream      Start: sudo systemctl start stormcentral-stream
  Control:  from your computer, ssh -L 8787:127.0.0.1:8787 root@<this server>, then e.g.
            curl localhost:8787/state     (see vps/README.md for show, pin, say and title)
EOF
fi
if [ -n "$YT_STREAM_KEY" ] && [ -n "$YT_VERTICAL_STREAM_KEY" ]; then
  cat <<EOF
Vertical stream (Shorts feed):  720x1280 on its own key; turn on Auto-start for that key in YouTube Studio.
  Logs:     journalctl -u stormcentral-stream-vertical -f
  Stop:     sudo systemctl stop stormcentral-stream-vertical      Settings: $VERTICAL_ENV (on top of $STREAM_ENV)
  Control:  the same API on port 8788 (ssh -L 8788:127.0.0.1:8788 …)
EOF
fi
if [ -n "$APP_DOMAIN" ]; then
  cat <<EOF
Web app:  running $(cat "$BASE/app/deployed" 2>/dev/null | cut -c1-7) behind Caddy; it updates itself from main every 5 minutes.
  Logs:     journalctl -u stormcentral-app -f        Updates: journalctl -u stormcentral-app-deploy -f
  Next: run this setup on the server that will watch this one (the failover watcher), with this server's IP.
EOF
fi
if [ -n "$WATCH_DOMAIN" ]; then
  cat <<EOF
Failover watcher:  checks $WATCH_DOMAIN on $WATCH_IP every minute; after 3 failures it points the address at $BACKUP_HOST.
  For the backup to answer on $WATCH_DOMAIN, add the domain in Vercel (Settings → Domains) and the TXT record it asks for.
  Logs:  journalctl -t stormcentral-failover -f
EOF
fi
echo "Update everything later: run the same command again."
}

main "$@"
