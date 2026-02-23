/**
 * Binary encoding/decoding for NetGameState packets.
 *
 * Layout:
 *   Header (6 bytes): tick (Uint32) + bikeCount (Uint8) + flags (Uint8)
 *   Per bike (40 bytes): x/z/y/angle (Float32), alive/grounded/boosting/invulnerable (Uint8),
 *     vy/boostMeter/invulnerableTimer/doubleJumpCooldown (Float32), trailLength (Uint16), deltaCount (Uint16)
 *   Trail deltas: deltaCount × 3 × Float32 per bike
 *   Full trails (if flag bit 0): trailLength × 3 × Float32 per bike
 */

import type { NetGameState } from './NetworkManager';

const HEADER_SIZE = 6;
const BIKE_RECORD_SIZE = 40;

export function encodeGameState(state: NetGameState): ArrayBuffer {
  const bikeCount = state.bikes.length;
  const flags = state.fullTrails ? 1 : 0;

  const deltaCounts: number[] = [];
  let totalDeltaFloats = 0;
  for (let i = 0; i < bikeCount; i++) {
    const count = state.trailDeltas[i].length / 3;
    deltaCounts.push(count);
    totalDeltaFloats += state.trailDeltas[i].length;
  }

  let totalFullTrailFloats = 0;
  if (state.fullTrails) {
    for (let i = 0; i < bikeCount; i++) {
      totalFullTrailFloats += state.fullTrails[i].length;
    }
  }

  const totalSize = HEADER_SIZE
    + bikeCount * BIKE_RECORD_SIZE
    + totalDeltaFloats * 4
    + totalFullTrailFloats * 4;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, state.tick, true); offset += 4;
  view.setUint8(offset, bikeCount); offset += 1;
  view.setUint8(offset, flags); offset += 1;

  // Per-bike records
  for (let i = 0; i < bikeCount; i++) {
    const b = state.bikes[i];
    view.setFloat32(offset, b[0], true); offset += 4;  // x
    view.setFloat32(offset, b[1], true); offset += 4;  // z
    view.setFloat32(offset, b[2], true); offset += 4;  // y
    view.setFloat32(offset, b[3], true); offset += 4;  // angle
    view.setUint8(offset, b[4]); offset += 1;           // alive
    view.setFloat32(offset, b[5], true); offset += 4;  // vy
    view.setUint8(offset, b[6]); offset += 1;           // grounded
    view.setFloat32(offset, b[7], true); offset += 4;  // boostMeter
    view.setUint8(offset, b[8]); offset += 1;           // boosting
    view.setUint8(offset, b[9] ?? 0); offset += 1;     // invulnerable
    view.setFloat32(offset, b[10] ?? 0, true); offset += 4; // invulnerableTimer
    view.setFloat32(offset, b[11] ?? 0, true); offset += 4; // doubleJumpCooldown
    view.setUint16(offset, state.trailLengths?.[i] ?? 0, true); offset += 2;
    view.setUint16(offset, deltaCounts[i], true); offset += 2;
  }

  // Trail deltas
  for (let i = 0; i < bikeCount; i++) {
    const flat = state.trailDeltas[i];
    for (let j = 0; j < flat.length; j++) {
      view.setFloat32(offset, flat[j], true); offset += 4;
    }
  }

  // Full trails
  if (state.fullTrails) {
    for (let i = 0; i < bikeCount; i++) {
      const flat = state.fullTrails[i];
      for (let j = 0; j < flat.length; j++) {
        view.setFloat32(offset, flat[j], true); offset += 4;
      }
    }
  }

  return buffer;
}

export function decodeGameState(buffer: ArrayBuffer): NetGameState {
  const view = new DataView(buffer);
  let offset = 0;

  const tick = view.getUint32(offset, true); offset += 4;
  const bikeCount = view.getUint8(offset); offset += 1;
  const flags = view.getUint8(offset); offset += 1;
  const hasFullTrails = (flags & 1) !== 0;

  const bikes: number[][] = [];
  const trailLengths: number[] = [];
  const deltaCounts: number[] = [];

  for (let i = 0; i < bikeCount; i++) {
    const x = view.getFloat32(offset, true); offset += 4;
    const z = view.getFloat32(offset, true); offset += 4;
    const y = view.getFloat32(offset, true); offset += 4;
    const angle = view.getFloat32(offset, true); offset += 4;
    const alive = view.getUint8(offset); offset += 1;
    const vy = view.getFloat32(offset, true); offset += 4;
    const grounded = view.getUint8(offset); offset += 1;
    const boostMeter = view.getFloat32(offset, true); offset += 4;
    const boosting = view.getUint8(offset); offset += 1;
    const invulnerable = view.getUint8(offset); offset += 1;
    const invulnerableTimer = view.getFloat32(offset, true); offset += 4;
    const doubleJumpCooldown = view.getFloat32(offset, true); offset += 4;
    const trailLength = view.getUint16(offset, true); offset += 2;
    const deltaCount = view.getUint16(offset, true); offset += 2;

    bikes.push([x, z, y, angle, alive, vy, grounded, boostMeter, boosting, invulnerable, invulnerableTimer, doubleJumpCooldown]);
    trailLengths.push(trailLength);
    deltaCounts.push(deltaCount);
  }

  const trailDeltas: number[][] = [];
  for (let i = 0; i < bikeCount; i++) {
    const flat: number[] = [];
    for (let j = 0; j < deltaCounts[i] * 3; j++) {
      flat.push(view.getFloat32(offset, true)); offset += 4;
    }
    trailDeltas.push(flat);
  }

  let fullTrails: number[][] | undefined;
  if (hasFullTrails) {
    fullTrails = [];
    for (let i = 0; i < bikeCount; i++) {
      const flat: number[] = [];
      for (let j = 0; j < trailLengths[i] * 3; j++) {
        flat.push(view.getFloat32(offset, true)); offset += 4;
      }
      fullTrails.push(flat);
    }
  }

  return {
    tick,
    bikes,
    trailDeltas,
    trailLengths,
    ...(fullTrails && { fullTrails }),
  };
}
