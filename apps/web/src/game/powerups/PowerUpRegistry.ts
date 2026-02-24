import type { PowerUpEffect } from './PowerUpEffect';
import { InvulnerabilityEffect } from './InvulnerabilityEffect';

const EFFECT_FACTORIES: Record<string, () => PowerUpEffect> = {
  invulnerability: () => new InvulnerabilityEffect(),
};

export function createEffect(type: string): PowerUpEffect | null {
  const factory = EFFECT_FACTORIES[type];
  return factory ? factory() : null;
}

export function registerEffect(type: string, factory: () => PowerUpEffect): void {
  EFFECT_FACTORIES[type] = factory;
}

export function getRegisteredTypes(): string[] {
  return Object.keys(EFFECT_FACTORIES);
}
