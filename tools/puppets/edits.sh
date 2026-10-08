#!/bin/sh
# The template edit set: every layer of a template comes from one edit of its working master.
#   NANOGPT_API_KEY=… tools/puppets/edits.sh f .puppets-work/f/working.png [names…]
# Each call goes through tools/art/gen.mjs (allowed models, the 95-a-day cap, the meter, the ledger).
set -e
T="$1"; IN="$2"; shift 2
case "$T" in f) S=she; H=her; ;; m) S=he; H=his; ;; *) echo "template must be f or m" >&2; exit 2;; esac
K="Keep everything else exactly the same: the same character, face, pose, outfit, framing, line art and colours, and the flat green background. Same illustration style."
prompt() {
  case "$1" in
    eyes-half) echo "Lower both upper eyelids halfway, a relaxed sleepy half-closed look; the irises half hidden. $K";;
    eyes-closed) echo "Close both of $H eyes gently, as in a relaxed blink: the upper eyelids meet the lower lids along a calm curved line. Keep the mouth and eyebrows unchanged. $K";;
    eyes-smile) echo "Close both of $H eyes into happy upward-curved arcs, as when smiling warmly. Keep the mouth and eyebrows unchanged. $K";;
    eyes-blank) echo "Remove the irises and pupils from both of $H eyes, leaving plain white eyeballs inside the same eye outlines and eyelashes. $K";;
    mouth-a) echo "Open $H mouth as if saying 'ah': lips parted, showing the upper teeth and a little of the tongue. $K";;
    mouth-wide) echo "Open $H mouth wide as in a surprised gasp, showing the teeth and the tongue inside. Keep the eyes and eyebrows unchanged. $K";;
    mouth-smile) echo "Change $H mouth to a gentle closed-lip smile. Keep the eyes and eyebrows unchanged. $K";;
    mouth-i) echo "Shape $H mouth as if saying 'ee': lips stretched wide and slightly parted, the upper and lower teeth together. Keep the eyes and eyebrows unchanged. $K";;
    mouth-u) echo "Shape $H mouth as if saying 'oo': lips pushed forward into a small round pout, slightly open. Keep the eyes and eyebrows unchanged. $K";;
    mouth-e) echo "Shape $H mouth as if saying 'eh': half open and stretched a little wide, showing the upper teeth. Keep the eyes and eyebrows unchanged. $K";;
    mouth-o) echo "Shape $H mouth as if saying 'oh': open in a rounded oval. Keep the eyes and eyebrows unchanged. $K";;
    brows-up) echo "Raise both of $H eyebrows high, as in mild surprise. Keep the eyes and mouth unchanged. $K";;
    brows-down) echo "Furrow both of $H eyebrows: pulled down and together in a frown. Keep the eyes and mouth unchanged. $K";;
    blush) echo "Add a soft pink blush across both of $H cheeks and the bridge of the nose. $K";;
    bald) echo "Remove all of $H hair completely, so $S is bald: show the smooth bare scalp, the whole forehead, both ears and the neck, in the same skin tone with the same soft shading. $K";;
    underwear) if [ "$T" = f ]; then echo "Replace her t-shirt and trousers with plain simple light grey athletic underwear, a sports bra and briefs, like a swimsuit: bare arms, shoulders, belly and legs drawn with the same skin tone and soft shading. Same pose. $K"; else echo "Replace his t-shirt and trousers with plain simple light grey athletic boxer briefs, like swim trunks: bare chest, arms, belly and legs drawn with the same skin tone and soft shading. Same pose. $K"; fi;;
    armless) echo "Remove both of $H arms entirely: draw the sides of the t-shirt and the trousers where the arms and hands were, as if the arms were hidden behind the body. $K";;
    hip) echo "Move $H left arm (on the right side of the picture) so the hand rests on the hip, with the elbow bent outward. Keep the other arm unchanged. $K";;
    raise) echo "Raise $H right hand (on the left side of the picture) to shoulder height in a friendly open-palm wave, with the elbow bent. Keep the other arm unchanged. $K";;
    *) echo "unknown edit: $1" >&2; exit 2;;
  esac
}
for name in "$@"; do
  node "$(dirname "$0")/../art/gen.mjs" --service nano --model step-image-edit-2 --input "$IN" --label "puppet-$T-$name" --prompt "$(prompt "$name")" || true
done
