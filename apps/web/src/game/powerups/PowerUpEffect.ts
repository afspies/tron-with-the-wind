import type { Bike } from '../Bike';

export interface PowerUpEffect {
  readonly type: string;
  readonly duration: number;
  onGrant(bike: Bike): void;
  /** Returns false when the effect has expired. */
  onUpdate(bike: Bike, dt: number): boolean;
  onExpire(bike: Bike): void;
}
