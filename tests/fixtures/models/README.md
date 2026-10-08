# Licensed real model fixtures

These are import and rendering fixtures. See the attribution and license notes in
[`CREDITS.md`](../../../CREDITS.md). Keep VRM metadata intact when creating optimized copies.

| File | Source | License |
| --- | --- | --- |
| cesium-man.glb | Khronos glTF-Sample-Assets / CesiumMan | Cesium, CC BY 4.0; logo trademark excluded |
| rigged-figure.glb | Khronos glTF-Sample-Assets / RiggedFigure | Cesium, CC BY 4.0 |
| robot-expressive.glb | three.js r186 / RobotExpressive | Quaternius, CC0 |
| seed.vrm | vrm-c/vrm-specification / Seed-san | VirtualCast, VRM Public License 1.0 |
| twist-vrm1.vrm | vrm-c/vrm-specification / Twist | pixiv, VRM Public License 1.0 |
| makehuman/** | pinned MPFB data and official system assets | MakeHuman team, CC0 1.0 |
| makehuman/faceunits/** | Anny faceunits01, pinned in tools/avatars/package-human-data.mjs | Mika Suominen, CC0 1.0 |
| knight.fbx | Quaternius's LowPoly Animated Knight on OpenGameArt | Quaternius, CC0 1.0 |
| robot-vrm0.vrm, robot.pmx | independent conversions of the above RobotExpressive mesh | Quaternius, CC0 1.0; modified format |

MakeHuman files are unchanged excerpts of the official archives: base OBJ, game-engine rig and
weights, breast/buttock targets, and the female casual suit's OBJ and proxy bindings. They test
actual exported data formats, without installing or invoking Blender.
The suit's test texture is reduced to 256 pixels. `tools/avatars/make-format-fixtures.ts`
rebuilds the VRM 0.x and PMX fixtures from the real CC0 robot; they retain its geometry and rig.
