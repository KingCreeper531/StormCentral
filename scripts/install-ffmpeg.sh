#!/usr/bin/env bash
# Installs ffmpeg and ffprobe on a GitHub runner, which has neither. A static build takes seconds;
# each source has gone down at some point (johnvansickle.com once served an error page instead of
# the archive, and the apt fallback then hung until its timeout failed the run), so this tries the
# builds GitHub itself hosts first, then johnvansickle.com, then apt.
set -uo pipefail
command -v ffmpeg >/dev/null && exit 0

dir="${RUNNER_TEMP:-/tmp}/ffmpeg"
for url in \
  https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
  https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz; do
  rm -rf "$dir" && mkdir -p "$dir"
  if curl -fsSL --retry 3 -m 240 "$url" | tar -xJ -C "$dir"; then
    # BtbN keeps the programs in bin/, johnvansickle at the top: find them either way.
    ff=$(find "$dir" -type f -name ffmpeg | head -1)
    fp=$(find "$dir" -type f -name ffprobe | head -1)
    if [ -n "$ff" ] && [ -n "$fp" ] && "$ff" -hide_banner -version >/dev/null 2>&1; then
      sudo install -m 755 "$ff" "$fp" /usr/local/bin/
      exit 0
    fi
  fi
  echo "::warning::No ffmpeg from $url; trying the next source."
done

echo "::warning::No static ffmpeg build; installing it with apt."
# A slow or stuck mirror's update is not fatal: the install may still find the package.
timeout 300 sudo apt-get update -qq || echo "::warning::apt-get update failed or timed out."
timeout 300 sudo apt-get install -y -qq ffmpeg
