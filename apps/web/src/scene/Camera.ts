import * as THREE from 'three';
import { quatRotateVec3 } from '@tron/shared';
import type { Vec3 } from '@tron/shared';
import { Bike } from '../game/Bike';

const CHASE_DISTANCE = 12;
const CHASE_HEIGHT = 8;
const CHASE_LERP = 8;
const CHASE_LERP_DRIFT = 14;      // faster lerp during drift to keep up with rotation
const DRIFT_EXTRA_DISTANCE = 5;   // pull camera back during drift

const OVERVIEW_HEIGHT = 120;
const OVERVIEW_LERP = 2;
const OVERVIEW_PADDING = 30;

// Camera control constants
const ORBIT_SPEED = 2.5;     // rad/s when holding Q/E
const ORBIT_RETURN_SPEED = 3; // rad/s spring-back when released
const MAX_ORBIT = Math.PI * 0.8; // max orbit angle (~144 degrees)
const FP_TRANSITION_SPEED = 5; // blend speed for FP transitions
const FP_HEIGHT = 1.2;        // eye height in first person
const FP_FORWARD_OFFSET = 0.3; // slight forward offset from bike center

function vec3Len(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function vec3NormalizeSafe(v: Vec3): Vec3 {
  const len = vec3Len(v);
  if (len < 1e-6) return { x: 0, y: 1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export class GameCamera {
  camera: THREE.PerspectiveCamera;
  private mode: 'chase' | 'overview' = 'chase';
  private targetPosition = new THREE.Vector3();
  private targetLookAt = new THREE.Vector3();
  private currentLookAt = new THREE.Vector3();
  private lookAtInitialized = false;

  // Camera control state
  private orbitOffset = 0;      // current orbit angle offset (radians)
  private firstPerson = false;
  private fpBlend = 0;          // 0 = chase, 1 = first person
  private driftBlend = 0;       // 0 = normal, 1 = fully drifting (smooth transition)
  private keys = new Set<string>();
  private viewTogglePressed = false;  // edge-detect for X toggle

  constructor() {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, OVERVIEW_HEIGHT, 0);
    this.camera.lookAt(0, 0, 0);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    window.addEventListener('keydown', (e) => {
      // Ignore camera keys when typing in an input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  /** 0 = chase, 1 = fully first-person */
  get fpBlendValue(): number {
    return this.fpBlend;
  }

  setMode(mode: 'chase' | 'overview'): void {
    this.mode = mode;
    if (mode === 'overview') {
      this.firstPerson = false;
      this.fpBlend = 0;
      this.orbitOffset = 0;
      this.driftBlend = 0;
      this.lookAtInitialized = false;
    }
  }

  private localBikeIndex = 0;

  setLocalBikeIndex(index: number): void {
    this.localBikeIndex = index;
  }

  update(dt: number, bikes: Bike[]): void {
    if (this.mode === 'chase') {
      this.updateCameraControls(dt);
      this.updateChase(dt, bikes);
    } else {
      this.updateOverview(dt, bikes);
    }
  }

  private updateCameraControls(dt: number): void {
    // Z/C orbit
    const panLeft = this.keys.has('KeyZ') || this.keys.has('Comma');
    const panRight = this.keys.has('KeyC') || this.keys.has('Period');

    if (panLeft) {
      this.orbitOffset = Math.min(MAX_ORBIT, this.orbitOffset + ORBIT_SPEED * dt);
    } else if (panRight) {
      this.orbitOffset = Math.max(-MAX_ORBIT, this.orbitOffset - ORBIT_SPEED * dt);
    } else {
      // Spring back to center
      if (Math.abs(this.orbitOffset) < 0.01) {
        this.orbitOffset = 0;
      } else if (this.orbitOffset > 0) {
        this.orbitOffset = Math.max(0, this.orbitOffset - ORBIT_RETURN_SPEED * dt);
      } else {
        this.orbitOffset = Math.min(0, this.orbitOffset + ORBIT_RETURN_SPEED * dt);
      }
    }

    // X toggle first person (edge-detect)
    const xDown = this.keys.has('KeyX');
    if (xDown && !this.viewTogglePressed) {
      this.firstPerson = !this.firstPerson;
    }
    this.viewTogglePressed = xDown;

    // Smooth blend toward target
    const fpTarget = this.firstPerson ? 1 : 0;
    const blendDelta = FP_TRANSITION_SPEED * dt;
    if (this.fpBlend < fpTarget) {
      this.fpBlend = Math.min(fpTarget, this.fpBlend + blendDelta);
    } else {
      this.fpBlend = Math.max(fpTarget, this.fpBlend - blendDelta);
    }
  }

  private updateChase(dt: number, bikes: Bike[]): void {
    // Follow the local player's bike, or first alive, or first
    const target = bikes[this.localBikeIndex]?.alive
      ? bikes[this.localBikeIndex]
      : (bikes.find((b) => b.alive) || bikes[0]);
    if (!target) return;

    // Smooth drift blend transition
    const driftTarget = target.drifting ? 1 : 0;
    const driftBlendSpeed = target.drifting ? 3 : 2;
    this.driftBlend += (driftTarget - this.driftBlend) * (1 - Math.exp(-driftBlendSpeed * dt));

    const pos = target.renderPosition;
    const q = target.orientationQuat;

    // Use surface normal as "up" when grounded, world up when airborne
    const up: Vec3 = target.grounded
      ? target.surfaceNormal
      : { x: 0, y: 1, z: 0 };

    // Bike forward direction from orientation quaternion
    const fwd = quatRotateVec3(q, { x: 0, y: 0, z: 1 });

    // Right vector (perpendicular to forward and up)
    const right = vec3NormalizeSafe({
      x: fwd.y * up.z - fwd.z * up.y,
      y: fwd.z * up.x - fwd.x * up.z,
      z: fwd.x * up.y - fwd.y * up.x,
    });

    // Apply orbit offset: rotate behind direction around surface normal
    const cosO = Math.cos(this.orbitOffset);
    const sinO = Math.sin(this.orbitOffset);
    // Behind = -fwd, then orbited around up axis
    const behindX = -fwd.x * cosO + right.x * sinO;
    const behindY = -fwd.y * cosO + right.y * sinO;
    const behindZ = -fwd.z * cosO + right.z * sinO;

    const distance = CHASE_DISTANCE + DRIFT_EXTRA_DISTANCE * this.driftBlend;

    // Chase camera: behind + above (along surface normal)
    const chasePosX = pos.x + behindX * distance + up.x * CHASE_HEIGHT;
    const chasePosY = pos.y + behindY * distance + up.y * CHASE_HEIGHT;
    const chasePosZ = pos.z + behindZ * distance + up.z * CHASE_HEIGHT;
    // Look at: bike + slight offset along up
    const chaseLookAt = new THREE.Vector3(
      pos.x + up.x, pos.y + up.y, pos.z + up.z,
    );

    // First person position: at bike + forward offset + up offset
    const fpPosX = pos.x + fwd.x * FP_FORWARD_OFFSET + up.x * FP_HEIGHT;
    const fpPosY = pos.y + fwd.y * FP_FORWARD_OFFSET + up.y * FP_HEIGHT;
    const fpPosZ = pos.z + fwd.z * FP_FORWARD_OFFSET + up.z * FP_HEIGHT;
    // Look far ahead (with orbit offset for panning)
    const lookFwdX = fwd.x * cosO + right.x * sinO;
    const lookFwdY = fwd.y * cosO + right.y * sinO;
    const lookFwdZ = fwd.z * cosO + right.z * sinO;
    const lookDist = 50;
    const fpLookAt = new THREE.Vector3(
      pos.x + lookFwdX * lookDist + up.x * FP_HEIGHT * 0.8,
      pos.y + lookFwdY * lookDist + up.y * FP_HEIGHT * 0.8,
      pos.z + lookFwdZ * lookDist + up.z * FP_HEIGHT * 0.8,
    );

    // Blend between chase and first person
    const t = this.fpBlend;
    this.targetPosition.set(
      chasePosX + (fpPosX - chasePosX) * t,
      chasePosY + (fpPosY - chasePosY) * t,
      chasePosZ + (fpPosZ - chasePosZ) * t,
    );
    this.targetLookAt.set(
      chaseLookAt.x + (fpLookAt.x - chaseLookAt.x) * t,
      chaseLookAt.y + (fpLookAt.y - chaseLookAt.y) * t,
      chaseLookAt.z + (fpLookAt.z - chaseLookAt.z) * t,
    );

    // Faster position lerp during drift to keep up with large rotations
    const lerpSpeed = THREE.MathUtils.lerp(CHASE_LERP, CHASE_LERP_DRIFT, this.driftBlend);
    const lerpFactor = 1 - Math.exp(-lerpSpeed * dt);
    this.camera.position.lerp(this.targetPosition, lerpFactor);

    // Smooth lookAt to prevent orientation snaps on drift start/end
    if (!this.lookAtInitialized) {
      this.currentLookAt.copy(this.targetLookAt);
      this.lookAtInitialized = true;
    } else {
      this.currentLookAt.lerp(this.targetLookAt, lerpFactor);
    }
    this.camera.lookAt(this.currentLookAt);
  }

  private updateOverview(dt: number, bikes: Bike[]): void {
    const aliveBikes = bikes.filter((b) => b.alive);
    const targets = aliveBikes.length > 0 ? aliveBikes : bikes;

    // Compute bounding box of targets
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const bike of targets) {
      minX = Math.min(minX, bike.position.x);
      maxX = Math.max(maxX, bike.position.x);
      minZ = Math.min(minZ, bike.position.z);
      maxZ = Math.max(maxZ, bike.position.z);
    }

    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const spanX = maxX - minX + OVERVIEW_PADDING * 2;
    const spanZ = maxZ - minZ + OVERVIEW_PADDING * 2;
    const span = Math.max(spanX, spanZ, 60);

    // Camera height based on spread
    const height = Math.max(span * 0.9, 40);

    this.targetPosition.set(centerX, height, centerZ + span * 0.3);
    this.targetLookAt.set(centerX, 0, centerZ);

    const lerpFactor = 1 - Math.exp(-OVERVIEW_LERP * dt);
    this.camera.position.lerp(this.targetPosition, lerpFactor);
    this.camera.lookAt(this.targetLookAt);
  }
}
