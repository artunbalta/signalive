#!/bin/bash
cd /Users/artunbalta/Desktop/signalive/.assetgen
CANON=e334937d-860c-417d-a4a5-3f16bd6403e9
mkdir -p out logs
: > logs/run.log

gen () {
  local label="$1"; shift
  local jt="$1"; shift
  local pf="$1"; shift
  echo "[$(date +%H:%M:%S)] $label -> $jt launching" >> logs/run.log
  higgsfield generate create "$jt" --prompt "$(cat "$pf")" "$@" \
    --wait --wait-timeout 25m > "logs/$label.url" 2> "logs/$label.err"
  echo "[$(date +%H:%M:%S)] $label rc=$? url=$(tail -1 "logs/$label.url" 2>/dev/null)" >> logs/run.log
}

# Wave 1: everything with no dependency, concurrent
gen hero_video veo3_1_lite p_hero_video.txt --start_image "$CANON" --aspect_ratio 16:9 &
gen step01     veo3_1_lite p_step01.txt      --aspect_ratio 16:9 &
gen gesture    veo3_1_lite p_gesture.txt     --aspect_ratio 16:9 &
gen tt_still   nano_banana_pro p_turntable_still.txt --image_references "$CANON" --aspect_ratio 16:9 --resolution 2k &
for i in 1 2 3 4; do
  gen "card$i" nano_banana_pro "p_card$i.txt" --image_references "$CANON" --aspect_ratio 4:5 --resolution 2k &
done
wait
echo "[$(date +%H:%M:%S)] WAVE1 COMPLETE" >> logs/run.log

# Wave 2: turntable video depends on the turntable still
TTURL=$(tail -1 logs/tt_still.url 2>/dev/null)
if [ -n "$TTURL" ]; then
  curl -sL "$TTURL" -o out/tt_still.png
  python3 -c "
from PIL import Image
im=Image.open('out/tt_still.png').convert('RGB')
im.resize((1920,1080), Image.LANCZOS).save('out/tt_still_1920.png')
"
  TTID=$(higgsfield upload create ./out/tt_still_1920.png 2>/dev/null | tail -1)
  echo "[$(date +%H:%M:%S)] tt_still uploaded as $TTID" >> logs/run.log
  gen turntable veo3_1_lite p_turntable_video.txt --start_image "$TTID" --aspect_ratio 16:9
else
  echo "[$(date +%H:%M:%S)] tt_still MISSING, skipping turntable" >> logs/run.log
fi
echo "[$(date +%H:%M:%S)] ALL COMPLETE" >> logs/run.log
