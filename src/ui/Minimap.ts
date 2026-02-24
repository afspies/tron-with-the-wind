import { Bike } from '../game/Bike';
import { PowerUp } from '../game/powerups/PowerUp';
import { ARENA_HALF } from '../game/constants';

const SIZE = 160;
const PADDING = 8;

export class Minimap {
  private canvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private localBikeIndex = 0;

  show(localBikeIndex = 0): void {
    this.localBikeIndex = localBikeIndex;

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'minimap-canvas';
      this.canvas.width = SIZE;
      this.canvas.height = SIZE;
      document.getElementById('hud')!.appendChild(this.canvas);
    }
    this.ctx2d = this.canvas.getContext('2d')!;
    this.canvas.style.display = 'block';
  }

  update(bikes: Bike[], powerUps: PowerUp[]): void {
    const ctx = this.ctx2d;
    if (!ctx) return;

    // Background
    ctx.fillStyle = 'rgba(10, 5, 20, 0.75)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Arena border
    const aMin = this.worldToMinimap(-ARENA_HALF, -ARENA_HALF);
    const aMax = this.worldToMinimap(ARENA_HALF, ARENA_HALF);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(aMin.mx, aMin.my, aMax.mx - aMin.mx, aMax.my - aMin.my);

    // Trails
    for (const bike of bikes) {
      const pts = bike.trail.points;
      if (pts.length < 2) continue;
      ctx.strokeStyle = bike.color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.beginPath();

      let penDown = false;
      for (let i = 0; i < pts.length; i++) {
        const p = this.worldToMinimap(pts[i].x, pts[i].z);
        if (i > 0) {
          // Skip segments with large gaps (trail destruction)
          const prev = pts[i - 1];
          const dx = pts[i].x - prev.x;
          const dz = pts[i].z - prev.z;
          if (dx * dx + dz * dz > 100) {
            // gap — lift pen
            penDown = false;
          }
        }
        if (!penDown) {
          ctx.moveTo(p.mx, p.my);
          penDown = true;
        } else {
          ctx.lineTo(p.mx, p.my);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // Power-ups
    for (const pu of powerUps) {
      if (!pu.active) continue;
      const p = this.worldToMinimap(pu.x, pu.z);
      const r = 3;
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      // Diamond shape
      ctx.moveTo(p.mx, p.my - r);
      ctx.lineTo(p.mx + r, p.my);
      ctx.lineTo(p.mx, p.my + r);
      ctx.lineTo(p.mx - r, p.my);
      ctx.closePath();
      ctx.fill();
    }

    // Bikes
    for (let i = 0; i < bikes.length; i++) {
      const bike = bikes[i];
      const p = this.worldToMinimap(bike.position.x, bike.position.z);
      const isLocal = i === this.localBikeIndex;

      if (!bike.alive) {
        // Dead: small dim dot
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = bike.color;
        ctx.beginPath();
        ctx.arc(p.mx, p.my, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        continue;
      }

      // Directional triangle
      const size = isLocal ? 5 : 4;
      const angle = -bike.renderAngle; // negate to match canvas Y-down
      ctx.save();
      ctx.translate(p.mx, p.my);
      ctx.rotate(angle);
      ctx.fillStyle = bike.color;
      ctx.beginPath();
      ctx.moveTo(0, -size);       // tip (forward)
      ctx.lineTo(-size * 0.6, size * 0.5);
      ctx.lineTo(size * 0.6, size * 0.5);
      ctx.closePath();
      ctx.fill();

      // Local player white outline
      if (isLocal) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private worldToMinimap(x: number, z: number): { mx: number; my: number } {
    const range = ARENA_HALF * 2;
    const drawArea = SIZE - PADDING * 2;
    return {
      mx: PADDING + ((x + ARENA_HALF) / range) * drawArea,
      my: PADDING + ((z + ARENA_HALF) / range) * drawArea,
    };
  }

  hide(): void {
    if (this.canvas) {
      this.canvas.style.display = 'none';
    }
  }

  dispose(): void {
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.ctx2d = null;
    }
  }
}
