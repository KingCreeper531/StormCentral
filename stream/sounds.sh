#!/usr/bin/env bash
# The live stream's alert sounds, synthesized with ffmpeg (original tones, so
# nothing to license, and deliberately unlike the Emergency Alert System's
# attention signal, which may only be used for real EAS alerts):
#   emergency.wav  tornado and flash flood emergencies, PDS tornado warnings, extreme wind
#   tornado.wav    tornado warnings
#   severe.wav     destructive or considerable severe thunderstorm and flash flood warnings
#   update.wav     before a briefing
# Each is a struck bell (three decaying partials) with a short room echo,
# loudness-normalized to sit just under the narrator.
#
#   bash stream/sounds.sh <dir>
set -euo pipefail
out=${1:?usage: sounds.sh <dir>}
mkdir -p "$out"

# A bell struck at time T (s) with fundamental F (Hz), loudness A, ringing for about 1/D seconds.
bell() { # F T A D
  # A 4 ms attack, so the strike is crisp without a click.
  echo "$3*if(gte(t,$2),min(1,(t-$2)/0.004)*(sin(2*PI*$1*(t-$2))*exp(-$4*(t-$2))+0.45*sin(2*PI*2.01*$1*(t-$2))*exp(-1.6*$4*(t-$2))+0.18*sin(2*PI*3.02*$1*(t-$2))*exp(-2.6*$4*(t-$2))),0)"
}
# A low hit under the first strike: a felt "thump" more than a heard one.
thump() { # T A
  echo "$2*if(gte(t,$1),min(1,(t-$1)/0.004)*sin(2*PI*62*(t-$1))*exp(-9*(t-$1)),0)"
}
# A rising sweep from 300 to ~1200 Hz over S seconds, faded in and out.
sweep() { # S A
  echo "$2*if(lt(t,$1),sin(2*PI*(300*t+(900/(2*$1))*t*t))*sin(PI*t/$1),0)"
}
render() { # name duration expression
  ffmpeg -v error -y -f lavfi -i "aevalsrc=exprs='$3':s=48000:d=$2" \
    -af "aecho=0.85:0.55:38|83:0.22|0.12,highpass=f=45,loudnorm=I=-17:TP=-1.5:LRA=11,aresample=48000" \
    -ac 2 -c:a pcm_s16le "$out/$1.wav"
}

strike() { # T A  -- the tornado motif: A5, D6, G6 in quick succession
  echo "$(bell 880 "$1" "$2" 3.2)+$(bell 1174.66 "$(awk "BEGIN{print $1+0.15}")" "$2" 3.2)+$(bell 1567.98 "$(awk "BEGIN{print $1+0.30}")" "$2" 3.0)"
}

render tornado 2.9 "$(thump 0 0.7)+$(strike 0 0.32)+$(thump 1.15 0.5)+$(strike 1.15 0.28)"
render emergency 4.6 "$(sweep 0.9 0.22)+$(thump 0.9 0.85)+$(strike 0.9 0.34)+$(thump 2.05 0.85)+$(strike 2.05 0.34)+$(strike 3.2 0.26)"
render severe 1.9 "$(bell 783.99 0 0.42 3.0)+$(bell 1046.5 0.18 0.42 2.8)"
render update 2.2 "$(bell 523.25 0 0.4 2.2)+$(bell 659.25 0.22 0.36 2.0)"
echo "Alert sounds in $out: $(ls "$out" | tr '\n' ' ')"
