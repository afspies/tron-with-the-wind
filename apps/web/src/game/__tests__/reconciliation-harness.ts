import type { PlayerInput } from '@tron/shared';
import { NET_TICK_DURATION_MS } from '@tron/shared';
import { SimBike } from '@tron/game-core';
import { ClientPrediction, type NetBikeState } from '../../network/ClientPrediction';
import { createMockBike } from './MockBike';

const FIXED_DT = NET_TICK_DURATION_MS / 1000;

const f32 = new Float32Array(1);
function float32Trunc(v: number): number {
  f32[0] = v;
  return f32[0];
}

/** Extract a NetBikeState-compatible snapshot from a SimBike. */
function snapshot(bike: SimBike, tick: number): NetBikeState {
  return {
    x: bike.position.x,
    y: bike.position.y,
    z: bike.position.z,
    angle: bike.angle,
    vx: bike.vx,
    vz: bike.vz,
    vy: bike.vy,
    alive: bike.alive,
    grounded: bike.grounded,
    boosting: bike.boosting,
    boostMeter: bike.boostMeter,
    drifting: bike.drifting,
    velocityAngle: bike.velocityAngle,
    pitch: bike.pitch,
    flying: bike.flying,
    surfaceType: bike.surfaceType as number,
    forwardX: bike.forward.x,
    forwardY: bike.forward.y,
    forwardZ: bike.forward.z,
    doubleJumpCooldown: bike.doubleJumpCooldown,
    jumpCooldown: bike.jumpCooldown,
    boostRechargeTimer: bike.boostRechargeTimer,
    usedDoubleJumpThisAirborne: bike.usedDoubleJumpThisAirborne,
    invulnerable: bike.invulnerable,
    invulnerableTimer: bike.invulnerableTimer,
    lastInputTick: tick,
    tick,
  };
}

/** Apply float32 precision loss to all numeric fields matching the Colyseus schema. */
function truncateSnapshot(s: NetBikeState): NetBikeState {
  return {
    ...s,
    x: float32Trunc(s.x),
    y: float32Trunc(s.y),
    z: float32Trunc(s.z),
    angle: float32Trunc(s.angle),
    vx: float32Trunc(s.vx),
    vz: float32Trunc(s.vz),
    vy: float32Trunc(s.vy),
    boostMeter: float32Trunc(s.boostMeter),
    velocityAngle: float32Trunc(s.velocityAngle),
    pitch: float32Trunc(s.pitch),
    forwardX: float32Trunc(s.forwardX),
    forwardY: float32Trunc(s.forwardY),
    forwardZ: float32Trunc(s.forwardZ),
    doubleJumpCooldown: float32Trunc(s.doubleJumpCooldown),
    jumpCooldown: float32Trunc(s.jumpCooldown),
    boostRechargeTimer: float32Trunc(s.boostRechargeTimer),
    invulnerableTimer: float32Trunc(s.invulnerableTimer),
  };
}

export interface LockstepResult {
  errors: number[];
  maxPosError: number;
  avgPosError: number;
  maxAngleError: number;
}

/**
 * Deterministic PRNG (mulberry32) — reproducible jitter across runs.
 * Seed with any uint32.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runLockstepScenario(opts: {
  totalTicks: number;
  latencyTicks: number;
  inputSequence: (tick: number) => PlayerInput;
  float32?: boolean;
  /** Fractional jitter on server dt, e.g. 0.10 = ±10%. Simulates server load variance. */
  serverDtJitter?: number;
  /** Simulate realistic frame timing instead of perfect FIXED_DT prediction steps.
   *  e.g. 60 = 60fps (~16.67ms frames), causing the accumulator to produce 0 or 1 steps per frame. */
  clientFps?: number;
}): LockstepResult {
  const { totalTicks, latencyTicks, inputSequence, float32: useFloat32 = false, serverDtJitter = 0, clientFps } = opts;

  const serverBike = new SimBike(0, '#fff', 0, 0, 0);
  const clientBike = new SimBike(0, '#fff', 0, 0, 0);
  const prediction = new ClientPrediction(clientBike);
  const mockBike = createMockBike();
  const rng = mulberry32(42);

  const delayQueue: { deliverAt: number; snap: NetBikeState }[] = [];
  const errors: number[] = [];
  let maxPosError = 0;
  let maxAngleError = 0;
  let sumPosError = 0;

  // When clientFps is set, simulate realistic frame timing where frames don't align with server ticks
  const frameDt = clientFps ? 1 / clientFps : null;
  // Jitter the frame timing by ±5% to simulate real browser requestAnimationFrame variance
  const frameRng = mulberry32(123);
  let clientTime = 0;
  let serverTime = 0;

  for (let tick = 1; tick <= totalTicks; tick++) {
    const input = inputSequence(tick);

    // Server runs with potentially jittery dt (real server timing variance)
    // Client always replays with FIXED_DT (it doesn't know the server's actual dt)
    const serverDt = serverDtJitter > 0
      ? FIXED_DT * (1 + (rng() * 2 - 1) * serverDtJitter)
      : FIXED_DT;
    serverBike.update(serverDt, input, [], true);
    serverTime += FIXED_DT;

    if (frameDt) {
      // Simulate frame-rate prediction: advance client time with frame-sized steps
      // until we've covered this server tick's worth of time
      while (clientTime < serverTime) {
        const jitteredFrame = frameDt * (1 + (frameRng() * 2 - 1) * 0.05);
        prediction.predict(jitteredFrame, input);
        clientTime += jitteredFrame;
      }
    } else {
      // Perfect prediction: one FIXED_DT step per server tick (original behavior)
      prediction.predict(FIXED_DT, input);
    }

    // Queue server snapshot with simulated latency
    let snap = snapshot(serverBike, tick);
    if (useFloat32) {
      snap = truncateSnapshot(snap);
    }
    delayQueue.push({ deliverAt: tick + latencyTicks, snap });

    // Deliver delayed snapshots
    while (delayQueue.length > 0 && delayQueue[0].deliverAt <= tick) {
      const { snap: s } = delayQueue.shift()!;
      prediction.reconcile(mockBike as any, s);
    }

    // Measure position error between server and client sim
    const dx = serverBike.position.x - clientBike.position.x;
    const dy = serverBike.position.y - clientBike.position.y;
    const dz = serverBike.position.z - clientBike.position.z;
    const posError = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const angleDelta = Math.abs(serverBike.angle - clientBike.angle);

    errors.push(posError);
    sumPosError += posError;
    if (posError > maxPosError) maxPosError = posError;
    if (angleDelta > maxAngleError) maxAngleError = angleDelta;
  }

  return {
    errors,
    maxPosError,
    avgPosError: sumPosError / totalTicks,
    maxAngleError,
  };
}
