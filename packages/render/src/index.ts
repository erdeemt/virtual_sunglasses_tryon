export { TryOnScene, type SceneOptions, type OccluderDebug } from './scene.js';
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
  unprojectToMM,
  unprojectPoint,
  faceDistanceMM,
  DEFAULT_FOV_Y_DEG,
  type CameraModel,
} from './camera.js';
