import * as THREE from 'three';
import { TRAIL_HEIGHT, TRAIL_SAMPLE_DISTANCE, TRAIL_RAMP_SEGMENTS } from '@tron/shared';
import type { TrailPoint } from '@tron/shared';
import { getArenaSurfaceInfo } from '@tron/game-core';

export class Trail {
  points: TrailPoint[] = [];
  mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshStandardMaterial;
  private lastSamplePos: TrailPoint | null = null;
  private liveHead: TrailPoint | null = null;
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
      const dy = y - this.lastSamplePos.y;
      const dz = z - this.lastSamplePos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < TRAIL_SAMPLE_DISTANCE) return;
    }

    this.points.push(pos);
    this.lastSamplePos = pos;
    this.rebuildGeometry();
  }

  private rebuildGeometry(): void {
    const totalSegs = this.points.length - 1;
    this.rebuildSegments(Math.max(0, totalSegs - TRAIL_RAMP_SEGMENTS - 1));
    if (this.liveHead) {
      this.rebuildTailWithLiveHead();
    }
  }

  addPoints(pts: TrailPoint[]): void {
    if (pts.length === 0) return;
    this.points.push(...pts);
    this.lastSamplePos = pts[pts.length - 1];
    this.rebuildSegments(0);
    if (this.liveHead) this.rebuildTailWithLiveHead();
  }

  /** Replace all trail points (used for full trail resync from host) */
  replaceAll(pts: TrailPoint[]): void {
    this.points = [...pts];
    this.lastSamplePos = pts.length > 0 ? pts[pts.length - 1] : null;
    this.rebuildSegments(0);
    if (this.liveHead) this.rebuildTailWithLiveHead();
  }

  /** Compute ramped trail height based on distance from the trailing end */
  private rampHeight(distFromEnd: number): number {
    if (distFromEnd >= TRAIL_RAMP_SEGMENTS) return TRAIL_HEIGHT;
    return TRAIL_HEIGHT * (distFromEnd / TRAIL_RAMP_SEGMENTS);
  }

  /** Write a single wall segment (two triangles / 6 verts) into the geometry buffers */
  private writeSegment(
    posArr: Float32Array,
    normArr: Float32Array,
    baseIdx: number,
    p1: TrailPoint,
    p2: TrailPoint,
    h1: number,
    h2: number,
  ): void {
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const nx = -dz / (len || 1);
    const nz = dx / (len || 1);

    // Two-triangle quad: bottom-left, top-left, top-right, bottom-left, top-right, bottom-right
    posArr[baseIdx]      = p1.x; posArr[baseIdx + 1]  = p1.y;      posArr[baseIdx + 2]  = p1.z;
    posArr[baseIdx + 3]  = p1.x; posArr[baseIdx + 4]  = p1.y + h1; posArr[baseIdx + 5]  = p1.z;
    posArr[baseIdx + 6]  = p2.x; posArr[baseIdx + 7]  = p2.y + h2; posArr[baseIdx + 8]  = p2.z;
    posArr[baseIdx + 9]  = p1.x; posArr[baseIdx + 10] = p1.y;      posArr[baseIdx + 11] = p1.z;
    posArr[baseIdx + 12] = p2.x; posArr[baseIdx + 13] = p2.y + h2; posArr[baseIdx + 14] = p2.z;
    posArr[baseIdx + 15] = p2.x; posArr[baseIdx + 16] = p2.y;      posArr[baseIdx + 17] = p2.z;

    for (let j = 0; j < 6; j++) {
      normArr[baseIdx + j * 3]     = nx;
      normArr[baseIdx + j * 3 + 1] = 0;
      normArr[baseIdx + j * 3 + 2] = nz;
    }
  }

  /** Write a degenerate (zero-area) segment for NaN gap markers */
  private writeDegenerateSegment(
    posArr: Float32Array,
    normArr: Float32Array,
    baseIdx: number,
  ): void {
    for (let j = 0; j < 18; j++) posArr[baseIdx + j] = 0;
    for (let j = 0; j < 18; j++) normArr[baseIdx + j] = 0;
  }

  private getBufferArrays(): { posArr: Float32Array; normArr: Float32Array; positions: THREE.BufferAttribute; normals: THREE.BufferAttribute } {
    const positions = this.geometry.attributes.position as THREE.BufferAttribute;
    const normals = this.geometry.attributes.normal as THREE.BufferAttribute;
    return {
      posArr: positions.array as Float32Array,
      normArr: normals.array as Float32Array,
      positions,
      normals,
    };
  }

  private rebuildSegments(fromSeg: number): void {
    const pts = this.points;
    if (pts.length < 2) return;

    const totalSegs = pts.length - 1;
    if (totalSegs * 6 > this.maxVerts) return;

    const { posArr, normArr, positions, normals } = this.getBufferArrays();

    for (let i = fromSeg; i < totalSegs; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const baseIdx = i * 18;

      if (isNaN(p1.x) || isNaN(p2.x)) {
        this.writeDegenerateSegment(posArr, normArr, baseIdx);
        continue;
      }

      // Height ramp for segments near the end (closest to bike)
      const distFromEnd1 = totalSegs - i;
      const distFromEnd2 = totalSegs - (i + 1);
      const h1 = distFromEnd1 >= TRAIL_RAMP_SEGMENTS ? TRAIL_HEIGHT : TRAIL_HEIGHT * (distFromEnd1 / TRAIL_RAMP_SEGMENTS);
      const h2 = distFromEnd2 >= TRAIL_RAMP_SEGMENTS ? TRAIL_HEIGHT : TRAIL_HEIGHT * (distFromEnd2 / TRAIL_RAMP_SEGMENTS);

      // Use surface normal at each point to determine extrusion direction
      // This works correctly on floor, walls, and ramps
      const surf1 = getArenaSurfaceInfo(p1 as { x: number; y: number; z: number });
      const n1 = surf1.normal;

      // Extrude along surface normal (up on floor, inward on wall, angled on ramp)
      const verts = [
        p1.x, p1.y, p1.z,
        p1.x + n1.x * h1, p1.y + n1.y * h1, p1.z + n1.z * h1,
        p2.x + n1.x * h2, p2.y + n1.y * h2, p2.z + n1.z * h2,
        p1.x, p1.y, p1.z,
        p2.x + n1.x * h2, p2.y + n1.y * h2, p2.z + n1.z * h2,
        p2.x, p2.y, p2.z,
      ];

      // Face normal: perpendicular to both the segment direction and the extrusion direction
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dz = p2.z - p1.z;
      // cross(segment_dir, surface_normal) gives face normal
      let nx = dy * n1.z - dz * n1.y;
      let ny = dz * n1.x - dx * n1.z;
      let nz = dx * n1.y - dy * n1.x;
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nLen > 0.001) { nx /= nLen; ny /= nLen; nz /= nLen; }
      else { nx = 0; ny = 0; nz = 1; }

      for (let j = 0; j < 18; j++) {
        posArr[baseIdx + j] = verts[j];
      }

      for (let j = 0; j < 6; j++) {
        normArr[baseIdx + j * 3] = nx;
        normArr[baseIdx + j * 3 + 1] = ny;
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
    const result: TrailPoint[] = [];
    let removedAny = false;
    let removedCount = 0;
    for (const p of this.points) {
      if (isNaN(p.x)) {
        result.push(p);
        removedAny = false;
        continue;
      }
      const dx = p.x - cx;
      const dz = p.z - cz;
      if (dx * dx + dz * dz <= r2) {
        removedAny = true;
        removedCount++;
      } else {
        if (removedAny && result.length > 0) {
          result.push({ x: NaN, y: NaN, z: NaN });
        }
        result.push(p);
        removedAny = false;
      }
    }
    if (removedCount > 0) {
      this.points = result;
      this.lastSamplePos = result.length > 0 ? result[result.length - 1] : null;
      this.rebuildSegments(0);
      if (this.points.length < 2) {
        this.geometry.setDrawRange(0, 0);
      }
    }
    return removedCount;
  }

  /** Efficiently sync visual trail from simulation trail points */
  syncFromSimTrail(simPoints: TrailPoint[]): void {
    const prevLen = this.points.length;

    if (simPoints.length < prevLen) {
      // Trail shrank (e.g. invulnerable destruction) — full rebuild
      this.replaceAll(simPoints);
      return;
    }

    if (simPoints.length === prevLen) return;

    // Add only new points and rebuild from just before them (for height ramp)
    const newPts = simPoints.slice(prevLen);
    this.points.push(...newPts);
    this.lastSamplePos = newPts[newPts.length - 1];
    this.rebuildSegments(Math.max(0, prevLen - 1 - TRAIL_RAMP_SEGMENTS));
    if (this.liveHead) this.rebuildTailWithLiveHead();
  }

  updateLiveHead(x: number, y: number, z: number): void {
    this.liveHead = { x, y, z };
    this.rebuildTailWithLiveHead();
  }

  clearLiveHead(): void {
    if (this.liveHead) {
      this.liveHead = null;
      // Rebuild tail segments with original heights (no live head offset)
      const totalSegs = this.points.length - 1;
      if (totalSegs > 0) {
        this.rebuildSegments(Math.max(0, totalSegs - TRAIL_RAMP_SEGMENTS));
      }
    }
  }

  private rebuildTailWithLiveHead(): void {
    if (!this.liveHead) return;
    const pts = this.points;
    if (pts.length < 1) return;

    const lastStored = pts[pts.length - 1];
    if (isNaN(lastStored.x)) return;

    const storedSegs = pts.length - 1;
    const totalWithHead = storedSegs + 1;
    if (totalWithHead * 6 > this.maxVerts) return;

    const { posArr, normArr, positions, normals } = this.getBufferArrays();

    // Rebuild ramp segments with heights shifted by +1 for the live head segment
    const startSeg = Math.max(0, storedSegs - TRAIL_RAMP_SEGMENTS);
    for (let i = startSeg; i < storedSegs; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      if (isNaN(p1.x) || isNaN(p2.x)) continue;

      const h1 = this.rampHeight(totalWithHead - i);
      const h2 = this.rampHeight(totalWithHead - (i + 1));
      this.writeSegment(posArr, normArr, i * 18, p1, p2, h1, h2);
    }

    // Live head segment: last stored point to current bike position
    this.writeSegment(
      posArr, normArr, storedSegs * 18,
      lastStored, this.liveHead,
      this.rampHeight(1), 0,
    );

    positions.needsUpdate = true;
    normals.needsUpdate = true;
    this.geometry.setDrawRange(0, totalWithHead * 6);
  }

  reset(): void {
    this.points = [];
    this.lastSamplePos = null;
    this.liveHead = null;
    this.geometry.setDrawRange(0, 0);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
