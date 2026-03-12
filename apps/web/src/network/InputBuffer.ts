import type { PlayerInput } from '@tron/shared';

export interface TaggedInput {
  tick: number;
  input: PlayerInput;
}

/**
 * Ring buffer of tagged inputs for client-side prediction replay.
 * Stores the input applied at each prediction tick so reconciliation
 * can replay unacknowledged inputs after snapping to server state.
 */
export class InputBuffer {
  private buffer: TaggedInput[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 30) {
    this.maxSize = maxSize;
  }

  push(tick: number, input: PlayerInput): void {
    this.buffer.push({ tick, input });
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  /** Discard all inputs with tick <= acknowledgedTick. */
  acknowledge(acknowledgedTick: number): void {
    const idx = this.buffer.findIndex(e => e.tick > acknowledgedTick);
    if (idx < 0) {
      this.buffer.length = 0;
    } else if (idx > 0) {
      this.buffer.splice(0, idx);
    }
  }

  /** Get all unacknowledged inputs (in tick order). */
  getUnacknowledged(): readonly TaggedInput[] {
    return this.buffer;
  }

  clear(): void {
    this.buffer.length = 0;
  }

  get length(): number {
    return this.buffer.length;
  }
}
