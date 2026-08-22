#!/bin/bash
set -e
FF=/Users/artunbalta/Desktop/signalive/node_modules/ffmpeg-static/ffmpeg
SRC=/Users/artunbalta/Desktop/signalive/.assetgen/out
DST=/Users/artunbalta/Desktop/signalive/public/media
mkdir -p "$DST"

# --- HERO -----------------------------------------------------------------
# The generated clip does not loop seamlessly, so build a palindrome
# (forward then reversed). The motion is a slow drift, which makes the
# turnaround invisible and gives a genuinely seamless 16s loop.
echo "hero: palindrome"
$FF -loglevel error -i "$SRC/hero.mp4" -filter_complex \
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
$FF -loglevel error -i "$SRC/hero.mp4" -frames:v 1 "$SRC/hero_frame0.png" -y
