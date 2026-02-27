import { InputManager } from '../game/Input';

interface TouchLayoutConfig {
  dragPadSide: 'left' | 'right'; // default: 'right'
}

const DEAD_ZONE = 15;
const ACTIVE_THRESHOLD = 25;
const MAX_DRAG = 80; // px drag distance for full turn rate
const TAP_TIME_MS = 200;
const TAP_DISTANCE = 15;
const JUMP_PULSE_MS = 100;

export class TouchControls {
  private container: HTMLElement;
  private input: InputManager;
  private layout: TouchLayoutConfig = { dragPadSide: 'right' };

  // Drag pad state
  private dragPad!: HTMLElement;
  private dragIndicator!: HTMLElement;
  private dragTouchId: number | null = null;
  private dragOriginX = 0;
  private dragOriginY = 0;
  private dragStartTime = 0;

  constructor(input: InputManager) {
    this.input = input;
    this.container = document.getElementById('touch-controls')!;

    if (!this.isTouchDevice()) return;

    document.body.classList.add('touch-device');
    this.createControls();
  }

  private isTouchDevice(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  private createControls(): void {
    // Action buttons (L-shape)
    const buttonsGroup = document.createElement('div');
    buttonsGroup.className = 'touch-buttons';

    const btnBoost = this.makeButton('touch-btn', 'BOOST');
    const btnDrift = this.makeButton('touch-btn', 'DRIFT');
    const btnJump = this.makeButton('touch-btn', 'JUMP');

    this.bindTouch(btnBoost, 'boost');
    this.bindTouch(btnDrift, 'drift');
    this.bindTouch(btnJump, 'jump');

    buttonsGroup.appendChild(btnBoost);
    buttonsGroup.appendChild(btnDrift);
    buttonsGroup.appendChild(btnJump);

    // Drag pad
    this.dragPad = document.createElement('div');
    this.dragPad.className = 'touch-drag-pad';

    this.dragIndicator = document.createElement('div');
    this.dragIndicator.className = 'touch-drag-indicator';
    this.dragPad.appendChild(this.dragIndicator);

    this.setupDragPad();

    // Append based on layout (buttons left, drag pad right by default)
    if (this.layout.dragPadSide === 'right') {
      this.container.appendChild(buttonsGroup);
      this.container.appendChild(this.dragPad);
    } else {
      this.container.appendChild(this.dragPad);
      this.container.appendChild(buttonsGroup);
    }
  }

  private setupDragPad(): void {
    this.dragPad.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.dragTouchId !== null) return; // already tracking a touch

      const touch = e.changedTouches[0];
      this.dragTouchId = touch.identifier;
      this.dragOriginX = touch.clientX;
      this.dragOriginY = touch.clientY;
      this.dragStartTime = performance.now();

      this.dragPad.classList.add('active');
      // Reset indicator to center
      this.dragIndicator.style.transform = 'translate(-50%, -50%)';
    }, { passive: false });

    this.dragPad.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = this.findTrackedTouch(e.changedTouches);
      if (!touch) return;

      const dx = touch.clientX - this.dragOriginX;
      const dy = touch.clientY - this.dragOriginY;

      this.updateDragInputs(dx, dy);
      this.updateIndicatorPosition(dx, dy);
    }, { passive: false });

    this.dragPad.addEventListener('touchend', (e) => {
      e.preventDefault();
      const touch = this.findTrackedTouch(e.changedTouches);
      if (!touch) return;

      const elapsed = performance.now() - this.dragStartTime;
      const dx = touch.clientX - this.dragOriginX;
      const dy = touch.clientY - this.dragOriginY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Tap detection: quick touch with minimal drag -> jump pulse
      if (elapsed < TAP_TIME_MS && dist < TAP_DISTANCE) {
        this.fireJumpPulse();
      }

      this.clearDragState();
    }, { passive: false });

    this.dragPad.addEventListener('touchcancel', (e) => {
      const touch = this.findTrackedTouch(e.changedTouches);
      if (touch) this.clearDragState();
    });
  }

  private findTrackedTouch(touches: TouchList): Touch | null {
    for (let i = 0; i < touches.length; i++) {
      if (touches[i].identifier === this.dragTouchId) return touches[i];
    }
    return null;
  }

  private updateDragInputs(dx: number, dy: number): void {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // Horizontal: proportional steering
    if (absDx > ACTIVE_THRESHOLD) {
      this.input.setVirtualInput('left', dx < 0);
      this.input.setVirtualInput('right', dx > 0);
      // Analog fraction: ramp from 0 at threshold to 1 at MAX_DRAG
      const fraction = Math.min(1, (absDx - ACTIVE_THRESHOLD) / (MAX_DRAG - ACTIVE_THRESHOLD));
      this.input.setAnalogValue('turnFraction', fraction);
    } else if (absDx < DEAD_ZONE) {
      this.input.setVirtualInput('left', false);
      this.input.setVirtualInput('right', false);
      this.input.setAnalogValue('turnFraction', 1); // reset for keyboard
    }

    // Vertical: pitch (drag up = pitch down / nose down, drag down = pitch up / nose up)
    if (absDy > ACTIVE_THRESHOLD) {
      this.input.setVirtualInput('pitchDown', dy < 0);
      this.input.setVirtualInput('pitchUp', dy > 0);
    } else if (absDy < DEAD_ZONE) {
      this.input.setVirtualInput('pitchDown', false);
      this.input.setVirtualInput('pitchUp', false);
    }
  }

  private updateIndicatorPosition(dx: number, dy: number): void {
    // Clamp to pad radius for visual
    const padRadius = this.dragPad.offsetWidth / 2;
    const maxOffset = padRadius - 12; // 12 = half indicator size
    const clampedDx = Math.max(-maxOffset, Math.min(maxOffset, dx));
    const clampedDy = Math.max(-maxOffset, Math.min(maxOffset, dy));

    this.dragIndicator.style.transform =
      `translate(calc(-50% + ${clampedDx}px), calc(-50% + ${clampedDy}px))`;
  }

  private fireJumpPulse(): void {
    this.input.setVirtualInput('jump', true);
    setTimeout(() => {
      this.input.setVirtualInput('jump', false);
    }, JUMP_PULSE_MS);
  }

  private clearDragState(): void {
    this.dragTouchId = null;
    this.dragPad.classList.remove('active');

    // Clear all drag-related virtual inputs
    this.input.setVirtualInput('left', false);
    this.input.setVirtualInput('right', false);
    this.input.setVirtualInput('pitchUp', false);
    this.input.setVirtualInput('pitchDown', false);
    this.input.setAnalogValue('turnFraction', 1); // reset for keyboard
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
