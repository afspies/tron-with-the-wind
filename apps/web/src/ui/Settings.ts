import { InputManager, type KeyMapping } from '../game/Input';

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

function formatKeyCode(code: string): string {
  if (code in KEY_DISPLAY_NAMES) return KEY_DISPLAY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

const BLOCKED_KEYS = new Set([
  'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'MetaLeft', 'MetaRight', 'ContextMenu',
]);

const ACTIONS: { action: keyof KeyMapping; label: string }[] = [
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
  private listeningCell: HTMLElement | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(onBack: () => void) {
    this.onBack = onBack;
    this.el = document.getElementById('settings')!;
    this.bindingsEl = document.getElementById('settings-bindings')!;

    document.getElementById('btn-settings-back')!.addEventListener('click', () => {
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

      for (let slotIndex = 0; slotIndex < 2; slotIndex++) {
        const keyCode = bindings[action][slotIndex];
        const cell = document.createElement('div');
        cell.className = 'key-cell' + (keyCode ? '' : ' empty');
        cell.textContent = keyCode ? formatKeyCode(keyCode) : '\u2014';
        cell.addEventListener('click', () => this.startListening(action, slotIndex, cell));
        row.appendChild(cell);
      }

      const spacer = document.createElement('div');
      spacer.className = 'settings-spacer';
      row.appendChild(spacer);

      this.bindingsEl.appendChild(row);
    }
  }

  private startListening(action: keyof KeyMapping, slotIndex: number, cell: HTMLElement): void {
    this.cancelListening();

    cell.classList.add('listening');
    cell.classList.remove('empty');
    cell.textContent = 'Press a key...';
    this.listeningCell = cell;

    this.keyListener = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        this.cancelListening();
        this.render();
        return;
      }

      if (BLOCKED_KEYS.has(e.code)) return;

      this.bindKey(action, slotIndex, e.code);
    };

    window.addEventListener('keydown', this.keyListener, true);
  }

  private cancelListening(): void {
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener, true);
      this.keyListener = null;
    }
    if (this.listeningCell) {
      this.listeningCell.classList.remove('listening');
      this.listeningCell = null;
    }
  }

  private bindKey(action: keyof KeyMapping, slotIndex: number, code: string): void {
    const bindings = InputManager.getPlayer0Bindings();

    // Remove this key from any other action/slot to prevent conflicts
    for (const act of ACTIONS) {
      const keys = bindings[act.action];
      for (let i = keys.length - 1; i >= 0; i--) {
        if (keys[i] === code && !(act.action === action && i === slotIndex)) {
          keys.splice(i, 1);
        }
      }
    }

    // Pad the array if the slot doesn't exist yet, then assign
    while (bindings[action].length <= slotIndex) {
      bindings[action].push('');
    }
    bindings[action][slotIndex] = code;

    // Trim empty trailing slots from all actions
    for (const act of ACTIONS) {
      const keys = bindings[act.action];
      while (keys.length > 0 && keys[keys.length - 1] === '') {
        keys.pop();
      }
    }

    InputManager.setPlayer0Bindings(bindings);
    this.cancelListening();
    this.render();
  }
}
