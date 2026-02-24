import { InputManager } from '../game/Input';

export class TouchControls {
  private container: HTMLElement;
  private input: InputManager;

  constructor(input: InputManager) {
    this.input = input;
    this.container = document.getElementById('touch-controls')!;

    if (!this.isTouchDevice()) return;

    this.createButtons();
  }

  private isTouchDevice(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  private createButtons(): void {
    // Left zone: steer buttons
    const leftZone = document.createElement('div');
    leftZone.className = 'touch-zone touch-left';

    const btnLeft = this.makeButton('touch-btn', '\u25C0');
    const btnRight = this.makeButton('touch-btn', '\u25B6');

    this.bindTouch(btnLeft, 'left');
    this.bindTouch(btnRight, 'right');

    leftZone.appendChild(btnLeft);
    leftZone.appendChild(btnRight);

    // Right zone: jump + boost
    const rightZone = document.createElement('div');
    rightZone.className = 'touch-zone touch-right';

    const btnJump = this.makeButton('touch-btn touch-action', 'JUMP');
    const btnBoost = this.makeButton('touch-btn touch-action', 'BOOST');

    this.bindTouch(btnJump, 'jump');
    this.bindTouch(btnBoost, 'boost');

    rightZone.appendChild(btnBoost);
    rightZone.appendChild(btnJump);

    this.container.appendChild(leftZone);
    this.container.appendChild(rightZone);
  }

  private makeButton(className: string, label: string): HTMLElement {
    const btn = document.createElement('div');
    btn.className = className;
    btn.textContent = label;
    return btn;
  }

  private bindTouch(el: HTMLElement, action: string): void {
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.input.setVirtualInput(action, true);
      el.classList.add('active');
    }, { passive: false });

    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.input.setVirtualInput(action, false);
      el.classList.remove('active');
    }, { passive: false });

    el.addEventListener('touchcancel', () => {
      this.input.setVirtualInput(action, false);
      el.classList.remove('active');
    });
  }

  show(): void {
    if (this.isTouchDevice()) {
      this.container.style.display = 'flex';
    }
  }

  hide(): void {
    this.container.style.display = 'none';
  }
}
