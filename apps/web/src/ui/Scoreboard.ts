import { PLAYER_COLORS, PLAYER_NAMES } from '@tron/shared';

export class Scoreboard {
  private roundEndEl: HTMLElement;
  private titleEl: HTMLElement;
  private scoreboardEl: HTMLElement;
  private gameOverEl: HTMLElement;
  private winnerEl: HTMLElement;

  constructor() {
    this.roundEndEl = document.getElementById('round-end')!;
    this.titleEl = document.getElementById('round-end-title')!;
    this.scoreboardEl = document.getElementById('scoreboard')!;
    this.gameOverEl = document.getElementById('game-over')!;
    this.winnerEl = document.getElementById('game-over-winner')!;
  }

  showRoundEnd(
    winnerIndex: number,
    scores: number[],
    round: number,
    onContinue: () => void,
    isOnlineClient = false,
  ): void {
    this.titleEl.textContent = winnerIndex >= 0
      ? `${PLAYER_NAMES[winnerIndex]} Wins the Round!`
      : 'Draw!';

    this.scoreboardEl.innerHTML = '';
    for (let i = 0; i < scores.length; i++) {
      const row = document.createElement('div');
      row.className = `scoreboard-row${i === winnerIndex ? ' winner' : ''}`;
      row.innerHTML = `
        <div class="score-dot" style="background:${PLAYER_COLORS[i]}"></div>
        <span class="score-name">${PLAYER_NAMES[i]}</span>
        <span class="score-wins">${scores[i]}</span>
      `;
      this.scoreboardEl.appendChild(row);
    }

    this.roundEndEl.style.display = 'flex';

    // Online clients don't control round advancement — host broadcasts next round
    if (isOnlineClient) return;

    let dismissed = false;
    const handler = () => {
      if (dismissed) return;
      dismissed = true;
      this.roundEndEl.style.display = 'none';
      window.removeEventListener('click', handler);
      window.removeEventListener('keydown', handler);
      onContinue();
    };

    window.addEventListener('click', handler);
    window.addEventListener('keydown', handler);

    // Auto advance after 5s
    setTimeout(() => {
      if (!dismissed) {
        handler();
      }
    }, 5000);
  }

  showGameOver(winnerIndex: number, onPlayAgain: () => void, onMainMenu: () => void): void {
    this.winnerEl.textContent = winnerIndex >= 0
      ? `${PLAYER_NAMES[winnerIndex]} is Victorious!`
      : 'No Victor This Day';
    this.winnerEl.style.color = winnerIndex >= 0 ? PLAYER_COLORS[winnerIndex] : '#f0e6d3';
    this.gameOverEl.style.display = 'flex';

    const playAgainBtn = document.getElementById('btn-play-again')!;
    const mainMenuBtn = document.getElementById('btn-main-menu')!;

    const cleanup = () => {
      playAgainBtn.removeEventListener('click', handlePlayAgain);
      mainMenuBtn.removeEventListener('click', handleMainMenu);
    };

    const handlePlayAgain = () => {
      this.gameOverEl.style.display = 'none';
      cleanup();
      onPlayAgain();
    };

    const handleMainMenu = () => {
      this.gameOverEl.style.display = 'none';
      cleanup();
      onMainMenu();
    };

    playAgainBtn.addEventListener('click', handlePlayAgain);
    mainMenuBtn.addEventListener('click', handleMainMenu);
  }

  hideAll(): void {
    this.roundEndEl.style.display = 'none';
    this.gameOverEl.style.display = 'none';
  }
}
