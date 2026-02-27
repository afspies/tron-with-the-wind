import { InputManager, DEFAULT_KEY_MAPS, type KeyMapping } from '../game/Input';

const KEY_DISPLAY_NAMES: Record<string, string> = {
  Space: 'Space',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  MetaLeft: 'L Meta',
  MetaRight: 'R Meta',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Enter: 'Enter',
  CapsLock: 'Caps Lock',
  Slash: '/',
  Backslash: '\\',
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Numpad0: 'Num 0',
  Numpad1: 'Num 1',
  Numpad2: 'Num 2',
  Numpad3: 'Num 3',
  Numpad4: 'Num 4',
  Numpad5: 'Num 5',
  Numpad6: 'Num 6',
  Numpad7: 'Num 7',
  Numpad8: 'Num 8',
  Numpad9: 'Num 9',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter',
};

function displayName(code: string): string {
  if (KEY_DISPLAY_NAMES[code]) return KEY_DISPLAY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

interface ActionDef {
  action: keyof KeyMapping;
  label: string;
}

const ACTIONS: ActionDef[] = [
  { action: 'left', label: 'Turn Left' },
  { action: 'right', label: 'Turn Right' },
  { action: 'jump', label: 'Jump' },
  { action: 'boost', label: 'Boost' },
  { action: 'drift', label: 'Drift' },
  { action: 'pitchUp', label: 'Pitch Up' },
  { action: 'pitchDown', label: 'Pitch Down' },
];

export class Settings {
  private el: HTMLElement;
  private bindingsEl: HTMLElement;
  private onBack: () => void;
  private listening: { action: keyof KeyMapping; slotIndex: number; cell: HTMLElement } | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(onBack: () => void) {
    this.onBack = onBack;
    this.el = document.getElementById('settings')!;
    this.bindingsEl = document.getElementById('settings-bindings')!;

    document.getElementById('btn-settings-back')!.addEventListener('click', () => {
      this.cancelListening();
      this.hide();
      this.onBack();
    });

    document.getElementById('btn-settings-reset')!.addEventListener('click', () => {
      this.cancelListening();
      InputManager.resetPlayer0Bindings();
      this.render();
    });
  }

  show(): void {
    this.render();
    this.el.style.display = 'flex';
  }

  hide(): void {
    this.cancelListening();
    this.el.style.display = 'none';
  }

  private render(): void {
    const bindings = InputManager.getPlayer0Bindings();
    this.bindingsEl.innerHTML = '';

    for (const { action, label } of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'settings-row';

      const labelEl = document.createElement('div');
      labelEl.className = 'settings-label';
      labelEl.textContent = label;
      row.appendChild(labelEl);

      // Two key slots per action
      for (let slotIndex = 0; slotIndex < 2; slotIndex++) {
        const keyCode = bindings[action][slotIndex];
        const cell = document.createElement('div');
        cell.className = 'key-cell' + (keyCode ? '' : ' empty');
        cell.textContent = keyCode ? displayName(keyCode) : '—';
        cell.addEventListener('click', () => this.startListening(action, slotIndex, cell));
        row.appendChild(cell);
      }

      this.bindingsEl.appendChild(row);
    }
  }

  private startListening(action: keyof KeyMapping, slotIndex: number, cell: HTMLElement): void {
    this.cancelListening();

    cell.classList.add('listening');
    cell.classList.remove('empty');
    cell.textContent = 'Press a key...';
    this.listening = { action, slotIndex, cell };

    this.keyListener = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        this.cancelListening();
        this.render();
        return;
      }

      this.bindKey(action, slotIndex, e.code);
    };

    // Use capture to intercept before InputManager
    window.addEventListener('keydown', this.keyListener, true);
  }

  private cancelListening(): void {
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener, true);
      this.keyListener = null;
    }
    if (this.listening) {
      this.listening.cell.classList.remove('listening');
      this.listening = null;
    }
  }

  private bindKey(action: keyof KeyMapping, slotIndex: number, code: string): void {
    const bindings = InputManager.getPlayer0Bindings();

    // Remove conflict: if this key is already bound to another action/slot, remove it
    for (const act of ACTIONS) {
      const keys = bindings[act.action];
      for (let i = keys.length - 1; i >= 0; i--) {
        if (keys[i] === code) {
          // Don't remove from the same slot we're about to set
          if (act.action === action && i === slotIndex) continue;
          keys.splice(i, 1);
        }
      }
    }

    // Set the new binding
    // Ensure the array is large enough
    while (bindings[action].length <= slotIndex) {
      bindings[action].push('');
    }
    bindings[action][slotIndex] = code;

    // Clean up empty trailing slots
    for (const act of ACTIONS) {
      while (bindings[act.action].length > 0 && bindings[act.action][bindings[act.action].length - 1] === '') {
        bindings[act.action].pop();
      }
    }

    InputManager.setPlayer0Bindings(bindings);
    this.cancelListening();
    this.render();
  }
}
