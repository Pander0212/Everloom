# The motion format

Motions (`packages/engine/src/puppet2/motions.ts`) are written once against the standard skeleton,
relative to the rest pose and in units of the character's own limbs, then compiled per character
into absolute Rev2D animation tracks (`compileMotions`). That compile is the retargeting: the same
wave on a tall and a short character bends the elbow to the same angle; a walk's stride scales with
leg length.

```ts
{ id: 'wave_L', duration: 2, loop: true, views: ['front', 'threeQuarter', 'back'], tags: ['greeting'],
  tracks: [
    { kind: 'aim',   bone: 'upperarm_L', keys: [[0, -40], [1, -44], [2, -40]] },   // world angle, body upright
    { kind: 'bend',  bone: 'forearm_L',  keys: [[0, -45], [0.25, -75], …] },       // elbow: 180 − |bend| ≈ 120°
    { kind: 'param', param: 'HandPose_L', keys: [[0, 2], [2, 2]] },                // the waving hand sprite
  ] }
```

| Track | Meaning |
|---|---|
| `aim` | world angle of a limb bone (0 right, 90 down) with the body upright |
| `bend` | rotation relative to the parent bone (0 = straight) |
| `rot` | added to the rest rotation |
| `scale` | `scaleX` (along the bone: foreshortening) or `scaleY` |
| `reach` | IK target offset in leg lengths (feet) or arm lengths (hands) |
| `param` | a parameter's value (`BodyY`, `ArmOver_R`, `LegIk_L`, `HandPose_L`…) |

Keys are `[seconds, value, ease?]` (ease: `smooth` by default, `linear`, `step`); `offset` shifts a
track in time (the second leg of a walk is the first one half a cycle later). `mirrorMotion` makes
the other side's version (`wave_L` → `wave_R`). A motion lists the views it is written for; each
view's rig gets only those (the profile walk is `walk` in side views, the in-place walk is `walk` in
the others).

**Locomotion:** a motion with `speed` (leg lengths per second) carries a `locomotion` event; the stage
moves the character by it, so feet planted by IK stay put on the floor.

## The library

`idle` (breathing, weight shift), `wave_L`/`wave_R`, `armsUp`, `armsCrossed`, `handsOnHips`,
`point_L`/`point_R`, `nod`, `bow`, `walk` (front: in place, feet locked, thigh foreshortening; side:
IK feet sliding back at ground speed while planted), `jump`.

The story's emotes and poses map onto these in `story.ts` (`EMOTE_MOTIONS`, `POSE_MOTIONS`).

## Adding motions

Add a `Motion` to `MOTIONS` and a test in `packages/engine/test/puppet2-rig.test.ts` if it has a
property to keep (a joint angle, a locked foot). Planned (not built yet): motions from a phone video
(MediaPipe pose solved onto the skeleton), from speech (head and body sway), and from text (the
owner's model writes keyframes in this format; they're rendered, checked against joint ranges, foot
sliding and loop seams, and shown for approval).
