import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock THREE.js
vi.mock('three', () => {
  class MockBufferGeometry {
    attributes: Record<string, any> = {};
    setAttribute() {}
    setDrawRange() {}
    dispose() {}
  }
  class MockBufferAttribute {
    array: Float32Array;
    constructor(arr: Float32Array, _size: number) { this.array = arr; }
  }
  class MockMeshStandardMaterial { dispose() {} }
  class MockMeshBasicMaterial { dispose() {} }
  class MockPointsMaterial { dispose() {} }
  class MockGeometry {
    dispose = vi.fn();
  }
  class MockMaterial {
    dispose = vi.fn();
  }
  class MockMesh {
    frustumCulled = true;
    position = { set: vi.fn(), copy: vi.fn() };
    geometry = new MockGeometry();
    material = new MockMaterial();
    rotation = { x: 0, y: 0, z: 0 };
  }
  class MockPoints {
    frustumCulled = true;
    geometry = { attributes: { position: { needsUpdate: false } }, dispose: vi.fn() };
    material = { dispose: vi.fn() };
  }
  class MockGroup {
    position = { set: vi.fn(), copy: vi.fn() };
    add = vi.fn();
  }
  class MockPointLight {
    position = { set: vi.fn() };
    dispose = vi.fn();
  }
  class MockColor {
    setHSL() { return this; }
    copy() {}
  }
  return {
    BufferGeometry: MockBufferGeometry,
    BufferAttribute: MockBufferAttribute,
    MeshStandardMaterial: MockMeshStandardMaterial,
    MeshBasicMaterial: MockMeshBasicMaterial,
    PointsMaterial: MockPointsMaterial,
    Mesh: MockMesh,
    Points: MockPoints,
    Group: MockGroup,
    PointLight: MockPointLight,
    Color: MockColor,
    DoubleSide: 2,
    AdditiveBlending: 5,
    DodecahedronGeometry: MockGeometry,
    SphereGeometry: MockGeometry,
    BoxGeometry: MockGeometry,
    CylinderGeometry: MockGeometry,
  };
});

import { PowerUpManager } from '../PowerUpManager';
import * as THREE from 'three';
import { POWERUP_SPAWN_INTERVAL, POWERUP_SPAWN_DELAY } from '@tron/shared';

describe('PowerUpManager', () => {
  let manager: PowerUpManager;
  const mockScene = { add: vi.fn(), remove: vi.fn() } as unknown as THREE.Scene;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new PowerUpManager(mockScene);
  });

  it('starts with no power-ups', () => {
    expect(manager.allPowerUps).toHaveLength(0);
  });

  it('does not spawn before delay', () => {
    manager.reset(); // sets spawnTimer = -POWERUP_SPAWN_DELAY
    manager.update(POWERUP_SPAWN_DELAY - 0.1, 0, [], [], true, null, []);
    expect(manager.allPowerUps).toHaveLength(0);
  });

  it('spawns after delay + interval', () => {
    manager.reset();
    // Advance past the delay + one spawn interval
    manager.update(POWERUP_SPAWN_DELAY + POWERUP_SPAWN_INTERVAL + 0.1, 0, [], [], true, null, []);
    expect(manager.allPowerUps.length).toBeGreaterThanOrEqual(1);
  });

  it('does not spawn in non-authoritative mode', () => {
    manager.reset();
    manager.update(100, 0, [], [], false, null, []);
    expect(manager.allPowerUps).toHaveLength(0);
  });

  it('reset clears all state', () => {
    manager.reset();
    // Force a spawn
    manager.update(POWERUP_SPAWN_DELAY + POWERUP_SPAWN_INTERVAL + 0.1, 0, [], [], true, null, []);
    expect(manager.allPowerUps.length).toBeGreaterThanOrEqual(1);

    manager.reset();
    expect(manager.allPowerUps).toHaveLength(0);
  });

  it('handleNetEvent creates powerup on spawn event', () => {
    manager.handleNetEvent({
      type: 'powerup-spawn',
      powerupId: 42,
      powerupX: 10,
      powerupZ: 20,
      powerupType: 'invulnerability',
    }, []);
    expect(manager.allPowerUps).toHaveLength(1);
    expect(manager.allPowerUps[0].id).toBe(42);
  });

  it('handleNetEvent collects powerup on pickup event', () => {
    manager.handleNetEvent({
      type: 'powerup-spawn',
      powerupId: 1,
      powerupX: 0,
      powerupZ: 0,
      powerupType: 'invulnerability',
    }, []);
    expect(manager.allPowerUps[0].active).toBe(true);

    manager.handleNetEvent({
      type: 'powerup-pickup',
      powerupId: 1,
      bikeIndex: 0,
    }, []);
    expect(manager.allPowerUps[0].active).toBe(false);
  });
});
