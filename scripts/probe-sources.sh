#!/usr/bin/env bash
# Temporary: one real model-maps grid request (180 points, every variable, 49 hours) from GitHub's network.
lats=(); lons=()
for r in $(seq 0 11); do for c in $(seq 0 14); do lats+=("$(echo "25 + $r*2.2" | bc)"); lons+=("$(echo "-125 + $c*4.1" | bc)"); done; done
LAT=$(IFS=,; echo "${lats[*]}"); LON=$(IFS=,; echo "${lons[*]}")
URL="https://api.open-meteo.com/v1/forecast?latitude=$LAT&longitude=$LON&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,precipitation,snowfall&forecast_hours=49&wind_speed_unit=ms&timeformat=unixtime&timezone=GMT&cell_selection=nearest"
echo "URL length: ${#URL}"
curl -sS -m 60 -o /tmp/grid.json -w "HTTP %{http_code} in %{time_total}s, %{size_download} bytes\n" "$URL"
jq -c 'if type=="array" then {points: length, hours: (.[0].hourly.time|length), first: (.[0] | {latitude, longitude, t: .hourly.temperature_2m[0], ws: .hourly.wind_speed_10m[0], cape: .hourly.cape[0], snow: .hourly.snowfall[0]}), seaPoint: (.[0] | .hourly.temperature_2m[0] != null)} else . end' /tmp/grid.json
curl -sS -m 30 -D - -o /dev/null -H "Origin: https://app.stormcentralwx.com" "https://api.open-meteo.com/v1/forecast?latitude=40&longitude=-100&hourly=cape&forecast_hours=1" | grep -i -E "^HTTP|access-control-allow-origin"
