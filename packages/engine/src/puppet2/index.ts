/** Puppets v2: the standard skeleton, auto-rig, motion library and the vendored Rev2D runtime. */
export * from './skeleton.js';
export * from './build.js';
export * from './motions.js';
export * from './testfigure.js';
export { Rig, Player, buildRenderList, type RenderListOptions } from './rev2d/rig.js';
export { validateModel, parseModelText, formatDiagnostics } from './rev2d/validate.js';
export type { Model, ModelInput, Pose, RenderList, DrawItem, Animation, AnimationLayer, PoseOptions } from './rev2d/types.js';
export * from './story.js';
