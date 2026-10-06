# Making 3D assets for Everloom with an AI assistant in Blender

The best-looking characters, garments and props come from Blender: made or adjusted by hand, or by
an AI assistant driving Blender for you through an **MCP server** on your own PC. This page explains
that workflow, what to ask for, the spec the result must follow, and how to export it with the
Everloom add-on.

Everloom's own AI tools (Settings › Connections › 3D models) are good at rigid props and textures;
anything that has to bend with a body (garments, hair, whole characters) is better done this way.

## What you need

- **Blender** 4.2 or newer, with the **Everloom exporter** add-on (`tools/blender-addon/`, see its
  README) set up with your Everloom address and a device token.
- An **AI assistant that can use MCP servers** (for example a desktop chat app or a coding assistant
  that supports the Model Context Protocol).
- A **Blender MCP server**: an add-on plus a small server that lets the assistant run Blender
  operations (create and edit objects, run Python, read the scene, take viewport screenshots). Several
  open-source ones exist; install one you trust and read what it can do: it runs code in your Blender.
  Keep it on your own PC and don't expose its port to the network.

## The spec your asset must follow

Give the assistant this list at the start (it's the short form of [avatars.md](avatars.md)):

- **Units and orientation:** metres, Z up in Blender (the GLB exporter makes it Y up), the character
  facing **−Y** in Blender (that becomes +Z, towards the viewer, in the GLB). Apply all transforms
  (Ctrl+A › All Transforms) before export.
- **Skeleton:** one armature, a humanoid hierarchy (hips → spine → chest → neck → head, shoulders →
  upper arms → forearms → hands, upper legs → lower legs → feet). Any naming that says what a bone is
  works (Rigify `DEF-`, Mixamo, VRoid, plain names). Rest pose: T-pose or A-pose.
- **Skinning:** every mesh that moves is parented to the armature with an Armature modifier and
  vertex weights, at most 4 influences per vertex.
- **Budget:** about 60,000 triangles per character (garments and props count), up to 24 materials,
  textures up to 2048 px, packed into the file.
- **Face (characters):** shape keys named like `blink`, `blinkLeft`, `blinkRight`, `aa`, `ih`, `ou`,
  `ee`, `oh`, and feelings such as `joy`, `angry`, `sad`, `surprised`, `fun` (ARKit, VRoid and MMD names
  also work). A mesh named `face_overlay` is drawn just above the skin (eyes or blush drawn as decals).
- **Garments:** made on (and weighted to) the body they're for, sitting **just outside the skin**
  (2–10 mm), with the same armature. Loose parts (a skirt, a cape, long hair) can have extra bones
  named with `skirt`, `cape`, `hair`, `tail`, `ribbon`… so they swing.
- **Body family:** set a custom property `everloom_family` (for example `basic-female`) on the
  armature of a body, so every garment made for it fits all avatars of that family.
- **All ages:** fully clothed designs; bodies without anatomical detail.

## What to ask for

Work in small steps and look at a viewport screenshot after each one. Good requests:

1. *"Import `body.glb`. Tell me the armature's bone names and the body's height. Take a front
   screenshot."* (So the assistant knows what it's fitting to.)
2. *"Make a fitted short-sleeved shirt for this body: duplicate the torso and upper arm faces of the
   body mesh into a new object called Shirt, delete the rest, solidify it 3 mm outward, and clean the
   edges at the sleeves, neckline and hem into smooth loops."* (Starting from the body's own surface
   gives a perfect fit.)
3. *"Give the shirt a Shrinkwrap modifier targeting the body with a 6 mm offset in Outside mode, apply
   it, then copy the vertex weights from the body with a Data Transfer modifier (nearest face
   interpolated, all vertex groups by name), apply it, and add an Armature modifier for the rig."*
4. *"Pose the arms down 70°, take a screenshot from the front and the side, then return to the rest
   pose."* (Checks that it bends with the body and nothing pokes through.)
5. *"Make a UV map with Smart UV Project and give it a cotton-like material: base colour #5b7fa6,
   roughness 0.8."*
6. *"Count the triangles of Shirt."* Then export with the Everloom panel.

For a **prop** (a hat, a sword): ask for it as one object with its origin where it's held or worn
(the grip, the base of the hat), real-world size in metres, and no armature. Upload it as an
accessory in the avatar's dressing room and pick the bone.

For a **whole character**: start from a base mesh you have the rights to (MPFB/MakeHuman's are CC0;
see *Realistic characters* in avatars.md), then ask for hair, clothes and colours one at a time.

## Export

Select the garment (or character) and its armature, then in the Everloom panel: **Check**, fix
anything it lists, and **Send to my Everloom** (or **Save GLB** and import it in the app). A garment
lands in the chosen avatar's dressing room; set the regions it covers there so skin under it is
hidden, and link it to the items that put it on.

## What works and what doesn't (our tests)

- Fitting a garment that starts from the body's own surface (step 2) works every time.
- Garments made from scratch by description need several rounds of "move this edge loop out";
  screenshots after each step are what make it work.
- Hair made of simple cards or tubes looks good in Everloom's toon shading; strands and particle hair
  don't export to GLB.
- Image-to-3D garments (Everloom's experimental option) fit roughly: fine for armour plates and
  boots, poor for anything loose or layered. Re-topologise and re-fit them here if they matter.
