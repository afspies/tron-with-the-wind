import type { GameConfig } from '@tron/shared';

export class Menu {
  private menuEl: HTMLElement;
  private onlinePanel: HTMLElement;
  private onStart: (config: GameConfig) => void;
  private onOnline: () => void;
  private selectedMap: string = 'classic';
  private mapButtons: NodeListOf<Element>;

  constructor(onStart: (config: GameConfig) => void, onOnline: () => void) {
    this.onStart = onStart;
    this.onOnline = onOnline;
    this.menuEl = document.getElementById('menu')!;
    this.onlinePanel = document.getElementById('online-panel')!;

    // Map selection buttons
    this.mapButtons = document.querySelectorAll('#menu-map-options .map-btn');
    this.mapButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedMap = (btn as HTMLElement).dataset.map || 'classic';
        this.mapButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    document.getElementById('btn-quickplay')!.addEventListener('click', () => {
      this.onStart({
        humanCount: 1,
        aiCount: 3,
        aiDifficulty: 'medium',
        roundsToWin: 3,
        mode: 'quickplay',
        mapId: this.selectedMap,
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
    // Reset map selection
    this.selectedMap = 'classic';
    this.mapButtons.forEach(b => {
      b.classList.toggle('selected', (b as HTMLElement).dataset.map === 'classic');
    });
  }

  hide(): void {
    this.menuEl.style.display = 'none';
  }
}
