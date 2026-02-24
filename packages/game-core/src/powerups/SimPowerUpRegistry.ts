import type { SimPowerUpEffect } from './SimPowerUpEffect';
import { SimInvulnerabilityEffect } from './SimInvulnerabilityEffect';

type EffectFactory = () => SimPowerUpEffect;

const registry = new Map<string, EffectFactory>();

// Register default effects
registry.set('invulnerability', () => new SimInvulnerabilityEffect());

export function createSimEffect(type: string): SimPowerUpEffect | null {
  const factory = registry.get(type);
  return factory ? factory() : null;
}

export function registerSimEffect(type: string, factory: EffectFactory): void {
  registry.set(type, factory);
}

export function getRegisteredSimTypes(): string[] {
  return [...registry.keys()];
}
