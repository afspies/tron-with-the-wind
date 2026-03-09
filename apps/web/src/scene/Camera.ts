import * as THREE from 'three';
import { SurfaceType } from '@tron/shared';
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
  private cameraUp = new THREE.Vector3(0, 1, 0); // lerps toward surfaceNormal

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
    const ang = target.renderAngle;
    const sn = target.surfaceNormal;
    const isOnSurface = target.surfaceType !== SurfaceType.Air && target.grounded;
    const isNonFlat = isOnSurface && sn.y < 0.99;

    // Lerp camera up toward surface normal (use world up for air)
    const targetUp = isOnSurface
      ? new THREE.Vector3(sn.x, sn.y, sn.z)
      : new THREE.Vector3(0, 1, 0);
    this.cameraUp.lerp(targetUp, 1 - Math.exp(-5 * dt));
    this.cameraUp.normalize();

    if (isNonFlat) {
      // Non-flat surface: position behind bike along -forward, offset along surface normal
      const fwd = new THREE.Vector3(target.forward.x, target.forward.y, target.forward.z).normalize();
      const normal = new THREE.Vector3(sn.x, sn.y, sn.z);

      const distance = CHASE_DISTANCE + DRIFT_EXTRA_DISTANCE * this.driftBlend;
      // Camera behind bike (-forward * distance) + offset along normal (inward)
      const chasePos = new THREE.Vector3(
        pos.x - fwd.x * distance + normal.x * CHASE_HEIGHT,
        pos.y - fwd.y * distance + normal.y * CHASE_HEIGHT,
        pos.z - fwd.z * distance + normal.z * CHASE_HEIGHT,
      );
      // Look ahead along forward
      const lookAhead = new THREE.Vector3(
        pos.x + fwd.x * 5,
        pos.y + fwd.y * 5,
        pos.z + fwd.z * 5,
      );

      // Blend with FP
      const t = this.fpBlend;
      const fpPos = new THREE.Vector3(
        pos.x + fwd.x * FP_FORWARD_OFFSET + normal.x * FP_HEIGHT,
        pos.y + fwd.y * FP_FORWARD_OFFSET + normal.y * FP_HEIGHT,
        pos.z + fwd.z * FP_FORWARD_OFFSET + normal.z * FP_HEIGHT,
      );
      const fpLook = new THREE.Vector3(
        pos.x + fwd.x * 50,
        pos.y + fwd.y * 50,
        pos.z + fwd.z * 50,
      );

      this.targetPosition.lerpVectors(chasePos, fpPos, t);
      this.targetLookAt.lerpVectors(lookAhead, fpLook, t);
    } else {
      // Floor/Air: chase logic with orbit and altitude scaling
      const orbitAngle = ang + this.orbitOffset;
      const extraDist = Math.min(pos.y * 0.3, 8);
      const extraHeight = Math.min(pos.y * 0.6, 15);
      const distance = CHASE_DISTANCE + DRIFT_EXTRA_DISTANCE * this.driftBlend + extraDist;

      const chasePos = new THREE.Vector3(
        pos.x - Math.sin(orbitAngle) * distance,
        CHASE_HEIGHT + extraHeight + pos.y * 0.5,
        pos.z - Math.cos(orbitAngle) * distance,
      );
      const chaseLookAt = new THREE.Vector3(pos.x, pos.y + 1, pos.z);

      const fpLookAngle = ang + this.orbitOffset;
      const fpPos = new THREE.Vector3(
        pos.x + Math.sin(ang) * FP_FORWARD_OFFSET,
        pos.y + FP_HEIGHT,
        pos.z + Math.cos(ang) * FP_FORWARD_OFFSET,
      );
      const fpLookAt = new THREE.Vector3(
        pos.x + Math.sin(fpLookAngle) * 50,
        pos.y + FP_HEIGHT * 0.8,
        pos.z + Math.cos(fpLookAngle) * 50,
      );

      this.targetPosition.lerpVectors(chasePos, fpPos, this.fpBlend);
      this.targetLookAt.lerpVectors(chaseLookAt, fpLookAt, this.fpBlend);
    }

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

    // Set camera up vector before lookAt
    this.camera.up.copy(this.cameraUp);
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
