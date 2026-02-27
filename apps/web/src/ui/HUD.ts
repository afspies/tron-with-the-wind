import { PLAYER_COLORS, PLAYER_NAMES } from '@tron/shared';
import { Bike } from '../game/Bike';
import { PlayerHUD } from './PlayerHUD';

export class HUD {
  private hudEl: HTMLElement;
  private playersEl: HTMLElement;
  private roundEl: HTMLElement;
  private pingEl: HTMLElement | null = null;
  private playerHUD: PlayerHUD;
  private localPlayerIndex: number | undefined;

  constructor() {
    this.hudEl = document.getElementById('hud')!;
    this.playersEl = document.getElementById('hud-players')!;
    this.roundEl = document.getElementById('hud-round')!;
    this.playerHUD = new PlayerHUD();
  }

  show(playerCount: number, round: number, roundsToWin: number, localPlayerIndex?: number, isOnline = false, names?: string[]): void {
    this.hudEl.style.display = 'block';
    this.playersEl.innerHTML = '';
    this.localPlayerIndex = localPlayerIndex;

    // Ping indicator for online play
    if (isOnline && !this.pingEl) {
      this.pingEl = document.createElement('div');
      this.pingEl.id = 'hud-ping';
      this.pingEl.textContent = '-- ms';
      this.pingEl.style.color = '#888';
      this.hudEl.appendChild(this.pingEl);
    }

    // Show local player's dedicated HUD widgets
    if (localPlayerIndex !== undefined) {
      this.playerHUD.show(PLAYER_COLORS[localPlayerIndex]);
    }

    for (let i = 0; i < playerCount; i++) {
      const row = document.createElement('div');
      row.className = 'hud-player';
      row.id = `hud-p${i}`;
      const displayName = names?.[i] || PLAYER_NAMES[i];
      const youTag = localPlayerIndex !== undefined && i === localPlayerIndex ? ' (You)' : '';
      row.innerHTML = `
        <div class="hud-dot" style="color:${PLAYER_COLORS[i]};background:${PLAYER_COLORS[i]}"></div>
        <span>${displayName}${youTag}</span>
        <span class="hud-drift" id="hud-drift-${i}" style="display:none;color:#ffaa33;font-size:0.7em;margin-left:4px;">DRIFT</span>
        <span class="hud-status" id="hud-status-${i}"></span>
      `;
      this.playersEl.appendChild(row);
    }

    this.roundEl.textContent = `Round ${round} · First to ${roundsToWin}`;
  }

  update(bikes: Bike[], round: number, roundsToWin: number): void {
    // Update local player's dedicated HUD widgets
    if (this.localPlayerIndex !== undefined && bikes[this.localPlayerIndex]) {
      this.playerHUD.update(bikes[this.localPlayerIndex]);
    }

    for (let i = 0; i < bikes.length; i++) {
      const el = document.getElementById(`hud-p${i}`);
      if (el) {
        el.className = bikes[i].alive ? 'hud-player' : 'hud-player dead';
      }
      const statusEl = document.getElementById(`hud-status-${i}`);
      if (statusEl) {
        if (bikes[i].invulnerable) {
          const hue = ((performance.now() / 1000) * 4) % 1.0;
          const r = Math.round(255 * Math.max(0, Math.min(1, Math.abs(hue * 6 - 3) - 1)));
          const g = Math.round(255 * Math.max(0, Math.min(1, 2 - Math.abs(hue * 6 - 2))));
          const b = Math.round(255 * Math.max(0, Math.min(1, 2 - Math.abs(hue * 6 - 4))));
          statusEl.textContent = '\u2605';
          statusEl.style.color = `rgb(${r},${g},${b})`;
          statusEl.style.textShadow = `0 0 6px rgb(${r},${g},${b})`;
        } else {
          statusEl.textContent = '';
          statusEl.style.textShadow = '';
        }
      }
      // Drift indicator
      const driftEl = document.getElementById(`hud-drift-${i}`);
      if (driftEl) {
        driftEl.style.display = bikes[i].drifting ? 'inline' : 'none';
      }
    }
    this.roundEl.textContent = `Round ${round} · First to ${roundsToWin}`;
  }

  updatePing(ms: number): void {
    if (!this.pingEl) return;
    if (ms < 0) {
      this.pingEl.textContent = '-- ms';
      this.pingEl.style.color = '#888';
    } else {
      this.pingEl.textContent = `${Math.round(ms)} ms`;
      if (ms <= 80) {
        this.pingEl.style.color = '#4caf50';
      } else if (ms <= 200) {
        this.pingEl.style.color = '#ffd700';
      } else {
        this.pingEl.style.color = '#E0115F';
      }
    }
  }

  hide(): void {
    this.hudEl.style.display = 'none';
    this.playerHUD.hide();
    if (this.pingEl) {
      this.pingEl.remove();
      this.pingEl = null;
    }
  }
}
