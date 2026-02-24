import type { SimBike } from '../SimBike';

export interface SimPowerUpEffect {
  readonly type: string;
  readonly duration: number;
  onGrant(bike: SimBike): void;
  onUpdate(bike: SimBike, dt: number): boolean; // returns false when expired
  onExpire(bike: SimBike): void;
}
