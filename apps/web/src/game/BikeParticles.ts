import * as THREE from 'three';
import { TRAIL_HEIGHT, GRAVITY } from '@tron/shared';

export class TrailParticles {
  private points: THREE.Points;
  private positions: Float32Array;
  private speeds: Float32Array;
  private lifetimes: Float32Array;
  private maxParticles = 50;

  constructor(color: string, scene: THREE.Scene) {
    this.positions = new Float32Array(this.maxParticles * 3);
    this.speeds = new Float32Array(this.maxParticles * 3);
    this.lifetimes = new Float32Array(this.maxParticles);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(color),
      size: 0.3,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number, bikeX: number, bikeY: number, bikeZ: number, bikeAngle: number, grounded: boolean, flying = false): void {
    const posArr = this.positions;
    const spdArr = this.speeds;
    const lifeArr = this.lifetimes;

    // Update existing
    for (let i = 0; i < this.maxParticles; i++) {
      if (lifeArr[i] > 0) {
        lifeArr[i] -= dt;
        posArr[i * 3] += spdArr[i * 3] * dt;
        posArr[i * 3 + 1] += spdArr[i * 3 + 1] * dt;
        posArr[i * 3 + 2] += spdArr[i * 3 + 2] * dt;
      }
    }

    // Spawn new at bike rear
    if (flying || grounded || bikeY < 1) {
      for (let i = 0; i < this.maxParticles; i++) {
        if (lifeArr[i] <= 0) {
          const rear = -1.0;
          const rx = bikeX - Math.sin(bikeAngle) * rear;
          const rz = bikeZ - Math.cos(bikeAngle) * rear;
          posArr[i * 3] = rx + (Math.random() - 0.5) * 0.5;
          posArr[i * 3 + 2] = rz + (Math.random() - 0.5) * 0.5;
          if (flying) {
            // Exhaust plume: spawn behind + below, high velocity away
            posArr[i * 3 + 1] = bikeY - 0.3 + (Math.random() - 0.5) * 0.5;
            spdArr[i * 3] = -Math.sin(bikeAngle) * 5 + (Math.random() - 0.5) * 2;
            spdArr[i * 3 + 1] = -3 + Math.random() * 2;
            spdArr[i * 3 + 2] = -Math.cos(bikeAngle) * 5 + (Math.random() - 0.5) * 2;
            lifeArr[i] = 0.2 + Math.random() * 0.4;
          } else {
            posArr[i * 3 + 1] = Math.random() * TRAIL_HEIGHT;
            spdArr[i * 3] = (Math.random() - 0.5) * 2;
            spdArr[i * 3 + 1] = Math.random() * 3;
            spdArr[i * 3 + 2] = (Math.random() - 0.5) * 2;
            lifeArr[i] = 0.3 + Math.random() * 0.5;
          }
          break; // one per frame
        }
      }
    }

    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.PointsMaterial).dispose();
  }
}

export class DriftParticles {
  private points: THREE.Points;
  private positions: Float32Array;
  private speeds: Float32Array;
  private lifetimes: Float32Array;
  private maxParticles = 30;

  constructor(color: string, scene: THREE.Scene) {
    this.positions = new Float32Array(this.maxParticles * 3);
    this.speeds = new Float32Array(this.maxParticles * 3);
    this.lifetimes = new Float32Array(this.maxParticles);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(0xffaa33),
      size: 0.25,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number, bikeX: number, bikeY: number, bikeZ: number, bikeAngle: number, grounded: boolean, drifting: boolean): void {
    const posArr = this.positions;
    const spdArr = this.speeds;
    const lifeArr = this.lifetimes;

    // Update existing
    for (let i = 0; i < this.maxParticles; i++) {
      if (lifeArr[i] > 0) {
        lifeArr[i] -= dt;
        posArr[i * 3] += spdArr[i * 3] * dt;
        posArr[i * 3 + 1] += spdArr[i * 3 + 1] * dt;
        posArr[i * 3 + 2] += spdArr[i * 3 + 2] * dt;
      }
    }

    // Spawn sparks from bike sides when drifting + grounded
    if (drifting && grounded) {
      const perpX = Math.cos(bikeAngle);
      const perpZ = -Math.sin(bikeAngle);
      let spawned = 0;
      for (let i = 0; i < this.maxParticles && spawned < 2; i++) {
        if (lifeArr[i] <= 0) {
          const side = spawned === 0 ? 1 : -1;
          posArr[i * 3] = bikeX + perpX * side * 0.5 + (Math.random() - 0.5) * 0.3;
          posArr[i * 3 + 1] = bikeY + Math.random() * 0.3;
          posArr[i * 3 + 2] = bikeZ + perpZ * side * 0.5 + (Math.random() - 0.5) * 0.3;
          spdArr[i * 3] = perpX * side * (3 + Math.random() * 4);
          spdArr[i * 3 + 1] = Math.random() * 2;
          spdArr[i * 3 + 2] = perpZ * side * (3 + Math.random() * 4);
          lifeArr[i] = 0.2 + Math.random() * 0.2;
          spawned++;
        }
      }
    }

    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.PointsMaterial).dispose();
  }
}

export class DeathParticles {
  private points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private lifetimes: Float32Array;
  private maxParticles = 80;

  constructor(color: string, x: number, y: number, z: number, scene: THREE.Scene) {
    this.positions = new Float32Array(this.maxParticles * 3);
    this.velocities = new Float32Array(this.maxParticles * 3);
    this.lifetimes = new Float32Array(this.maxParticles);

    for (let i = 0; i < this.maxParticles; i++) {
      this.positions[i * 3] = x + (Math.random() - 0.5) * 2;
      this.positions[i * 3 + 1] = y + Math.random() * 2;
      this.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 2;
      this.velocities[i * 3] = (Math.random() - 0.5) * 20;
      this.velocities[i * 3 + 1] = Math.random() * 15;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 20;
      this.lifetimes[i] = 0.5 + Math.random() * 1.0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color(color),
      size: 0.5,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt: number): void {
    let allDead = true;
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.lifetimes[i] > 0) {
        allDead = false;
        this.lifetimes[i] -= dt;
        this.positions[i * 3] += this.velocities[i * 3] * dt;
        this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
        this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
        this.velocities[i * 3 + 1] -= GRAVITY * dt;
      }
    }

    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = allDead ? 0 : 0.8;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.points);
    this.points.geometry.dispose();
    (this.points.material as THREE.PointsMaterial).dispose();
  }
}
