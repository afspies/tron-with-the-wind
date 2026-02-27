export { SimBike } from './SimBike';
export {
  rotateVectorAroundAxis,
  projectOntoSurfacePlane,
  remapForwardToWall,
  remapForwardToFloor,
  getWallSurfaceFromPosition,
} from './Surface';
export { SimTrail } from './SimTrail';
export {
  lineSegmentsIntersect,
  checkTrailCollision,
  checkTrailCollisionDetailed,
  checkTrailCollisionOnWall,
  checkWallCollision,
  type TrailHitInfo,
} from './Collision';
export { AIController } from './AI';
export { Round } from './Round';
export {
  PowerUpSim,
  generateSpawnPosition,
  type SimPowerUp,
  type PowerUpEvent,
  type PowerUpType,
} from './PowerUpSim';
export {
  Simulation,
  type TickResult,
  type SimulationConfig,
} from './Simulation';
export type { SimPowerUpEffect } from './powerups/SimPowerUpEffect';
export { SimInvulnerabilityEffect } from './powerups/SimInvulnerabilityEffect';
export { createSimEffect, registerSimEffect, getRegisteredSimTypes } from './powerups/SimPowerUpRegistry';
