#!/usr/bin/env bash
# The 24/7 live stream: a virtual screen (Xvfb), a PulseAudio sink for the
# narrator, the director driving Chromium (director.mjs), and ffmpeg sending
# screen and sound to YouTube Live. If any of them stops, this script exits
# and systemd starts everything again (stormcentral-stream.service).
#
# Settings (vps/setup.sh writes them to /etc/stormcentral/stream.env):
#   YT_STREAM_KEY        YouTube Studio → Go live → Stream → stream key
#   STREAM_OUTPUT        instead of YouTube: a file or URL (tests), e.g. /tmp/test.flv
#   STREAM_SECONDS       stop after this long (tests); empty = forever
#   STREAM_FPS           frames per second (30)
#   STREAM_VIDEO_KBPS    video bitrate (3500, YouTube's range for 720p)
#   STREAM_RUNTIME       where director.mjs and playwright-core live (/opt/stormcentral/stream)
#   STREAM_EXTRA_OUTPUTS other platforms too, space-separated RTMP URLs with their keys (Twitch, Kick, Facebook…)
#   ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY + OPENAI_MODEL, OLLAMA_MODEL
#                        the AI that words the commentary (best first; see llm.ts); none = the facts as written
#   STREAM_WIDTH, STREAM_HEIGHT  1280x720; 720x1280 is the vertical stream for the Shorts feed (portrait layout)
#
# A second copy on the same machine (the vertical stream, stormcentral-stream-vertical) needs its own
# STREAM_DISPLAY, XDG_RUNTIME_DIR (its PulseAudio and STREAM_TMP live there), STREAM_SEGMENTS,
# STREAM_PROFILE, STREAM_STATE and STREAM_CONTROL_PORT; vps/setup.sh sets them.
set -euo pipefail

W=${STREAM_WIDTH:-1280}
H=${STREAM_HEIGHT:-720}
FPS=${STREAM_FPS:-30}
KBPS=${STREAM_VIDEO_KBPS:-3500}
RUNTIME=${STREAM_RUNTIME:-/opt/stormcentral/stream}
DISPLAY_NUM=${STREAM_DISPLAY:-99}
export DISPLAY=":$DISPLAY_NUM"
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/tmp/stormcentral-xdg}
export STREAM_TMP=${STREAM_TMP:-$XDG_RUNTIME_DIR/tmp}
# The alert sounds (made fresh at each start) and the rolling recording the clips are cut from.
export STREAM_SOUNDS=${STREAM_SOUNDS:-$STREAM_TMP/sounds}
export STREAM_SEGMENTS=${STREAM_SEGMENTS:-${TMPDIR:-/tmp}/stormcentral-segments}
mkdir -p "$XDG_RUNTIME_DIR" "$STREAM_TMP" "$STREAM_SEGMENTS"
rm -f "$STREAM_SEGMENTS"/*.ts
bash "$(dirname "$0")/sounds.sh" "$STREAM_SOUNDS" >/dev/null
chmod 700 "$XDG_RUNTIME_DIR"

if [ -n "${STREAM_OUTPUT:-}" ]; then
  OUT=$STREAM_OUTPUT
elif [ -n "${YT_STREAM_KEY:-}" ]; then
  OUT="rtmp://a.rtmp.youtube.com/live2/$YT_STREAM_KEY"
else
  echo "Set YT_STREAM_KEY (or STREAM_OUTPUT for a test)." >&2
  exit 1
fi

pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  pulseaudio --kill 2>/dev/null || true
}
trap cleanup EXIT

# The screen.
rm -f "/tmp/.X$DISPLAY_NUM-lock" "/tmp/.X11-unix/X$DISPLAY_NUM" 2>/dev/null || true
Xvfb "$DISPLAY" -screen 0 "${W}x${H}x24" -nolisten tcp &
pids+=($!)
for _ in $(seq 50); do [ -e "/tmp/.X11-unix/X$DISPLAY_NUM" ] && break; sleep 0.1; done

# The sound: a silent sink the narrator plays into; ffmpeg records its monitor.
pulseaudio --kill 2>/dev/null || true
pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit --log-target=stderr
for _ in $(seq 50); do pactl info >/dev/null 2>&1 && break; sleep 0.1; done
pactl load-module module-null-sink sink_name=stream sink_properties=device.description=stream >/dev/null
pactl set-default-sink stream

# The director: Chromium and the scenes. Give it time to put the first scene up.
node "$RUNTIME/director.mjs" &
pids+=($!)
sleep "${STREAM_WARMUP:-25}"

# Out to YouTube: H.264 at a constant bitrate, a keyframe every 2 seconds, AAC stereo (YouTube's live settings),
# the sound kept in sync with the picture and limited so alerts never clip. The same encode also goes to a
# rolling 4-minute recording in 6-second pieces, for the clips.
limit=()
[ -n "${STREAM_SECONDS:-}" ] && limit=(-t "$STREAM_SECONDS")
fmt=flv
case "$OUT" in *.mp4) fmt=mp4 ;; esac
# Other platforms: one more output each, which may drop without taking YouTube down.
extra=""
for url in ${STREAM_EXTRA_OUTPUTS:-}; do extra="$extra|[f=flv:onfail=ignore]$url"; done
# The rolling recording, only when this stream makes clips (the vertical one leaves them to the main stream).
segs=""
if [ "${STREAM_CLIPS_DAILY_MAX:-1}" != "0" ] || [ -n "${STREAM_CLIPS_DRY:-}" ]; then
  segs="|[f=segment:segment_time=6:segment_wrap=40:reset_timestamps=1:onfail=ignore]$STREAM_SEGMENTS/seg%02d.ts"
fi
# ffmpeg names an output that fails (YouTube turning the stream away), key and all: the keys are hidden from the log.
ffmpeg -hide_banner -loglevel warning -nostdin \
  -thread_queue_size 1024 -f x11grab -draw_mouse 0 -framerate "$FPS" -video_size "${W}x${H}" -i "$DISPLAY.0+0,0" \
  -thread_queue_size 1024 -f pulse -i stream.monitor \
  -map 0:v -map 1:a -af "aresample=async=1000,alimiter=limit=0.89:level=disabled" \
  -c:v libx264 -preset veryfast -b:v "${KBPS}k" -maxrate "${KBPS}k" -bufsize "$((KBPS * 2))k" \
  -g "$((FPS * 2))" -keyint_min "$((FPS * 2))" -sc_threshold 0 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -ar 48000 -ac 2 -flags +global_header \
  "${limit[@]}" -f tee "[f=$fmt:onfail=abort]$OUT$segs$extra" \
  2> >(sed -Eu "s#(rtmps?://[^/ |']+/[^/ |']+/)[^ |']+#\1<key>#g" >&2) &
pids+=($!)

# Whichever stops first (ffmpeg losing YouTube, Chromium crashing) ends the stream; systemd restarts it.
wait -n "${pids[@]}"
