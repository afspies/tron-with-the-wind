import * as THREE from 'three';
import { PowerUp, PowerUpType, generateSpawnPosition } from './powerups/PowerUp';
import type { Bike } from './Bike';
import type { Trail } from './Trail';
import { POWERUP_SPAWN_INTERVAL, POWERUP_SPAWN_DELAY, POWERUP_MAX_ACTIVE, TRAIL_DESTROY_RADIUS } from '@tron/shared';
import type { PowerUpSnapshot } from '@tron/shared';
import type { PowerUpEvent } from '@tron/game-core';

export class PowerUpManager {
  private powerUps: PowerUp[] = [];
  private nextPowerUpId = 0;
  private spawnTimer = 0;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** All power-ups (for minimap etc.) */
  get allPowerUps(): PowerUp[] {
    return this.powerUps;
  }

  /**
   * Run full update: visuals, spawn, pickup, trail destruction.
   * `broadcastEvent` is called for any events that need network broadcast (host only).
   * `lastBroadcastTrailLen` is updated when trail destruction occurs.
   */
  update(
    dt: number,
    elapsedTime: number,
    bikes: Bike[],
    trails: Trail[],
    isAuthoritative: boolean,
    broadcastEvent: ((event: PowerUpEvent) => void) | null,
    lastBroadcastTrailLen: number[],
  ): void {
    // Update visuals (all modes)
    for (const pu of this.powerUps) {
      if (pu.active) pu.update(dt, elapsedTime);
    }

    if (!isAuthoritative) return;

    // Spawn timer
    this.spawnTimer += dt;
    const activeCount = this.powerUps.filter(p => p.active).length;
    if (activeCount < POWERUP_MAX_ACTIVE && this.spawnTimer >= POWERUP_SPAWN_INTERVAL) {
      this.spawnTimer = 0;
      this.spawn(broadcastEvent);
    }

    // Pickup check
    for (const bike of bikes) {
      if (!bike.alive) continue;
      for (const pu of this.powerUps) {
        if (!pu.active) continue;
        if (pu.checkPickup(bike.position.x, bike.position.z)) {
          pu.collect();
          bike.grantInvulnerability();

          if (broadcastEvent) {
            broadcastEvent({
              type: 'powerup-pickup',
              powerupId: pu.id,
              bikeIndex: bike.playerIndex,
              powerupType: pu.type,
            });
          }
          break;
        }
      }
    }

    // Trail destruction from invulnerable bikes
    for (const bike of bikes) {
      if (bike.lastTrailDestruction) {
        const hit = bike.lastTrailDestruction;
        bike.lastTrailDestruction = null;

        if (broadcastEvent) {
          broadcastEvent({
            type: 'trail-destroy',
            trailIndex: hit.trailIndex,
            destroyX: hit.contactX,
            destroyZ: hit.contactZ,
            destroyRadius: TRAIL_DESTROY_RADIUS,
          });
        }

        // Reset trail broadcast tracking for the affected trail
        if (lastBroadcastTrailLen[hit.trailIndex] !== undefined) {
          lastBroadcastTrailLen[hit.trailIndex] = trails[hit.trailIndex]?.points.length ?? 0;
        }
      }
    }
  }

  private spawn(broadcastEvent: ((event: PowerUpEvent) => void) | null): void {
    const pos = generateSpawnPosition();
    const id = this.nextPowerUpId++;
    const puType: PowerUpType = 'invulnerability';
    const pu = new PowerUp(id, puType, pos.x, pos.z, this.scene);
    this.powerUps.push(pu);

    if (broadcastEvent) {
      broadcastEvent({
        type: 'powerup-spawn',
        powerupId: id,
        powerupX: pos.x,
        powerupZ: pos.z,
        powerupType: puType,
      });
    }
  }

  handleNetEvent(event: PowerUpEvent, bikes: Bike[]): void {
    switch (event.type) {
      case 'powerup-spawn':
        if (event.powerupX != null && event.powerupZ != null && event.powerupId != null) {
          if (this.powerUps.some(p => p.id === event.powerupId && p.active)) return;
          const puType = (event.powerupType as PowerUpType) || 'invulnerability';
          const pu = new PowerUp(event.powerupId, puType, event.powerupX, event.powerupZ, this.scene);
          this.powerUps.push(pu);
        }
        break;

      case 'powerup-pickup':
        if (event.powerupId != null) {
          const pu = this.powerUps.find(p => p.id === event.powerupId);
          if (pu?.active) pu.collect();
        }
        if (event.bikeIndex != null) {
          const bike = bikes.find(b => b.playerIndex === event.bikeIndex);
          if (bike) {
            bike.grantInvulnerability();
          }
        }
        break;
    }
  }

  syncFromSnapshot(powerUps: PowerUpSnapshot[]): void {
    const activeIds = new Set(powerUps.filter(p => p.active).map(p => p.id));

    for (const pu of this.powerUps) {
      if (pu.active && !activeIds.has(pu.id)) {
        pu.collect();
      }
    }

    this.powerUps = this.powerUps.filter((pu) => {
      if (pu.active) return true;
      pu.dispose();
      return false;
    });

    for (const snapshot of powerUps) {
      if (!snapshot.active) continue;
      if (this.powerUps.some(p => p.id === snapshot.id && p.active)) continue;
      const puType = (snapshot.type as PowerUpType) || 'invulnerability';
      this.powerUps.push(new PowerUp(snapshot.id, puType, snapshot.x, snapshot.z, this.scene));
    }
  }

  forceSpawn(x: number, z: number): void {
    const id = this.nextPowerUpId++;
    const puType: PowerUpType = 'invulnerability';
    const pu = new PowerUp(id, puType, x, z, this.scene);
    this.powerUps.push(pu);
  }

  reset(): void {
    this.dispose();
    this.spawnTimer = -POWERUP_SPAWN_DELAY;
  }

  dispose(): void {
    for (const pu of this.powerUps) {
      pu.dispose();
    }
    this.powerUps = [];
    this.nextPowerUpId = 0;
    this.spawnTimer = 0;
  }
}
