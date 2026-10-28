#!/usr/bin/env bash
# Temporary: checks the new features' data sources from GitHub's servers.
UA="StormCentral/0.1 (github.com/KingCreeper531/StormCentral)"
get() { curl -sS -m 30 -A "$UA" "$@"; }
echo "=== WPC winter probabilities layers"
get "https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_prob_winter_precip/MapServer?f=json" | jq -c '.layers[]? | {id, name}' | head -40
echo "=== NOHRSC snow analysis layers"
get "https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer?f=json" | jq -c '.layers[]? | {id, name}' | head -20
echo "=== legend CORS (WPC)"
curl -sS -m 30 -A "$UA" -D - -o /dev/null -H "Origin: https://app.stormcentralwx.com" "https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_prob_winter_precip/MapServer/legend?f=json" | grep -i -E "^HTTP|access-control"
echo "=== NOHRSC legend layer 3"
get "https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/legend?f=json" | jq -c '.layers[]? | {layerId, layerName, labels: [.legend[]?.label]}' | head -10
echo "=== export image (NOHRSC 3)"
curl -sS -m 30 -A "$UA" -o /tmp/s.png -w "%{http_code} %{content_type} %{size_download}\n" "https://mapservices.weather.noaa.gov/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer/export?bbox=-125,24,-66,50&bboxSR=4326&imageSR=3857&size=512,256&format=png32&transparent=true&layers=show:3&f=image"
echo "=== NDBC latest_obs head"
get "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt" | head -4
echo "=== NDBC activestations head"
get "https://www.ndbc.noaa.gov/activestations.xml" | head -c 600; echo
echo "=== NDBC CORS"
curl -sS -m 30 -D - -o /dev/null -H "Origin: https://app.stormcentralwx.com" "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt" | grep -i -E "^HTTP|access-control"
echo "=== Open-Meteo marine (sea + land point)"
get "https://marine-api.open-meteo.com/v1/marine?latitude=40,39.95&longitude=-70,-105&hourly=wave_height,wave_direction,wave_period&forecast_days=1" | jq -c 'if type=="array" then map({lat:.latitude, lon:.longitude, h: .hourly.wave_height[0:3]}) else . end'
echo "=== AWC metar bbox"
get "https://aviationweather.gov/api/data/metar?format=json&bbox=40,-100,50,-90" | jq -c 'length, (.[0] | {icaoId, lat, lon, obsTime, fltCat, name, elev, rawOb})'
echo "=== AWC taf"
get "https://aviationweather.gov/api/data/taf?format=json&ids=KDSM" | jq -c '.[0] | {icaoId, issueTime, rawTAF: (.rawTAF|.[0:80])}'
echo "=== AWC airsigmet"
get "https://aviationweather.gov/api/data/airsigmet?format=json" | jq -c 'length, (.[0] | {airSigmetType, hazard, validTimeFrom, validTimeTo, altitudeLow1, altitudeHi1, coords: (.coords|.[0:2]), raw: (.rawAirSigmet|.[0:60])})'
echo "=== AWC gairmet"
get "https://aviationweather.gov/api/data/gairmet?format=json" | jq -c 'length, (.[0] | {product, hazard, validTime, geometryType, dueTo, base, top, coords: (.coords|.[0:2])})'
echo "=== AWC CORS"
curl -sS -m 30 -A "$UA" -D - -o /dev/null -H "Origin: https://app.stormcentralwx.com" "https://aviationweather.gov/api/data/metar?format=json&ids=KDSM" | grep -i -E "^HTTP|access-control"
