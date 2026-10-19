# The skeleton standard

Every full-body puppet, in every view, has the same bones (`packages/engine/src/puppet2/skeleton.ts`).
Motions, clothes and physics refer to these names, so they work on every character.

```
root                       on the floor under the pelvis, axis-aligned (IK targets are its children)
└ pelvis ─ spine ─ chest ─ neck ─ head ─ hair*
  │                │
  │                ├ shoulder_L ─ upperarm_L ─ forearm_L ─ hand_L
  │                ├ shoulder_R ─ upperarm_R ─ forearm_R ─ hand_R
  │                └ breast_L, breast_R          (when the body has them)
  ├ thigh_L ─ shin_L ─ foot_L
  ├ thigh_R ─ shin_R ─ foot_R
  ├ butt_L, butt_R                               (when the body has them)
  └ skirt*
root ─ handTarget_L/R, footTarget_L/R            IK targets
```

`*` hair and skirt are swinging bones added by the auto-rig (no keypoint needed).

- **"L" is the character's left**: on the screen's right in a front view. Mirroring swaps `_L`/`_R`.
- **Coordinates** are the art's pixels, y down; angles in degrees, clockwise positive (Rev2D).
- **Rest pose = the picture.** Bones are built from landmarks (`KeypointsSchema`): head top, neck,
  chest, pelvis, shoulders, elbows, wrists, hips, knees, ankles, toes (optional), breasts and
  buttocks (optional). The IK bend side follows the drawing, so the rest pose is exact.
- **Views:** `front`, `threeQuarter`, `side` (facing screen left; far limbs are darker copies behind the
  body), `back`. Each view is its own rig with the same names.

## Layers and roles

A layer is one picture (`rect` in canvas pixels) with a role that decides its bones and depth
(`LAYER_ROLES` in `build.ts`): body parts (`torso`, `head`, `face`, `neck`, `arm_L`, `hand_L`,
`leg_L`, `breast_L`, `butt_L`, `hair_front`, `hair_back`…), clothes (`topwear`, `chestwear_L/R`,
`sleeve_upper_L/R`, `sleeve_lower_L/R`, `bottomwear`, `skirt`, `legwear_L/R`, `footwear_L/R`,
`handwear_L/R`, `headwear`). Each becomes a grid mesh skinned to its bones with smooth automatic
weights, so elbows and knees bend as curves.

- `outfit`: the wardrobe set it belongs to (one outfit is worn at a time; `none` shows the body).
- `adult`: only in 18+ packs; shown only undressed; the server keeps such puppets off minors.
- `variant`: a sprite swap shown by a parameter: `eyes_closed`, `mouth_a`…`mouth_o`, `smile`,
  `angry`, `sad`, `surprised`, `blush`, `cry` (face) and `open`, `wave`, `fist`, `point` (hands).

## Parameters

| Group | Parameters |
|---|---|
| Body | `BodyX`, `BodyY`, `BodyAngleZ`, `Breath` |
| Draw order | `ArmBack_L/R` (arm behind the body), `ArmOver_R` (right arm over the left) |
| IK | `LegIk_L/R` (feet locked), `ArmIk_L/R` (hands reach) |
| Physics outputs | `BustY`, `BustX`, `ButtY`, `HairX`, `SkirtX`, `SkirtY` |
| Face | `EyeClose`, `Mouth` (0 closed, 1 A, 2 I, 3 U, 4 E, 5 O), `Expression` (0 neutral, 1 smile, 2 angry, 3 sad, 4 surprised, 5 blush, 6 cry) |
| Hands | `HandPose_L/R` (0 as drawn, 1 open, 2 wave, 3 fist, 4 point) |

Physics: pendulums at a fixed 60 Hz, moved by the body (bob, sway, lean); strengths per character
(`physics: { bust, butt, hair }`, 0–2).
