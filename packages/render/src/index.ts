export {
  TryOnScene,
  type SceneOptions,
  type SceneUpdate,
  type OccluderDebug,
  type RenderQuality,
} from './scene.js';
export { glassesGeometry } from './glassesGeometry.js';
export { LightEstimator, type LightEstimate } from './lighting.js';
export { HairOccluder } from './hairOccluder.js';
export { ContactShadow } from './contactShadow.js';
export type { ScaleMode } from './gltf.js';
export { FaceOccluder, trianglesFromTesselation, type Connection } from './faceMesh.js';
export {
  buildFrame,
  specLabel,
  DEFAULT_SPEC,
  type FrameSpec,
  type FrameAnchors,
  type BuiltFrame,
} from './frameModel.js';
export {
  loadFrameFromGLB,
  normalizeFrame,
  type NormalizeOptions,
  type LoadedFrame,
  type LoadedFrameInfo,
} from './gltf.js';
export {
  unprojectToMM,
  unprojectPoint,
  faceDistanceMM,
  DEFAULT_FOV_Y_DEG,
  type CameraModel,
} from './camera.js';
