# Characters that aren't human

A pony, a dragon, a snake or any skeleton imports, shows on the stage and moves. Nothing requires
hips, a spine or arms.

## Skeleton families

The auto-mapper (`packages/engine/src/rig/family.ts`, called from `automap.ts`) reads the skeleton's
shape — bones, parents and rest positions — and decides which kind of body it is:

| Family | Found by | Motions |
|---|---|---|
| Humanoid | a humanoid core by name, or two legs to the ground, upright, with two arms | humanoid clips, dances, gestures |
| Two-legged creature or dragon | a humanoid core with wings, or two legs without human arms, or a level body | humanoid clips when the core is mapped; wings and tail on their own |
| Four-legged | four legs reach the ground | creature motion |
| Four-legged with wings | four legs and wing chains | creature motion |
| Serpent | no legs, one long chain, longer than tall | creature motion |
| Other | anything else | creature motion |

- **Feet** are the ends of chains near the ground; several toes of one paw count as one foot.
- **Legs** run from each foot up to the highest bone that holds no other foot. A chain that goes
  along the ground more than down (a tail lying on the floor) isn't a leg.
- **Front and hind**: the head's side is the front (named "front"/"fore" legs win when present).
- **Pelvis** is where the (hind) legs join, **chest** where the front legs (or arms) join; the
  **spine** and **neck** are the bones between; the **head** is named "head" (in any of the
  languages names.ts knows) or the far end of the body.
- **Wings and tails** by name anywhere ("c_Wilngs_01" and "TailBase" count), else from the shape on
  non-humanoid bodies: tails behind the pelvis in the middle, wings to the sides of the chest off the
  ground. On a humanoid core, chains off the body stay hair, skirts and capes unless named.
- **Arms**: the side chain with a hand (three or more branches, or an arm's name).
- **Jaw, ears, eyes** by name on the head.

Names help but aren't needed: the tests rename every bone `Bone.001…` and still find the same body.
When names don't give a humanoid core (a rig named `MThigh.L`, `j07`…), a humanoid-shaped body gets
one from its shape (hips, spine, chest, neck, head, each leg and arm).

The owner can change the family on the Bones tab (**Body type**); "Map automatically" then keeps it.

## Bone roles beyond the humanoid

New roles alongside the existing ones (breast, hair, skirt, tail, ears, wings…): **root, pelvis,
neck, head, jaw, eye, front leg, hind leg, leg, arm, extra limb**, each with a side and a
confidence. They show in the Bones tab's skeleton list with their own colours, can be reviewed and
reassigned like any role, and are saved in presets.

## Motion (`apps/web/src/features/avatar3d/runtime/creature.ts`)

Every frame: the driven bones go back to rest; the character's **own clip** plays when one is
running; then the held pose and the one-shot emote; then life. Rotations are in the body's own frame
(forward, up, right measured at rest), so "nod" means the same on every rig.

- **Own clips**: the file's animations (baked by the Blender export) play as emotes: "From its file"
  in the emote picker (`own_1`…`own_9`, labelled with the clip's name). Clips named idle, loop, walk
  or run loop.
- **Life** for every family: breathing along the spine, a slow sway and weight shift, the head and
  neck turning toward the camera or whoever speaks (limited and smoothed), the tail swaying, the wings
  settling, ear twitches every few seconds. Blinking uses the face's blink shapes when it has them.
- **Family emotes** from the roles: nod, shake head, tilt head, droop, bow, wag tail, flap wings,
  hop, rear up (on the hind legs; serpents raise the front of the body), roar (jaw open, head up),
  and held poses sit, lie down, sleep and prance (a dance for four legs).
- **Lip-sync** opens the jaw bone with the voice; mouth and expression shapes work as on any model.
- **Springs**: tails and ears swing around the animated pose (the solver follows the animation for
  them); a creature's wings are its own (no spring).

Humanoid bodies with a tail or wings, or with clips in their file, get the same layer as an overlay:
the humanoid motion stays, and wag tail, flap wings and the file's clips come from here.

## Retargeting only between compatible families

`emotesForBody` (engine) decides what fits a body: humanoid clips only on humanoid-compatible bodies
with their core mapped; creature emotes where the parts exist. The emote picker shows each character
only what fits (for "Everyone", what all of them can do). The story keeps using the same ops: when it
asks a pony to `laugh` or `dance`, the pony does the nearest thing its body can
(`CREATURE_EQUIVALENT`: a laugh is a tail wag or a hop, a dance is a prance, "kneel" is lying down).
The story state is unchanged: ops are message-bound and roll back on swipe like every other.

## Stage

Long bodies (four legs, serpents) stand three-quarters to the camera so their length reads; a
creature is framed by its whole outline (wings, a long body), and lying poses use the lying framing.
Big creatures keep their real size next to other characters (a 2.3 m dragon stands taller than a
1.6 m person); a model whose size is clearly in the wrong units is fitted as before, and the Fit step
sets any scale.
