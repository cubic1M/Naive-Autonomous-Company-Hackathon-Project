#!/usr/bin/env bash
# Concatenates video/clips/*.mp4 into video/operis-demo.mp4 (h264, yuv420p, 30 fps, 1920x1080, crf 18) with 0.4 s crossfades.
set -euo pipefail
cd "$(dirname "$0")/.."
CLIPS=(00-title 01-terminal-mcp 02-find-people 03-website 04-worker-phone 05-dashboard 99-end)
SPEED=(1 1.6 1.5 1.8 1.15 2.2 1)   # per-clip playback speed (real recordings, just fast-forwarded); set all to 1 for real time
XF=0.4; TRIM=0.5   # TRIM drops the blank first frames Playwright records
inputs=(); filt=""; offs=(); total=0
for i in "${!CLIPS[@]}"; do
  f="clips/${CLIPS[$i]}.mp4"; inputs+=(-i "$f")
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"); d=$(echo "($d - $TRIM) / ${SPEED[$i]}" | bc -l)
  filt+="[$i:v]trim=start=$TRIM,setpts=(PTS-STARTPTS)/${SPEED[$i]},fps=30,scale=1920:1080,setsar=1,format=yuv420p[c$i];"
  offs+=("$d")
done
prev="c0"; acc=${offs[0]}
for ((i=1;i<${#CLIPS[@]};i++)); do
  off=$(echo "$acc - $XF" | bc -l)
  filt+="[$prev][c$i]xfade=transition=fade:duration=$XF:offset=$off[x$i];"
  prev="x$i"; acc=$(echo "$acc + ${offs[$i]} - $XF" | bc -l)
done
ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "${filt%;}" -map "[$prev]" -c:v libx264 -crf 18 -pix_fmt yuv420p -r 30 -movflags +faststart operis-demo.mp4
echo "operis-demo.mp4: $(ffprobe -v error -show_entries format=duration -of csv=p=0 operis-demo.mp4) s"
