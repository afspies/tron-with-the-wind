import type { GameConfig } from '@tron/shared';

const NICKNAME_KEY = 'tron_nickname';

export class Menu {
  private menuEl: HTMLElement;
  private onlinePanel: HTMLElement;
  private nicknameInput: HTMLInputElement;
  private onStart: (config: GameConfig) => void;
  private onOnline: () => void;

  constructor(onStart: (config: GameConfig) => void, onOnline: () => void) {
    this.onStart = onStart;
    this.onOnline = onOnline;
    this.menuEl = document.getElementById('menu')!;
    this.onlinePanel = document.getElementById('online-panel')!;
    this.nicknameInput = document.getElementById('nickname-input') as HTMLInputElement;

    // Restore saved nickname
    const saved = localStorage.getItem(NICKNAME_KEY);
    if (saved) this.nicknameInput.value = saved;

    // Persist on change
    this.nicknameInput.addEventListener('input', () => {
      const val = this.nicknameInput.value.trim();
      if (val) {
        localStorage.setItem(NICKNAME_KEY, val);
      } else {
        localStorage.removeItem(NICKNAME_KEY);
      }
    });

    document.getElementById('btn-quickplay')!.addEventListener('click', () => {
      this.onStart({
        humanCount: 1,
        aiCount: 3,
        aiDifficulty: 'medium',
        roundsToWin: 3,
        mode: 'quickplay',
      });
    });

    document.getElementById('btn-online')!.addEventListener('click', () => {
      this.onlinePanel.style.display =
        this.onlinePanel.style.display === 'none' ? 'block' : 'none';
    });
  }

  getNickname(): string {
    return this.nicknameInput.value.trim();
  }

  show(): void {
    this.menuEl.style.display = 'flex';
    this.onlinePanel.style.display = 'none';
  }

  hide(): void {
    this.menuEl.style.display = 'none';
  }
}
