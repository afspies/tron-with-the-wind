import type { PlayerInput } from '@tron/shared';
import { NO_INPUT } from '@tron/shared';

export type { PlayerInput };
export { NO_INPUT };

interface KeyMapping {
  left: string;
  right: string;
  jump: string;
  boost: string;
  drift: string;
}

const KEY_MAPS: KeyMapping[] = [
  { left: 'KeyA', right: 'KeyD', jump: 'Space', boost: 'ShiftLeft', drift: 'KeyF' },
  { left: 'ArrowLeft', right: 'ArrowRight', jump: 'Slash', boost: 'ShiftRight', drift: 'Period' },
  { left: 'KeyJ', right: 'KeyL', jump: 'KeyH', boost: 'KeyU', drift: 'KeyK' },
  { left: 'Numpad4', right: 'Numpad6', jump: 'Numpad0', boost: 'Numpad1', drift: 'Numpad5' },
];

export class InputManager {
  private keys = new Set<string>();
  private virtualInputs = new Map<string, boolean>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  getInput(playerIndex: number): PlayerInput {
    const map = KEY_MAPS[playerIndex];
    if (!map) return NO_INPUT;
    return {
      left: this.keys.has(map.left) || !!this.virtualInputs.get('left'),
      right: this.keys.has(map.right) || !!this.virtualInputs.get('right'),
      jump: this.keys.has(map.jump) || !!this.virtualInputs.get('jump'),
      boost: this.keys.has(map.boost) || !!this.virtualInputs.get('boost'),
      drift: this.keys.has(map.drift) || !!this.virtualInputs.get('drift'),
    };
  }

  setVirtualInput(action: string, pressed: boolean): void {
    this.virtualInputs.set(action, pressed);
  }

  isAnyKeyPressed(): boolean {
    return this.keys.size > 0;
  }

  consumeJump(playerIndex: number): void {
    const map = KEY_MAPS[playerIndex];
    if (map) this.keys.delete(map.jump);
  }
}
