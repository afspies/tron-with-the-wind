import { describe, expect, it } from 'vitest';
import {
  fromTrailPointWire,
  packPlayerInput,
  toTrailPointWire,
  unpackPlayerInput,
  type PlayerInput,
} from '@tron/shared';

describe('netcode helpers', () => {
  it('round-trips every player input button through a bitmask', () => {
    const input: PlayerInput = {
      left: true,
      right: true,
      jump: true,
      boost: true,
      drift: true,
      pitchUp: true,
      pitchDown: true,
    };

    expect(unpackPlayerInput(packPlayerInput(input))).toEqual(input);
  });

  it('encodes trail gaps without sending NaN coordinates', () => {
    const wire = toTrailPointWire({ x: NaN, y: NaN, z: NaN });

    expect(wire).toEqual({ x: 0, y: 0, z: 0, gap: true });
    expect(fromTrailPointWire(wire)).toEqual({ x: NaN, y: NaN, z: NaN });
  });
});
