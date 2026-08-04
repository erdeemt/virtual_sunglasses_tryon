export * from './types.js';
export { detectCapability, degradeTier, type Capability, type Tier, type TierBudget } from './capability.js';

export {
  toFaceUnits,
  faceBasis,
  headPose,
  symmetryPlane,
  signedDistanceToPlane,
  maxPairwiseDistance,
  dist,
  norm,
  dot,
  cross,
  sub,
  scale as scaleVec,
  len,
} from './perception/geometry.js';

export {
  NAMED_LANDMARKS,
  EXPECTED_LANDMARK_COUNT,
  assertIrisAvailable,
  MIDLINE,
  IRIS_A_CENTER,
  IRIS_B_CENTER,
  IRIS_A_RING,
  IRIS_B_RING,
  CANTHUS_INNER_A,
  CANTHUS_INNER_B,
  FACE_SIDE_A,
  FACE_SIDE_B,
  NOSE_BRIDGE_TOP,
  NOSE_TIP,
  CHIN,
  FOREHEAD,
  type NamedLandmark,
} from './perception/landmarkIndices.js';

export { PRIORS, PRIORS_BY_SEX, priorFor, correlation } from './metric/anthropometry.js';
export { fuseScale } from './metric/scale.js';
export { extractFrameGeometry, monocularPD, cueValue, type FrameGeometry } from './metric/cues.js';
export { MetricEstimator, type EstimatorFrame, type EstimatorOptions } from './metric/estimator.js';
export { median, robustSigma, invert } from './metric/linalg.js';
export { OneEuroFilter, OneEuroVector, type OneEuroOptions } from './filter/oneEuro.js';
