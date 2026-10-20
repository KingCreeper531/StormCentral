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
#   OLLAMA_MODEL         turns the AI briefing on (gemma3:4b); empty = off
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
mkdir -p "$XDG_RUNTIME_DIR" "$STREAM_TMP"
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

# Out to YouTube: H.264 at a constant bitrate, a keyframe every 2 seconds, AAC stereo (YouTube's live settings).
limit=()
[ -n "${STREAM_SECONDS:-}" ] && limit=(-t "$STREAM_SECONDS")
fmt=flv
case "$OUT" in *.mp4) fmt=mp4 ;; esac
ffmpeg -hide_banner -loglevel warning -nostdin \
  -thread_queue_size 1024 -f x11grab -draw_mouse 0 -framerate "$FPS" -video_size "${W}x${H}" -i "$DISPLAY.0+0,0" \
  -thread_queue_size 1024 -f pulse -i stream.monitor \
  -c:v libx264 -preset veryfast -b:v "${KBPS}k" -maxrate "${KBPS}k" -bufsize "$((KBPS * 2))k" \
  -g "$((FPS * 2))" -keyint_min "$((FPS * 2))" -sc_threshold 0 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -ar 44100 -ac 2 \
  "${limit[@]}" -f "$fmt" "$OUT" &
pids+=($!)

# Whichever stops first (ffmpeg losing YouTube, Chromium crashing) ends the stream; systemd restarts it.
wait -n "${pids[@]}"
