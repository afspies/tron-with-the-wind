import type { PlayerInput } from '@tron/shared';
import { NET_TICK_DURATION_MS, RENDER_OFFSET_SNAP_THRESHOLD, RENDER_OFFSET_MIN_CORRECTION, wrapAngle } from '@tron/shared';
import type { SimBike } from '@tron/game-core';
import { InputBuffer } from './InputBuffer';
import type { Bike } from '../game/Bike';
import type { ReconciliationLogger } from './ReconciliationLogger';

const FIXED_DT = NET_TICK_DURATION_MS / 1000; // ~0.033s

/** Server state snapshot as extracted from Colyseus schema. */
export interface NetBikeState {
  x: number; y: number; z: number; angle: number;
  vx: number; vz: number; vy: number;
  alive: boolean; grounded: boolean;
  boosting: boolean; boostMeter: number;
  drifting: boolean; velocityAngle: number;
  pitch: number; flying: boolean;
  surfaceType: number;
  forwardX: number; forwardY: number; forwardZ: number;
  doubleJumpCooldown: number;
  jumpCooldown: number;
  boostRechargeTimer: number;
  usedDoubleJumpThisAirborne: boolean;
  invulnerable: boolean; invulnerableTimer: number;
  lastInputTick: number;
  tick: number;
}

/**
 * Client-side prediction with input-buffered replay reconciliation.
 *
 * Flow per frame:
 * 1. Sample input, store in buffer with current prediction tick
 * 2. Run fixed-timestep prediction steps (SimBike.update with skipCollision=true)
 * 3. On new server state: snap to server, replay unacknowledged inputs, compute visual offset
 */
export class ClientPrediction {
  private inputBuffer = new InputBuffer(30);
  private predictionTick = 0;
  private accumulator = 0;
  private lastAcknowledgedTick = 0;
  logger?: ReconciliationLogger;

  constructor(private simBike: SimBike) {}

  /** Current prediction tick (sent with input messages to server). */
  get currentTick(): number {
    return this.predictionTick;
  }

  /**
   * Run one frame of prediction. Call once per render frame.
   * Returns the number of prediction ticks advanced this frame.
   */
  predict(dt: number, input: PlayerInput): number {
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT) {
      this.predictionTick++;
      this.inputBuffer.push(this.predictionTick, input);
      // Skip collision during prediction — server is authoritative for deaths
      this.simBike.update(FIXED_DT, input, [], true);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    return steps;
  }

  /**
   * Reconcile local prediction with authoritative server state.
   * Called when a new server tick is received.
   *
   * Returns true if a correction was applied (visual offset should be updated).
   */
  reconcile(bike: Bike, serverState: NetBikeState): boolean {
    // Death is always authoritative
    if (!serverState.alive && bike.alive) {
      bike.applyNetState(serverState);
      this.simBike.applyServerState(serverState);
      return true;
    }
    if (!serverState.alive) return false;

    // Acknowledge server-processed inputs
    const ackTick = serverState.lastInputTick;
    if (ackTick > this.lastAcknowledgedTick) {
      this.lastAcknowledgedTick = ackTick;
    }
    this.inputBuffer.acknowledge(this.lastAcknowledgedTick);

    // Save old predicted position for visual offset calculation
    const oldX = this.simBike.position.x;
    const oldY = this.simBike.position.y;
    const oldZ = this.simBike.position.z;
    const oldAngle = this.simBike.angle;

    // Snap to authoritative server state
    this.simBike.applyServerState(serverState);

    // Replay all unacknowledged inputs to re-derive predicted state
    // Save trail length before replay — replay adds spurious trail points
    const trailLen = this.simBike.trail.points.length;

    const pending = this.inputBuffer.getUnacknowledged();
    for (const entry of pending) {
      this.simBike.update(FIXED_DT, entry.input, [], true);
    }

    // Restore trail to pre-replay length (discard spurious points)
    this.simBike.trail.points.length = trailLen;

    // Compute prediction error (distance between old predicted pos and new predicted pos)
    const newX = this.simBike.position.x;
    const newY = this.simBike.position.y;
    const newZ = this.simBike.position.z;
    const newAngle = this.simBike.angle;

    const dx = oldX - newX;
    const dy = oldY - newY;
    const dz = oldZ - newZ;
    const error = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const angleDelta = Math.abs(wrapAngle(oldAngle - newAngle));
    this.logger?.log(this.predictionTick, error, angleDelta);

    if (error > RENDER_OFFSET_SNAP_THRESHOLD) {
      // Large error: teleport (zero visual offset)
      bike.renderOffset.set(0, 0, 0);
      bike.renderAngleOffset = 0;
    } else if (error > RENDER_OFFSET_MIN_CORRECTION) {
      // Absorb correction into visual offset for smooth blending
      bike.renderOffset.x += dx;
      bike.renderOffset.y += dy;
      bike.renderOffset.z += dz;
      bike.renderAngleOffset += wrapAngle(oldAngle - newAngle);

      // Prevent runaway offset accumulation from rapid consecutive corrections
      const maxOffset = 3.0;
      const offsetLenSq = bike.renderOffset.x ** 2 + bike.renderOffset.y ** 2 + bike.renderOffset.z ** 2;
      if (offsetLenSq > maxOffset * maxOffset) {
        const scale = maxOffset / Math.sqrt(offsetLenSq);
        bike.renderOffset.x *= scale;
        bike.renderOffset.y *= scale;
        bike.renderOffset.z *= scale;
      }
    }
    // else: tiny error, no visual offset needed

    // Sync non-positional state
    bike.syncInvulnerabilityFromNet(serverState.invulnerable, serverState.invulnerableTimer);

    return error > RENDER_OFFSET_MIN_CORRECTION;
  }

  /** Reset state for a new round. */
  reset(): void {
    this.inputBuffer.clear();
    this.predictionTick = 0;
    this.accumulator = 0;
    this.lastAcknowledgedTick = 0;
  }
}
