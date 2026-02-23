import { GameConfig } from '../types';

export class Menu {
  private menuEl: HTMLElement;
  private onlinePanel: HTMLElement;
  private onStart: (config: GameConfig) => void;
  private onOnline: () => void;

  constructor(onStart: (config: GameConfig) => void, onOnline: () => void) {
    this.onStart = onStart;
    this.onOnline = onOnline;
    this.menuEl = document.getElementById('menu')!;
    this.onlinePanel = document.getElementById('online-panel')!;

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

  show(): void {
    this.menuEl.style.display = 'flex';
    this.onlinePanel.style.display = 'none';
  }

  hide(): void {
    this.menuEl.style.display = 'none';
  }
}
