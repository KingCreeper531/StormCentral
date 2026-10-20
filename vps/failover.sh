#!/usr/bin/env bash
# Failover for the self-hosted web app (stormcentral-failover.timer runs it every
# minute, on a server other than the app's own). It checks the app server
# directly; after 3 failed checks in a row it points the app's address at Vercel
# (the backup, which deploys the same code from main and uses the same Turso
# database), and after 5 good checks in a row it points it back. Both through
# Cloudflare's API, with the record proxied, so the switch takes effect at once.
#
# Settings: /etc/stormcentral/failover.env (vps/setup.sh writes it)
#   CF_API_TOKEN   Cloudflare token: Zone → DNS → Edit (plus Cache Rules and Zone Settings for setup)
#   CF_ZONE_ID     the zone's id
#   APP_DOMAIN     app.stormcentralwx.com
#   APP_IP         the app server's public IPv4
#   BACKUP_HOST    storm-central-pi.vercel.app
#   NTFY_TOPIC     optional: a push to your phone (ntfy app) on every switch
set -uo pipefail

# shellcheck disable=SC1091
. /etc/stormcentral/failover.env
STATE=/var/lib/stormcentral/failover
mkdir -p "$STATE"
CF=${CF_API:-https://api.cloudflare.com/client/v4}

api() { curl -sS -m 20 -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" "$@"; }
log() { echo "$*"; logger -t stormcentral-failover "$*" 2>/dev/null || true; }
notify() { [ -n "${NTFY_TOPIC:-}" ] && curl -sS -m 10 -H "Title: Storm Central" -d "$*" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null || true; }
count() { cat "$STATE/$1" 2>/dev/null || echo 0; }

# The app server itself, bypassing Cloudflare (its certificate is Caddy's own, hence -k).
healthy() { curl -skf -m 10 --resolve "$APP_DOMAIN:443:$APP_IP" "https://$APP_DOMAIN/api/health" | grep -q '"ok":true'; }

records=$(api "$CF/zones/$CF_ZONE_ID/dns_records?name=$APP_DOMAIN")
record=$(jq -c '[.result[]? | select(.type == "A" or .type == "CNAME")][0] // empty' <<<"$records")
if [ -z "$record" ] && ! api "$CF/zones/$CF_ZONE_ID" | jq -e .success >/dev/null; then
  log "Can't reach Cloudflare's API; trying again next minute."
  exit 0
fi
mode=main
[ "$(jq -r '.type // ""' <<<"$record")" = CNAME ] && mode=backup
# Pointing somewhere else than either (set by hand, or the server's IP changed): treat it as needing the right address.
wrong=""
[ "$mode" = main ] && { [ "$(jq -r .content <<<"$record")" != "$APP_IP" ] || [ "$(jq -r .proxied <<<"$record")" != true ]; } && wrong=1

point() { # main | backup
  local type content body id
  if [ "$1" = main ]; then type=A content=$APP_IP; else type=CNAME content=$BACKUP_HOST; fi
  body=$(jq -nc --arg t "$type" --arg n "$APP_DOMAIN" --arg c "$content" '{type: $t, name: $n, content: $c, proxied: true, ttl: 1, comment: "Storm Central failover (vps/failover.sh)"}')
  id=$(jq -r '.id // ""' <<<"$record")
  # An IPv6 record for the name would block the CNAME (and bypass the switch): the app is served over IPv4 behind Cloudflare.
  for aaaa in $(jq -r '.result[]? | select(.type == "AAAA") | .id' <<<"$records"); do
    api -X DELETE "$CF/zones/$CF_ZONE_ID/dns_records/$aaaa" >/dev/null
  done
  if [ -n "$id" ]; then
    api -X PUT "$CF/zones/$CF_ZONE_ID/dns_records/$id" --data "$body"
  else
    api -X POST "$CF/zones/$CF_ZONE_ID/dns_records" --data "$body"
  fi | jq -e .success >/dev/null
}

if healthy; then
  echo 0 >"$STATE/fails"
  ok=$(($(count oks) + 1))
  echo "$ok" >"$STATE/oks"
  # No record yet (first run), or back to health after a failover.
  if [ -z "$record" ] || [ -n "$wrong" ] || { [ "$mode" = backup ] && [ "$ok" -ge 5 ]; }; then
    if point main; then
      log "App server healthy: $APP_DOMAIN → $APP_IP."
      [ "$mode" = backup ] && notify "Back on your server: $APP_DOMAIN is served by $APP_IP again."
    else
      log "Couldn't update the DNS record."
    fi
  fi
else
  echo 0 >"$STATE/oks"
  fails=$(($(count fails) + 1))
  echo "$fails" >"$STATE/fails"
  log "App server check failed ($fails in a row)."
  if [ "$mode" = main ] && [ "$fails" -ge 3 ]; then
    if point backup; then
      log "Failing over: $APP_DOMAIN → $BACKUP_HOST."
      notify "Your app server isn't answering, so $APP_DOMAIN now runs on Vercel. It switches back by itself once the server is healthy for 5 minutes."
    else
      log "Couldn't update the DNS record to fail over."
    fi
  fi
fi
