import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock THREE.js
vi.mock('three', () => ({
  Color: class { setHSL() { return this; } copy() {} },
}));

import { createEffect, registerEffect, getRegisteredTypes } from '../powerups/PowerUpRegistry';
import { InvulnerabilityEffect } from '../powerups/InvulnerabilityEffect';

describe('PowerUpRegistry', () => {
  it('createEffect("invulnerability") returns an InvulnerabilityEffect', () => {
    const effect = createEffect('invulnerability');
    expect(effect).toBeInstanceOf(InvulnerabilityEffect);
    expect(effect!.type).toBe('invulnerability');
  });

  it('createEffect("unknown") returns null', () => {
    const effect = createEffect('unknown');
    expect(effect).toBeNull();
  });

  it('registerEffect adds new types that createEffect can resolve', () => {
    const mockEffect = {
      type: 'speed',
      duration: 3,
      onGrant: vi.fn(),
      onUpdate: vi.fn().mockReturnValue(true),
      onExpire: vi.fn(),
    };
    registerEffect('speed', () => mockEffect);
    const effect = createEffect('speed');
    expect(effect).toBe(mockEffect);
    expect(effect!.type).toBe('speed');
  });

  it('getRegisteredTypes lists registered types', () => {
    const types = getRegisteredTypes();
    expect(types).toContain('invulnerability');
  });
});
