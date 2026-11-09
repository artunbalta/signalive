#!/bin/bash
set -e
FF=/Users/artunbalta/Desktop/signalive/node_modules/ffmpeg-static/ffmpeg
SRC=/Users/artunbalta/Desktop/signalive/.assetgen/out
DST=/Users/artunbalta/Desktop/signalive/public/media
mkdir -p "$DST"

# --- HERO -----------------------------------------------------------------
# The generated clip does not loop seamlessly, so build a palindrome
# (forward then reversed). The motion is a slow drift, which makes the
# turnaround gentle. Since November 2026 the source is the earbud with its
# arc (hero_arc.mp4, from the arc canonical); its take ends on a star shaped
# glint on one contact from about 4.5s, so only the first 4.5s are used: a
# slow push in toward the contacts and back out, a 9s loop.
echo "hero: palindrome"
$FF -loglevel error -t 4.5 -i "$SRC/hero_arc.mp4" -filter_complex \
  "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[out]" \
  -map "[out]" -an -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p \
  -movflags +faststart "$DST/hero.mp4" -y

echo "hero: webm"
$FF -loglevel error -i "$DST/hero.mp4" -an -c:v libvpx-vp9 -crf 38 -b:v 0 \
  -row-mt 1 -deadline good -cpu-used 2 "$DST/hero.webm" -y

echo "hero: small variant"
$FF -loglevel error -i "$DST/hero.mp4" -vf scale=854:-2 -an -c:v libx264 -crf 28 \
  -preset slow -pix_fmt yuv420p -movflags +faststart "$DST/hero-854.mp4" -y
$FF -loglevel error -i "$DST/hero.mp4" -vf scale=854:-2 -an -c:v libvpx-vp9 -crf 40 \
  -b:v 0 -row-mt 1 -deadline good -cpu-used 2 "$DST/hero-854.webm" -y

echo "hero: poster"
$FF -loglevel error -i "$SRC/hero_arc.mp4" -frames:v 1 "$SRC/hero_frame0.png" -y

# --- GESTURE --------------------------------------------------------------
# The double clench (November 2026): veo3_1_lite from the gesture start still
# of the man wearing the earbud with its arc. 720x1280, plays as it is and
# loops. The poster is frame 125, between the two clenches, so the ring in the
# reduced motion version sits on the earbud where lib/clench.ts puts it.
echo "gesture: mp4 and webm"
$FF -loglevel error -i "$SRC/gesture_arc.mp4" -an -c:v libx264 -crf 26 -preset slow \
  -pix_fmt yuv420p -movflags +faststart "$DST/gesture.mp4" -y
$FF -loglevel error -i "$SRC/gesture_arc.mp4" -an -c:v libvpx-vp9 -crf 38 -b:v 0 \
  -row-mt 1 -deadline good -cpu-used 2 "$DST/gesture.webm" -y

echo "gesture: poster"
$FF -loglevel error -i "$SRC/gesture_arc.mp4" -vf "select=eq(n\,125)" -frames:v 1 "$SRC/gesture_poster_arc.png" -y
