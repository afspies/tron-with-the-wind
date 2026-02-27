import { PLAYER_COLORS, BOOST_MAX, DOUBLE_JUMP_COOLDOWN } from '@tron/shared';
import { Bike } from '../game/Bike';

const CIRCUMFERENCE = 2 * Math.PI * 50; // r=50 from the SVG circle

export class PlayerHUD {
  private container: HTMLElement;
  private boostArc: SVGCircleElement;
  private boostLabel: HTMLElement;
  private jumpFill: HTMLElement;
  private powerupBox: HTMLElement;
  private powerupIcon: HTMLElement;
  private powerupTimer: HTMLElement;
  private playerColor = '';

  constructor() {
    this.container = document.getElementById('hud-local-status')!;
    this.boostArc = document.getElementById('boost-dial-fill')! as unknown as SVGCircleElement;
    this.boostLabel = document.getElementById('boost-dial-label')!;
    this.jumpFill = document.getElementById('jump-bar-fill')!;
    this.powerupBox = document.getElementById('hud-powerups')!;
    this.powerupIcon = document.getElementById('powerup-icon')!;
    this.powerupTimer = document.getElementById('powerup-timer')!;

    // Set up SVG stroke for the boost arc
    this.boostArc.style.strokeDasharray = `${CIRCUMFERENCE}`;
    this.boostArc.style.strokeDashoffset = '0';
  }

  show(playerColor: string): void {
    this.playerColor = playerColor;
    this.container.style.display = 'flex';

    // Set arc color to player color
    this.boostArc.style.stroke = playerColor;
    this.boostArc.style.setProperty('--dial-color', playerColor);

    // Reset state
    this.boostArc.style.strokeDashoffset = '0';
    this.boostLabel.textContent = '100%';
    this.jumpFill.style.height = '100%';
    this.jumpFill.classList.add('ready');

    this.powerupBox.style.display = 'none';
    this.powerupBox.classList.remove('active');
  }

  update(bike: Bike): void {
    // Boost dial
    const boostPct = bike.boostMeter / BOOST_MAX;
    const offset = CIRCUMFERENCE * (1 - boostPct);
    this.boostArc.style.strokeDashoffset = `${offset}`;
    this.boostLabel.textContent = `${Math.round(boostPct * 100)}%`;

    if (bike.boosting) {
      this.boostArc.classList.add('glowing');
    } else {
      this.boostArc.classList.remove('glowing');
    }

    // Jump bar
    const jumpPct = bike.doubleJumpReady
      ? 100
      : ((DOUBLE_JUMP_COOLDOWN - bike.doubleJumpCooldown) / DOUBLE_JUMP_COOLDOWN) * 100;
    this.jumpFill.style.height = `${jumpPct}%`;

    if (bike.doubleJumpReady) {
      this.jumpFill.style.opacity = '1';
      this.jumpFill.classList.add('ready');
    } else {
      this.jumpFill.style.opacity = '0.5';
      this.jumpFill.classList.remove('ready');
    }

    // Powerup box
    if (bike.invulnerable) {
      this.powerupBox.style.display = 'flex';
      this.powerupBox.classList.add('active');
      this.powerupIcon.textContent = '\u2605'; // star
      this.powerupTimer.textContent = `${bike.invulnerableTimer.toFixed(1)}s`;
    } else {
      this.powerupBox.style.display = 'none';
      this.powerupBox.classList.remove('active');
    }
  }

  hide(): void {
    this.container.style.display = 'none';
    this.powerupBox.style.display = 'none';
    this.powerupBox.classList.remove('active');
  }
}
