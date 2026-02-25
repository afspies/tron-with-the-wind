import type { TrailPoint } from '@tron/shared';
import { TRAIL_SAMPLE_DISTANCE } from '@tron/shared';

export class SimTrail {
  points: TrailPoint[] = [];
  private lastSamplePos: TrailPoint | null = null;

  addPoint(x: number, y: number, z: number): void {
    if (this.lastSamplePos) {
      const dx = x - this.lastSamplePos.x;
      const dy = y - this.lastSamplePos.y;
      const dz = z - this.lastSamplePos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < TRAIL_SAMPLE_DISTANCE) return;
    }

    const point: TrailPoint = { x, y, z };
    this.points.push(point);
    this.lastSamplePos = point;
  }

  addPoints(pts: TrailPoint[]): void {
    this.points.push(...pts);
    if (pts.length > 0) {
      this.lastSamplePos = pts[pts.length - 1];
    }
  }

  replaceAll(pts: TrailPoint[]): void {
    this.points = [...pts];
    this.lastSamplePos = pts.length > 0 ? pts[pts.length - 1] : null;
  }

  deleteSegmentsInRadius(cx: number, cz: number, radius: number): void {
    const r2 = radius * radius;
    const result: TrailPoint[] = [];
    let removedAny = false;
    for (const p of this.points) {
      if (isNaN(p.x)) {
        // Preserve existing gap markers
        result.push(p);
        removedAny = false;
        continue;
      }
      const dx = p.x - cx;
      const dz = p.z - cz;
      if (dx * dx + dz * dz <= r2) {
        removedAny = true;
      } else {
        if (removedAny && result.length > 0) {
          result.push({ x: NaN, y: NaN, z: NaN });
        }
        result.push(p);
        removedAny = false;
      }
    }
    this.points = result;
    this.lastSamplePos = result.length > 0 ? result[result.length - 1] : null;
  }

  reset(): void {
    this.points = [];
    this.lastSamplePos = null;
  }
}
