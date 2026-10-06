# Everloom exporter for Blender

Checks a model against the Everloom avatar spec ([docs/avatars.md](../../docs/avatars.md)) and exports
it as a GLB: saved to a file, or sent straight to your own Everloom server.

**License:** GPL-3.0-or-later (Blender add-ons use Blender's Python API, which is GPL). The rest of
Everloom is MIT.

## Install

Blender 4.2 or newer. Zip the `everloom` folder (so the zip contains `everloom/__init__.py` and
`everloom/blender_manifest.toml`), then Edit › Preferences › Add-ons › the menu › Install from Disk,
and pick the zip. Older Blender: copy the `everloom` folder into your add-ons folder.

In the add-on's preferences, set:

- **Everloom address**: where your Everloom runs (`https://rp.example.com`, or `http://127.0.0.1:8787`
  on the same PC).
- **Device token**: in Everloom, Settings › Character sources › Browser bridge › Add a device (the
  same tokens the browser bridge uses). It's stored in Blender's preferences; remove the device in
  Everloom to revoke it.

## Use

3D View › sidebar (N) › **Everloom**:

- **What**: an *Avatar* (a character), a *Garment* (clothing for one of your avatars; Refresh lists
  them, then pick the slot) or an *Animation* (a motion for the emote library).
- **Check**: the armature is there; the main bones exist (hips, spine, head, arms, legs; Everloom maps
  almost any naming on import); garments are weighted to the skeleton; the triangle count against the
  phone budget (60,000); the height in metres; the body family (a custom property
  `everloom_family` on the armature, so garments fit every avatar of that family).
- **Save GLB** or **Send to my Everloom**. Avatars are imported and prepared straight away; garments
  are added to the chosen avatar's dressing room; animations wait under Settings › 3D characters ›
  *From Blender* to be named and previewed.

Select what to export first (the meshes and their armature); with nothing selected, the whole scene
is exported.
