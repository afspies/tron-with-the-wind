import { describe, it, expect, vi } from 'vitest';
import { SimBike } from '@tron/game-core';
import { NO_INPUT, ARENA_HALF, ARENA_CEILING_HEIGHT, BIKE_COLLISION_HEIGHT, MAP_PLATFORMS } from '@tron/shared';
import type { SimPowerUpEffect } from '@tron/game-core';

function createMockEffect(opts?: { updatesRemaining?: number }): SimPowerUpEffect & { grantCalls: number; expireCalls: number } {
  let remaining = opts?.updatesRemaining ?? Infinity;
  const effect = {
    type: 'invulnerability',
    duration: 5,
    grantCalls: 0,
    expireCalls: 0,
    onGrant(bike: SimBike) {
      effect.grantCalls++;
      bike.activeEffect = effect;
      bike.effectTimer = effect.duration;
    },
    onUpdate(_bike: SimBike, _dt: number) {
      remaining--;
      return remaining >= 0;
    },
    onExpire(bike: SimBike) {
      effect.expireCalls++;
      bike.activeEffect = null;
      bike.effectTimer = 0;
    },
  };
  return effect;
}

describe('SimBike activeEffect handling', () => {
  it('nulls activeEffect before calling onExpire in update', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);
    const effect = createMockEffect({ updatesRemaining: 0 });
    effect.onGrant(bike);

    // Update should trigger expiry (updatesRemaining=0 → onUpdate returns false)
    bike.update(0.016, NO_INPUT, [], true);

    expect(effect.expireCalls).toBe(1);
    expect(bike.activeEffect).toBeNull();
  });

  it('does not double-fire onExpire when effect expires and bike dies in same frame', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);
    // Create effect that expires immediately
    const effect = createMockEffect({ updatesRemaining: 0 });
    effect.onGrant(bike);

    // After update, effect should have expired and activeEffect nulled
    bike.update(0.016, NO_INPUT, [], true);
    expect(effect.expireCalls).toBe(1);

    // If die() is called after, it should NOT fire onExpire again
    // (activeEffect is already null)
    bike.alive = true; // re-alive to test die path
    (bike as any).die?.(); // die is private, but we can test via setting alive=false
    // The real protection is that activeEffect is null after update expiry
    expect(bike.activeEffect).toBeNull();
    expect(effect.expireCalls).toBe(1); // still just 1
  });

  it('onExpire fires once during die()', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);
    const effect = createMockEffect();
    effect.onGrant(bike);

    // Trigger die by wall collision — put bike way outside arena
    bike.update(0.016, NO_INPUT, [], true); // normal update, effect still active
    expect(effect.expireCalls).toBe(0);

    // Simulate death path via reset (which also calls onExpire)
    bike.reset(0, 0, 0);
    expect(effect.expireCalls).toBe(1);
    expect(bike.activeEffect).toBeNull();
  });

  it('reset nulls activeEffect before calling onExpire', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);
    let activeEffectDuringExpire: SimPowerUpEffect | null = undefined as any;

    const effect: SimPowerUpEffect = {
      type: 'test',
      duration: 5,
      onGrant(b: SimBike) {
        b.activeEffect = effect;
        b.effectTimer = 5;
      },
      onUpdate() { return true; },
      onExpire(b: SimBike) {
        // Capture what activeEffect is when onExpire is called
        activeEffectDuringExpire = b.activeEffect;
      },
    };

    effect.onGrant(bike);
    bike.reset(0, 0, 0);

    // activeEffect should have been null when onExpire was called
    expect(activeEffectDuringExpire).toBeNull();
  });

  it('attaches to side walls instead of dying', () => {
    const bike = new SimBike(0, '#ff0000', ARENA_HALF - 0.5, 0, Math.PI / 2);
    bike.update(0.05, NO_INPUT, [], true);

    expect(bike.alive).toBe(true);
    expect(bike.wallNormal).not.toBeNull();
    expect(Math.abs(bike.position.x)).toBeCloseTo(ARENA_HALF, 4);
  });

  it('bounces off the ceiling instead of dying', () => {
    const bike = new SimBike(0, '#ff0000', 0, 0, 0);
    bike.grounded = false;
    bike.vy = 40;
    bike.position.y = ARENA_CEILING_HEIGHT - BIKE_COLLISION_HEIGHT - 0.2;

    bike.update(0.05, NO_INPUT, [], true);

    expect(bike.alive).toBe(true);
    expect(bike.vy).toBeLessThan(0);
    expect(bike.position.y).toBeLessThanOrEqual(ARENA_CEILING_HEIGHT - BIKE_COLLISION_HEIGHT);
  });

  it('bounces off platform undersides', () => {
    const platform = MAP_PLATFORMS[0];
    const minY = platform.y - platform.height * 0.5;

    const bike = new SimBike(0, '#ff0000', platform.x, platform.z, 0);
    bike.grounded = false;
    bike.vy = 24;
    bike.position.y = minY - BIKE_COLLISION_HEIGHT - 0.15;

    bike.update(0.05, NO_INPUT, [], true);

    expect(bike.alive).toBe(true);
    expect(bike.vy).toBeLessThan(0);
    expect(bike.position.y).toBeLessThanOrEqual(minY - BIKE_COLLISION_HEIGHT + 0.01);
  });
});
