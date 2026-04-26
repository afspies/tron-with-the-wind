import {
  NET_TICK_DURATION_MS,
  SNAPSHOT_INTERPOLATION_TICKS,
  SNAPSHOT_MAX_EXTRAPOLATION_TICKS,
  extrapolateBikeSnapshot,
  interpolateBikeSnapshot,
  type BikeSnapshot,
  type GameSnapshot,
  type InterpolatedSnapshot,
} from '@tron/shared';

const MAX_BUFFERED_SNAPSHOTS = 12;

export class SnapshotBuffer {
  private snapshots: GameSnapshot[] = [];
  private renderTick = 0;
  private initialized = false;

  addSnapshot(snapshot: GameSnapshot): boolean {
    const newest = this.snapshots[this.snapshots.length - 1];
    if (newest && snapshot.tick < newest.tick) return false;

    const sameTick = this.snapshots.findIndex(s => s.tick === snapshot.tick);
    if (sameTick >= 0) {
      this.snapshots[sameTick] = snapshot;
    } else {
      this.snapshots.push(snapshot);
      this.snapshots.sort((a, b) => a.tick - b.tick);
    }

    while (this.snapshots.length > MAX_BUFFERED_SNAPSHOTS) {
      this.snapshots.shift();
    }

    return true;
  }

  reset(): void {
    this.snapshots = [];
    this.renderTick = 0;
    this.initialized = false;
  }

  get latest(): GameSnapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  get latestTick(): number {
    return this.latest?.tick ?? 0;
  }

  sample(dt: number): InterpolatedSnapshot | null {
    const latest = this.latest;
    if (!latest) return null;

    const targetTick = latest.tick - SNAPSHOT_INTERPOLATION_TICKS;
    if (!this.initialized) {
      this.renderTick = targetTick;
      this.initialized = true;
    } else {
      this.renderTick += dt / (NET_TICK_DURATION_MS / 1000);
      if (targetTick - this.renderTick > SNAPSHOT_INTERPOLATION_TICKS) {
        this.renderTick = targetTick;
      }
      this.renderTick = Math.min(this.renderTick, latest.tick + SNAPSHOT_MAX_EXTRAPOLATION_TICKS);
    }

    return this.sampleAt(this.renderTick);
  }

  sampleAt(renderTick: number): InterpolatedSnapshot | null {
    if (this.snapshots.length === 0) return null;

    const newest = this.snapshots[this.snapshots.length - 1]!;
    if (this.snapshots.length === 1 || renderTick >= newest.tick) {
      return this.buildInterpolated(newest, this.sampleBikesFromSingle(newest.bikes, renderTick - newest.tick), renderTick);
    }

    let older = this.snapshots[0]!;
    let newer = this.snapshots[0]!;

    for (let i = 0; i < this.snapshots.length - 1; i++) {
      const a = this.snapshots[i]!;
      const b = this.snapshots[i + 1]!;
      if (renderTick >= a.tick && renderTick <= b.tick) {
        older = a;
        newer = b;
        break;
      }
      if (renderTick > b.tick) {
        older = b;
        newer = b;
      }
    }

    if (older.tick === newer.tick) {
      return this.buildInterpolated(newer, this.sampleBikesFromSingle(newer.bikes, renderTick - newer.tick), renderTick);
    }

    const span = newer.tick - older.tick;
    const t = span > 0 ? (renderTick - older.tick) / span : 1;
    const bikes = this.interpolateBikes(older.bikes, newer.bikes, Math.max(0, Math.min(1, t)));
    return this.buildInterpolated(newer, bikes, renderTick);
  }

  private interpolateBikes(older: BikeSnapshot[], newer: BikeSnapshot[], t: number): BikeSnapshot[] {
    const newerBySlot = new Map(newer.map(b => [b.slot, b]));
    return older.map(a => {
      const b = newerBySlot.get(a.slot);
      return b ? interpolateBikeSnapshot(a, b, t) : a;
    });
  }

  private sampleBikesFromSingle(bikes: BikeSnapshot[], tickDelta: number): BikeSnapshot[] {
    if (tickDelta <= 0) return bikes.map(b => ({ ...b }));
    return bikes.map(b => extrapolateBikeSnapshot(b, tickDelta));
  }

  private buildInterpolated(source: GameSnapshot, bikes: BikeSnapshot[], tick: number): InterpolatedSnapshot {
    return {
      tick,
      latestTick: source.tick,
      bikes,
      powerUps: source.powerUps,
      scores: source.scores,
      roundNumber: source.roundNumber,
      roundsToWin: source.roundsToWin,
    };
  }
}
