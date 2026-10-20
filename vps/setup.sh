#!/usr/bin/env bash
# Storm Central on your own server (Ubuntu 24.04, 4 cores / 12 GB or more):
#   • the Pro data server (MESH, rotation tracks, VIL, GOES RGBs for Professional mode), behind HTTPS
#   • the 24/7 live stream to YouTube (radar, warnings read aloud, briefings)
#   • optionally the local AI (Ollama, gemma3:4b) that rewords the briefings
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
DOMAIN="" YT_STREAM_KEY="" AI="yes"
# shellcheck disable=SC1090
[ -f "$SETTINGS" ] && . "$SETTINGS"

ask() { # ask VAR "Question" [secret]
  local var=$1 q=$2 secret=${3:-} cur ans=""
  cur=${!var}
  [ -r /dev/tty ] || return 0
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
ask DOMAIN "Domain for the Pro data server (e.g. pro.stormcentralwx.com; its DNS A record must point here)"
ask YT_STREAM_KEY "YouTube stream key (YouTube Studio → Go live → Stream)" secret
ask AI "Local AI for the stream's briefings? (yes/no)"
case "${AI,,}" in y | yes) AI=yes ;; *) AI=no ;; esac
umask 077
printf 'DOMAIN=%q\nYT_STREAM_KEY=%q\nAI=%q\n' "$DOMAIN" "$YT_STREAM_KEY" "$AI" >"$SETTINGS"
umask 022

# ── Packages ────────────────────────────────────────────────────────────────
say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw docker.io docker-compose-v2 xvfb ffmpeg pulseaudio pulseaudio-utils pipx \
  fonts-inter fonts-dejavu-core fonts-noto-color-emoji >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
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
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
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
  printf 'DOMAIN=%s\nDASK_WORKERS=1\n' "$DOMAIN" >"$SRC/pro-server/.env"
  systemctl enable --now docker >/dev/null
  (cd "$SRC/pro-server" && docker compose -f docker-compose.yml -f docker-compose.shared.yml up -d --build --remove-orphans)
else
  warn "No domain: skipping the Pro data server."
fi

# ── Local AI ────────────────────────────────────────────────────────────────
OLLAMA_MODEL=""
if [ "$AI" = yes ]; then
  say "Local AI (Ollama, gemma3:4b)"
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
  ollama pull gemma3:4b
  OLLAMA_MODEL=gemma3:4b
fi

# ── Live stream ─────────────────────────────────────────────────────────────
if [ -n "$YT_STREAM_KEY" ]; then
  say "Live stream: Chromium, the director and the narrator's voice"
  mkdir -p "$RUNTIME"
  npm install --prefix "$RUNTIME" --no-audit --no-fund --silent playwright-core@1.56.1
  PLAYWRIGHT_BROWSERS_PATH=$BROWSERS "$RUNTIME/node_modules/.bin/playwright-core" install --with-deps chromium >/dev/null
  (cd "$SRC" && npx --yes esbuild@0.28.2 stream/director.ts --bundle --platform=node --format=esm --target=node22 --external:playwright-core --outfile="$RUNTIME/director.mjs" --log-level=warning)
  PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install --force edge-tts==7.3.1 >/dev/null
  chmod -R a+rX "$RUNTIME" "$BROWSERS" /opt/pipx

  umask 027
  cat >"$STREAM_ENV" <<EOF
YT_STREAM_KEY=$YT_STREAM_KEY
OLLAMA_MODEL=$OLLAMA_MODEL
STREAM_RUNTIME=$RUNTIME
PLAYWRIGHT_BROWSERS_PATH=$BROWSERS
STREAM_APP_URL=https://storm-central-pi.vercel.app
STREAM_FPS=30
STREAM_VIDEO_KBPS=3500
EOF
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
RestartSec=15
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
else
  warn "No stream key: skipping the live stream."
fi

# ── Done ────────────────────────────────────────────────────────────────────
say "Done"
if [ -n "$DOMAIN" ]; then
  cat <<EOF
Pro data server:  https://$DOMAIN/index.json   (products appear within a few minutes)
  Then add it to the app:
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
EOF
fi
echo "Update everything later: run the same command again."
}

main "$@"
