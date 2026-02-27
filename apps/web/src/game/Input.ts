import type { PlayerInput } from '@tron/shared';
import { NO_INPUT } from '@tron/shared';

export type { PlayerInput };
export { NO_INPUT };

export interface KeyMapping {
  left: string[];
  right: string[];
  jump: string[];
  boost: string[];
  drift: string[];
  pitchUp: string[];
  pitchDown: string[];
}

export const DEFAULT_KEY_MAPS: KeyMapping[] = [
  { left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jump: ['Space', 'ArrowUp'], boost: ['ShiftLeft', 'ArrowDown'], drift: ['AltLeft', 'AltRight'], pitchUp: ['KeyS'], pitchDown: ['KeyW'] },
  { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['Slash'], boost: ['ShiftRight'], drift: ['Period'], pitchUp: [], pitchDown: [] },
  { left: ['KeyJ'], right: ['KeyL'], jump: ['KeyH'], boost: ['KeyU'], drift: ['KeyK'], pitchUp: [], pitchDown: [] },
  { left: ['Numpad4'], right: ['Numpad6'], jump: ['Numpad0'], boost: ['Numpad1'], drift: ['Numpad2'], pitchUp: [], pitchDown: [] },
];

const KEYBINDINGS_STORAGE_KEY = 'tron_keybindings';

function loadCustomBindings(): KeyMapping | null {
  try {
    const raw = localStorage.getItem(KEYBINDINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate shape
    const actions: (keyof KeyMapping)[] = ['left', 'right', 'jump', 'boost', 'drift', 'pitchUp', 'pitchDown'];
    for (const action of actions) {
      if (!Array.isArray(parsed[action])) return null;
    }
    return parsed as KeyMapping;
  } catch {
    return null;
  }
}

function deepCopyMapping(m: KeyMapping): KeyMapping {
  return {
    left: [...m.left],
    right: [...m.right],
    jump: [...m.jump],
    boost: [...m.boost],
    drift: [...m.drift],
    pitchUp: [...m.pitchUp],
    pitchDown: [...m.pitchDown],
  };
}

const keyMaps: KeyMapping[] = [
  loadCustomBindings() ?? deepCopyMapping(DEFAULT_KEY_MAPS[0]),
  ...DEFAULT_KEY_MAPS.slice(1),
];

export class InputManager {
  private keys = new Set<string>();
  private virtualInputs = new Map<string, boolean>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      // Prevent Alt from activating browser menu bar
      if (e.code === 'AltLeft' || e.code === 'AltRight') {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'AltLeft' || e.code === 'AltRight') {
        e.preventDefault();
      }
    });
    // Clear all keys when window loses focus (prevents stuck keys)
    window.addEventListener('blur', () => {
      this.keys.clear();
    });
  }

  static getPlayer0Bindings(): KeyMapping {
    return keyMaps[0];
  }

  static setPlayer0Bindings(mapping: KeyMapping): void {
    keyMaps[0] = mapping;
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(mapping));
  }

  static resetPlayer0Bindings(): void {
    keyMaps[0] = deepCopyMapping(DEFAULT_KEY_MAPS[0]);
    localStorage.removeItem(KEYBINDINGS_STORAGE_KEY);
  }

  getInput(playerIndex: number): PlayerInput {
    const map = keyMaps[playerIndex];
    if (!map) return NO_INPUT;

    const pressed = (action: keyof KeyMapping): boolean =>
      map[action].some((k) => this.keys.has(k)) || !!this.virtualInputs.get(action);

    return {
      left: pressed('left'),
      right: pressed('right'),
      jump: pressed('jump'),
      boost: pressed('boost'),
      drift: pressed('drift'),
      pitchUp: pressed('pitchUp'),
      pitchDown: pressed('pitchDown'),
    };
  }

  setVirtualInput(action: string, pressed: boolean): void {
    this.virtualInputs.set(action, pressed);
  }

  isKeyPressed(code: string): boolean {
    return this.keys.has(code);
  }

  isAnyKeyPressed(): boolean {
    return this.keys.size > 0;
  }

  consumeJump(playerIndex: number): void {
    const map = keyMaps[playerIndex];
    if (map) map.jump.forEach((k) => this.keys.delete(k));
  }
}
