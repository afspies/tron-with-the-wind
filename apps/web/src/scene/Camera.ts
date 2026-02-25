import * as THREE from 'three';
import { Bike } from '../game/Bike';

const CHASE_DISTANCE = 12;
const CHASE_HEIGHT = 8;
const CHASE_LERP = 3;

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

  // Camera control state
  private orbitOffset = 0;      // current orbit angle offset (radians)
  private firstPerson = false;
  private fpBlend = 0;          // 0 = chase, 1 = first person
  private keys = new Set<string>();
  private sPressed = false;     // edge-detect for S toggle

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
    // Q/E orbit
    const panLeft = this.keys.has('KeyQ');
    const panRight = this.keys.has('KeyE');

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

    // S toggle first person (edge-detect)
    const sDown = this.keys.has('KeyS');
    if (sDown && !this.sPressed) {
      this.firstPerson = !this.firstPerson;
    }
    this.sPressed = sDown;

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

    const pos = target.renderPosition;
    const ang = target.renderAngle;
    const orbitAngle = ang + this.orbitOffset;

    // Chase camera position (third person)
    const chasePosX = pos.x - Math.sin(orbitAngle) * CHASE_DISTANCE;
    const chasePosZ = pos.z - Math.cos(orbitAngle) * CHASE_DISTANCE;
    const chasePosY = CHASE_HEIGHT + pos.y * 0.5;
    const chaseLookAt = new THREE.Vector3(pos.x, pos.y + 1, pos.z);

    // First person position
    const fpPosX = pos.x + Math.sin(ang) * FP_FORWARD_OFFSET;
    const fpPosZ = pos.z + Math.cos(ang) * FP_FORWARD_OFFSET;
    const fpPosY = pos.y + FP_HEIGHT;
    // Look far ahead in bike direction (with orbit offset for panning in FP)
    const lookDist = 50;
    const fpLookAngle = ang + this.orbitOffset;
    const fpLookAt = new THREE.Vector3(
      pos.x + Math.sin(fpLookAngle) * lookDist,
      pos.y + FP_HEIGHT * 0.8,
      pos.z + Math.cos(fpLookAngle) * lookDist,
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

    const lerpFactor = 1 - Math.exp(-CHASE_LERP * dt);
    this.camera.position.lerp(this.targetPosition, lerpFactor);
    this.camera.lookAt(this.targetLookAt);
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
