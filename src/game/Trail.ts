import * as THREE from 'three';
import { TRAIL_HEIGHT, TRAIL_SAMPLE_DISTANCE, TRAIL_RAMP_SEGMENTS } from './constants';
import { TrailPoint } from '../types';

export class Trail {
  points: TrailPoint[] = [];
  mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshStandardMaterial;
  private lastSamplePos: TrailPoint | null = null;
  private maxVerts = 20000;

  constructor(color: string, scene: THREE.Scene) {
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.maxVerts * 3);
    const normals = new Float32Array(this.maxVerts * 3);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: 1.0,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  addPoint(x: number, y: number, z: number): void {
    const pos: TrailPoint = { x, y, z };

    if (this.lastSamplePos) {
      const dx = x - this.lastSamplePos.x;
      const dz = z - this.lastSamplePos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < TRAIL_SAMPLE_DISTANCE) return;
    }

    this.points.push(pos);
    this.lastSamplePos = pos;
    this.rebuildGeometry();
  }

  private rebuildGeometry(): void {
    const totalSegs = this.points.length - 1;
    this.rebuildSegments(Math.max(0, totalSegs - TRAIL_RAMP_SEGMENTS - 1));
  }

  addPoints(pts: TrailPoint[]): void {
    if (pts.length === 0) return;
    this.points.push(...pts);
    this.lastSamplePos = pts[pts.length - 1];
    this.rebuildSegments(0);
  }

  /** Replace all trail points (used for full trail resync from host) */
  replaceAll(pts: TrailPoint[]): void {
    this.points = [...pts];
    this.lastSamplePos = pts.length > 0 ? pts[pts.length - 1] : null;
    this.rebuildSegments(0);
  }

  private rebuildSegments(fromSeg: number): void {
    const pts = this.points;
    if (pts.length < 2) return;

    const totalSegs = pts.length - 1;
    if (totalSegs * 6 > this.maxVerts) return;

    const positions = this.geometry.attributes.position as THREE.BufferAttribute;
    const normals = this.geometry.attributes.normal as THREE.BufferAttribute;
    const posArr = positions.array as Float32Array;
    const normArr = normals.array as Float32Array;

    for (let i = fromSeg; i < totalSegs; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];

      const dx = p2.x - p1.x;
      const dz = p2.z - p1.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const nx = -dz / (len || 1);
      const nz = dx / (len || 1);

      // Height ramp for segments near the end (closest to bike)
      const distFromEnd1 = totalSegs - i;
      const distFromEnd2 = totalSegs - (i + 1);
      const h1 = distFromEnd1 >= TRAIL_RAMP_SEGMENTS ? TRAIL_HEIGHT : TRAIL_HEIGHT * (distFromEnd1 / TRAIL_RAMP_SEGMENTS);
      const h2 = distFromEnd2 >= TRAIL_RAMP_SEGMENTS ? TRAIL_HEIGHT : TRAIL_HEIGHT * (distFromEnd2 / TRAIL_RAMP_SEGMENTS);

      const baseIdx = i * 18;
      const verts = [
        p1.x, p1.y, p1.z,
        p1.x, p1.y + h1, p1.z,
        p2.x, p2.y + h2, p2.z,
        p1.x, p1.y, p1.z,
        p2.x, p2.y + h2, p2.z,
        p2.x, p2.y, p2.z,
      ];

      for (let j = 0; j < 18; j++) {
        posArr[baseIdx + j] = verts[j];
      }

      for (let j = 0; j < 6; j++) {
        normArr[baseIdx + j * 3] = nx;
        normArr[baseIdx + j * 3 + 1] = 0;
        normArr[baseIdx + j * 3 + 2] = nz;
      }
    }

    positions.needsUpdate = true;
    normals.needsUpdate = true;
    this.geometry.setDrawRange(0, totalSegs * 6);
  }

  /** Delete trail points within radius of (cx, cz). Returns count removed. */
  deleteSegmentsInRadius(cx: number, cz: number, radius: number): number {
    const r2 = radius * radius;
    const before = this.points.length;
    this.points = this.points.filter(p => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      return dx * dx + dz * dz > r2;
    });
    const removed = before - this.points.length;
    if (removed > 0) {
      this.lastSamplePos = this.points.length > 0 ? this.points[this.points.length - 1] : null;
      this.rebuildSegments(0);
      // Fix draw range for < 2 points
      if (this.points.length < 2) {
        this.geometry.setDrawRange(0, 0);
      }
    }
    return removed;
  }

  reset(): void {
    this.points = [];
    this.lastSamplePos = null;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
