import {
  ARENA_HALF, POWERUP_PICKUP_RADIUS,
  POWERUP_SPAWN_INTERVAL, POWERUP_SPAWN_DELAY, POWERUP_MAX_ACTIVE,
  TRAIL_DESTROY_RADIUS,
} from '@tron/shared';
import type { SimBike } from './SimBike';
import type { SimTrail } from './SimTrail';

export type PowerUpType = 'invulnerability';

export interface SimPowerUp {
  id: number;
  type: PowerUpType;
  x: number;
  z: number;
  active: boolean;
}

export interface PowerUpEvent {
  type: 'powerup-spawn' | 'powerup-pickup' | 'trail-destroy';
  powerupId?: number;
  powerupX?: number;
  powerupZ?: number;
  powerupType?: string;
  bikeIndex?: number;
  trailIndex?: number;
  destroyX?: number;
  destroyZ?: number;
  destroyRadius?: number;
}

export class PowerUpSim {
  powerUps: SimPowerUp[] = [];
  private nextPowerUpId = 0;
  private spawnTimer = 0;
  update(
    dt: number,
    bikes: SimBike[],
    trails: SimTrail[],
    lastBroadcastTrailLen: number[],
  ): PowerUpEvent[] {
    const events: PowerUpEvent[] = [];

    // Spawn timer
    this.spawnTimer += dt;
    const activeCount = this.powerUps.filter(p => p.active).length;
    if (activeCount < POWERUP_MAX_ACTIVE && this.spawnTimer >= POWERUP_SPAWN_INTERVAL) {
      this.spawnTimer = 0;
      const pos = generateSpawnPosition();
      const id = this.nextPowerUpId++;
      const puType: PowerUpType = 'invulnerability';
      this.powerUps.push({ id, type: puType, x: pos.x, z: pos.z, active: true });
      events.push({
        type: 'powerup-spawn',
        powerupId: id,
        powerupX: pos.x,
        powerupZ: pos.z,
        powerupType: puType,
      });
    }

    // Pickup check
    for (const bike of bikes) {
      if (!bike.alive) continue;
      for (const pu of this.powerUps) {
        if (!pu.active) continue;
        const dx = bike.position.x - pu.x;
        const dz = bike.position.z - pu.z;
        if (dx * dx + dz * dz < POWERUP_PICKUP_RADIUS * POWERUP_PICKUP_RADIUS) {
          pu.active = false;
          bike.grantInvulnerability();
          events.push({
            type: 'powerup-pickup',
            powerupId: pu.id,
            bikeIndex: bike.playerIndex,
            powerupType: pu.type,
          });
          break;
        }
      }
    }

    // Trail destruction from invulnerable bikes
    for (const bike of bikes) {
      if (bike.lastTrailDestruction) {
        const hit = bike.lastTrailDestruction;
        bike.lastTrailDestruction = null;

        events.push({
          type: 'trail-destroy',
          trailIndex: hit.trailIndex,
          destroyX: hit.contactX,
          destroyZ: hit.contactZ,
          destroyRadius: TRAIL_DESTROY_RADIUS,
        });

        if (lastBroadcastTrailLen[hit.trailIndex] !== undefined) {
          lastBroadcastTrailLen[hit.trailIndex] = trails[hit.trailIndex]?.points.length ?? 0;
        }
      }
    }

    // Prune inactive powerups
    this.powerUps = this.powerUps.filter(p => p.active);

    return events;
  }

  reset(): void {
    this.powerUps = [];
    this.nextPowerUpId = 0;
    this.spawnTimer = -POWERUP_SPAWN_DELAY;
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
  return { x: range * 0.5, z: range * 0.5 };
}
