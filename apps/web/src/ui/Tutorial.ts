import type { SimBike } from '@tron/game-core';
import type { PlayerInput } from '@tron/shared';

export type TutorialEvent = 'none' | 'step-complete' | 'tutorial-complete' | 'player-died';

const STEP_COMPLETE_GRACE = 2.5; // seconds to show "Complete!" before advancing

interface TutorialStep {
  id: string;
  title: string;
  instruction: string;
  keys: string[];
  hint: string;
  aiCount: number;
  spawnPowerUp?: boolean;
  check: (acc: Accumulators) => boolean;
}

interface Accumulators {
  turnedLeft: boolean;
  turnedRight: boolean;
  totalTurnTime: number;
  elapsed: number;
  driftTime: number;
  boostTime: number;
  flyTime: number;
  hasJumped: boolean;
  hasDoubleJumped: boolean;
  pickedUpPowerUp: boolean;
  wasAirborne: boolean;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'movement',
    title: 'Movement',
    instruction: 'Turn your bike using <span class="tutorial-key">A</span> (left) and <span class="tutorial-key">D</span> (right)',
    keys: ['A', 'D'],
    hint: 'Try turning in both directions',
    aiCount: 0,
    check: (a) => a.turnedLeft && a.turnedRight && a.totalTurnTime > 2,
  },
  {
    id: 'trails',
    title: 'Trails & Collision',
    instruction: 'Your bike leaves a trail behind it. Trails are lethal, but side walls are drivable and hard surfaces now bounce you. Survive for 8 seconds.',
    keys: [],
    hint: 'Avoid the trails left by your opponent',
    aiCount: 1,
    check: (a) => a.elapsed >= 8,
  },
  {
    id: 'drifting',
    title: 'Drifting',
    instruction: 'Hold <span class="tutorial-key">ALT</span> to drift. Drifting gives you a tighter turn radius!',
    keys: ['ALT'],
    hint: 'Keep drifting for a bit to complete this step',
    aiCount: 0,
    check: (a) => a.driftTime > 1.5,
  },
  {
    id: 'boosting',
    title: 'Boosting',
    instruction: 'Hold <span class="tutorial-key">SHIFT</span> to boost for extra speed!',
    keys: ['SHIFT'],
    hint: 'Your boost meter is shown in the bottom-right',
    aiCount: 0,
    check: (a) => a.boostTime > 1.5,
  },
  {
    id: 'jumping',
    title: 'Jumping',
    instruction: 'Press <span class="tutorial-key">SPACE</span> to jump over trails!',
    keys: ['SPACE'],
    hint: 'Jump and land safely to complete this step',
    aiCount: 0,
    check: (a) => a.hasJumped,
  },
  {
    id: 'double-jump',
    title: 'Double Jump',
    instruction: 'Press <span class="tutorial-key">SPACE</span> again while airborne for a double jump!',
    keys: ['SPACE'],
    hint: 'Jump first, then press SPACE again in the air',
    aiCount: 0,
    check: (a) => a.hasDoubleJumped,
  },
  {
    id: 'flying',
    title: 'Flying',
    instruction: 'Double jump, then hold <span class="tutorial-key">SHIFT</span> to fly! Use <span class="tutorial-key">W</span>/<span class="tutorial-key">S</span> to pitch up/down.',
    keys: ['SHIFT', 'W', 'S'],
    hint: 'Double jump first, then boost to take flight',
    aiCount: 0,
    check: (a) => a.flyTime > 2,
  },
  {
    id: 'powerups',
    title: 'Power-ups',
    instruction: 'Ride through the glowing star to pick up invulnerability!',
    keys: [],
    hint: 'The star makes you invulnerable and destroys enemy trails on contact',
    aiCount: 1,
    spawnPowerUp: true,
    check: (a) => a.pickedUpPowerUp,
  },
];

export class TutorialManager {
  private overlay: HTMLElement;
  private progressEl: HTMLElement;
  private titleEl: HTMLElement;
  private instructionEl: HTMLElement;
  private hintEl: HTMLElement;
  private skipBtn: HTMLElement;

  private currentStep = 0;
  private acc: Accumulators = this.freshAccumulators();
  private visible = false;
  private completed = false;
  private graceTimer = 0;

  private readonly onSkipClick = (): void => this.skip();

  constructor() {
    this.overlay = document.getElementById('tutorial-overlay')!;
    this.progressEl = document.getElementById('tutorial-progress')!;
    this.titleEl = document.getElementById('tutorial-title')!;
    this.instructionEl = document.getElementById('tutorial-instruction')!;
    this.hintEl = document.getElementById('tutorial-hint')!;
    this.skipBtn = document.getElementById('tutorial-skip')!;

    this.skipBtn.addEventListener('click', this.onSkipClick);

    // Build progress pips
    this.progressEl.innerHTML = '';
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
      const pip = document.createElement('div');
      pip.className = 'tutorial-pip';
      pip.dataset.index = String(i);
      this.progressEl.appendChild(pip);
    }
  }

  show(): void {
    this.visible = true;
    this.overlay.style.display = 'block';
  }

  hide(): void {
    this.visible = false;
    this.overlay.style.display = 'none';
  }

  startStep(index: number): void {
    this.currentStep = index;
    this.acc = this.freshAccumulators();
    this.completed = false;
    this.graceTimer = 0;
    this.updateDOM();
  }

  getCurrentStepConfig(): { aiCount: number; spawnPowerUp: boolean } {
    const step = TUTORIAL_STEPS[this.currentStep];
    return {
      aiCount: step?.aiCount ?? 0,
      spawnPowerUp: step?.spawnPowerUp ?? false,
    };
  }

  get stepIndex(): number {
    return this.currentStep;
  }

  get isLastStep(): boolean {
    return this.currentStep >= TUTORIAL_STEPS.length - 1;
  }

  update(simBike: SimBike, input: PlayerInput, dt: number): TutorialEvent {
    if (!this.visible) return 'none';

    // Grace period takes priority over death -- let the player see their success
    if (this.completed) {
      this.graceTimer -= dt;
      if (this.graceTimer <= 0) {
        const isLastStep = this.currentStep >= TUTORIAL_STEPS.length - 1;
        return isLastStep ? 'tutorial-complete' : 'step-complete';
      }
      return 'none';
    }

    if (!simBike.alive) return 'player-died';

    const a = this.acc;
    a.elapsed += dt;

    // Accumulate input/state
    if (input.left) {
      a.turnedLeft = true;
      a.totalTurnTime += dt;
    }
    if (input.right) {
      a.turnedRight = true;
      a.totalTurnTime += dt;
    }
    if (simBike.drifting) a.driftTime += dt;
    if (simBike.boosting) a.boostTime += dt;
    if (simBike.flying) a.flyTime += dt;

    // Jump detection: was airborne then landed
    if (!simBike.grounded) a.wasAirborne = true;
    if (a.wasAirborne && simBike.grounded) a.hasJumped = true;
    if (simBike.usedDoubleJumpThisAirborne) a.hasDoubleJumped = true;
    if (simBike.invulnerable) a.pickedUpPowerUp = true;

    const step = TUTORIAL_STEPS[this.currentStep];
    if (step?.check(a)) {
      this.completed = true;
      this.graceTimer = STEP_COMPLETE_GRACE;
      this.showCompletedState();
    }

    return 'none';
  }

  onSkip: (() => void) | null = null;

  skip(): void {
    this.onSkip?.();
  }

  dispose(): void {
    this.skipBtn.removeEventListener('click', this.onSkipClick);
    this.hide();
  }

  /** Remove then re-add the animation class, forcing a reflow to restart CSS animations. */
  private restartAnimation(): void {
    this.overlay.classList.remove('tutorial-step-animate');
    void this.overlay.offsetWidth;
    this.overlay.classList.add('tutorial-step-animate');
  }

  private freshAccumulators(): Accumulators {
    return {
      turnedLeft: false,
      turnedRight: false,
      totalTurnTime: 0,
      elapsed: 0,
      driftTime: 0,
      boostTime: 0,
      flyTime: 0,
      hasJumped: false,
      hasDoubleJumped: false,
      pickedUpPowerUp: false,
      wasAirborne: false,
    };
  }

  private showCompletedState(): void {
    const step = TUTORIAL_STEPS[this.currentStep];
    if (!step) return;

    this.overlay.classList.add('step-done');
    this.titleEl.textContent = `${step.title} - Complete!`;
    this.instructionEl.innerHTML = '';
    this.hintEl.textContent = this.currentStep < TUTORIAL_STEPS.length - 1
      ? 'Next step coming up...'
      : 'Well done!';
    this.skipBtn.style.display = 'none';

    // Mark current pip as done
    const pips = this.progressEl.querySelectorAll('.tutorial-pip');
    const pip = pips[this.currentStep];
    if (pip) {
      pip.classList.remove('active');
      pip.classList.add('done');
    }

    this.restartAnimation();
  }

  private updateDOM(): void {
    const step = TUTORIAL_STEPS[this.currentStep];
    if (!step) return;

    this.overlay.classList.remove('step-done');
    this.titleEl.textContent = `Step ${this.currentStep + 1}: ${step.title}`;
    this.instructionEl.innerHTML = step.instruction;
    this.hintEl.textContent = step.hint;
    this.skipBtn.style.display = '';

    // Update pips
    const pips = this.progressEl.querySelectorAll('.tutorial-pip');
    pips.forEach((pip, i) => {
      pip.classList.remove('done', 'active');
      if (i < this.currentStep) pip.classList.add('done');
      else if (i === this.currentStep) pip.classList.add('active');
    });

    this.restartAnimation();
  }
}
