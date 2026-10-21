#!/usr/bin/env bash
# Keeps the self-hosted web app on the newest `main` (stormcentral-app-deploy.timer
# runs it every 5 minutes; vps/setup.sh runs it once). When main has moved, it
# builds the new version beside the running one, swaps it in, and checks
# /api/health: a version that doesn't come up is rolled back, and a commit that
# won't build isn't tried again until main moves on (or with --force).
#
# The running version is /opt/stormcentral/app/current (a link into releases/);
# the newest three releases are kept for rolling back by hand:
#   sudo ln -sfn /opt/stormcentral/app/releases/<sha> /opt/stormcentral/app/current && sudo systemctl restart stormcentral-app
set -euo pipefail

REPO=${STORMCENTRAL_REPO:-https://github.com/KingCreeper531/StormCentral.git}
BRANCH=${STORMCENTRAL_BRANCH:-main}
APP=/opt/stormcentral/app
SVC_USER=stormcentral
ENV_FILE=/etc/stormcentral/app.env
PORT=${APP_PORT:-3000}

exec 9>/run/stormcentral-app-deploy.lock
flock -n 9 || exit 0
mkdir -p "$APP/releases"
chown "$SVC_USER:" "$APP/releases"

sha=$(git ls-remote "$REPO" "refs/heads/$BRANCH" | cut -f1) || sha=""
[ -n "$sha" ] || { echo "Couldn't reach GitHub; trying again next time."; exit 0; }
force=${1:-}
[ "$force" != --force ] && [ "$sha" = "$(cat "$APP/deployed" 2>/dev/null)" ] && exit 0
[ "$force" != --force ] && [ "$sha" = "$(cat "$APP/failed" 2>/dev/null)" ] && exit 0

rel=$APP/releases/$sha
if [ ! -f "$rel/.built" ]; then
  echo "Building $sha"
  rm -rf "$rel"
  runuser -u "$SVC_USER" -- git clone -q --depth 20 -b "$BRANCH" "$REPO" "$rel"
  runuser -u "$SVC_USER" -- git -C "$rel" checkout -q "$sha"
  # Built at low priority beside the running version; NEXT_DEPLOYMENT_ID makes open pages reload after the swap
  # instead of mixing old and new code.
  # The settings read the way systemd reads them for the running app (quotes dropped, nothing expanded),
  # so NEXT_PUBLIC_* values built into the pages match.
  settings=()
  while IFS= read -r line || [ -n "$line" ]; do
    [[ $line =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    k=${BASH_REMATCH[1]} v=${BASH_REMATCH[2]}
    if [[ $v =~ ^\"(.*)\"$ || $v =~ ^\'(.*)\'$ ]]; then v=${BASH_REMATCH[1]}; fi
    settings+=("$k=$v")
  done <"$ENV_FILE"
  if ! (cd "$rel" && nice -n 10 runuser -u "$SVC_USER" -- env "${settings[@]}" SHA="$sha" bash -c '
      export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1 NEXT_DEPLOYMENT_ID="$SHA"
      npm ci --include=dev --no-audit --no-fund --loglevel=error && npx next build'); then
    # Not kept: a failed build is a whole checkout with its node_modules.
    rm -rf "$rel"
    echo "$sha" >"$APP/failed"
    echo "Build of $sha failed; still running $(cat "$APP/deployed" 2>/dev/null || echo nothing)."
    exit 1
  fi
  echo "DEPLOYMENT_VERSION=$sha" >"$rel/.deploy.env"
  touch "$rel/.built"
fi

# The version to go back to if this one doesn't come up (none on the very first install).
prev=""
[ -L "$APP/current" ] && prev=$(readlink -f "$APP/current")
[ "$prev" = "$rel" ] && prev=""
ln -sfn "$rel" "$APP/current.new" && mv -Tf "$APP/current.new" "$APP/current"
systemctl restart stormcentral-app
healthy() {
  for _ in $(seq 45); do
    curl -sf -m 5 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true' && return 0
    sleep 2
  done
  return 1
}
if ! healthy; then
  echo "$sha didn't come up; rolling back. The app's last words:"
  journalctl -u stormcentral-app -n 40 --no-pager 2>/dev/null || true
  echo "$sha" >"$APP/failed"
  if [ -n "$prev" ] && [ -f "$prev/.built" ]; then
    ln -sfn "$prev" "$APP/current.new" && mv -Tf "$APP/current.new" "$APP/current"
    systemctl restart stormcentral-app
  fi
  exit 1
fi
echo "$sha" >"$APP/deployed"
rm -f "$APP/failed"
echo "Now running $sha."

# Keep the newest three releases that finished building (the running one is always among them), so failed builds
# never push out one to roll back to; whatever is left of a build that didn't finish goes.
cur=$(readlink -f "$APP/current")
for old in "$APP"/releases/*/; do
  old=${old%/}
  if [ ! -f "$old/.built" ] && [ "$old" != "$cur" ]; then rm -rf "$old"; fi
done
find "$APP/releases" -mindepth 2 -maxdepth 2 -name .built -printf '%T@ %h\n' | sort -rn | tail -n +4 | cut -d' ' -f2- | while read -r old; do
  if [ "$old" != "$cur" ]; then rm -rf "$old"; fi
done
