import * as THREE from 'three';
import { ARENA_HALF, POWERUP_PICKUP_RADIUS } from '../constants';

export type PowerUpType = 'invulnerability';

export class PowerUp {
  id: number;
  type: PowerUpType;
  mesh: THREE.Group;
  active = true;
  readonly x: number;
  readonly z: number;

  private coreMesh: THREE.Mesh;
  private glowMesh: THREE.Mesh;
  private light: THREE.PointLight;
  private scene: THREE.Scene;

  constructor(id: number, type: PowerUpType, x: number, z: number, scene: THREE.Scene) {
    this.id = id;
    this.type = type;
    this.x = x;
    this.z = z;
    this.scene = scene;

    this.mesh = new THREE.Group();
    this.mesh.position.set(x, 1.0, z);

    const coreGeo = new THREE.DodecahedronGeometry(0.6, 0);
    const baseColor = 0xffff00;
    const coreMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: baseColor,
      emissiveIntensity: 1.5,
      metalness: 0.8,
      roughness: 0.1,
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.mesh.add(this.coreMesh);

    // Outer glow sphere
    const glowGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: baseColor,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glowMesh = new THREE.Mesh(glowGeo, glowMat);
    this.mesh.add(this.glowMesh);

    // Point light
    this.light = new THREE.PointLight(baseColor, 3, 20);
    this.mesh.add(this.light);

    scene.add(this.mesh);
  }

  update(_dt: number, elapsed: number): void {
    if (!this.active) return;

    // Spin
    this.coreMesh.rotation.y = elapsed * 2.0;
    this.coreMesh.rotation.x = elapsed * 1.3;

    // Bob
    this.mesh.position.y = 1.0 + Math.sin(elapsed * 3) * 0.3;

    // Rainbow color cycle
    const hue = (elapsed * 0.5) % 1.0;
    const color = new THREE.Color().setHSL(hue, 1.0, 0.5);
    (this.coreMesh.material as THREE.MeshStandardMaterial).color.copy(color);
    (this.coreMesh.material as THREE.MeshStandardMaterial).emissive.copy(color);
    (this.glowMesh.material as THREE.MeshBasicMaterial).color.copy(color);
    this.light.color.copy(color);
  }

  checkPickup(bikeX: number, bikeZ: number): boolean {
    if (!this.active) return false;
    const dx = bikeX - this.x;
    const dz = bikeZ - this.z;
    return dx * dx + dz * dz < POWERUP_PICKUP_RADIUS * POWERUP_PICKUP_RADIUS;
  }

  collect(): void {
    this.active = false;
    this.scene.remove(this.mesh);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.coreMesh.geometry.dispose();
    (this.coreMesh.material as THREE.Material).dispose();
    this.glowMesh.geometry.dispose();
    (this.glowMesh.material as THREE.Material).dispose();
    this.light.dispose();
  }
}

export function generateSpawnPosition(): { x: number; z: number } {
  const margin = 15;
  const minCenter = 10;
  const range = ARENA_HALF - margin;

  for (let attempt = 0; attempt < 50; attempt++) {
    const x = (Math.random() * 2 - 1) * range;
    const z = (Math.random() * 2 - 1) * range;
    if (Math.abs(x) > minCenter || Math.abs(z) > minCenter) {
      return { x, z };
    }
  }
  // Fallback
  return { x: range * 0.5, z: range * 0.5 };
}
