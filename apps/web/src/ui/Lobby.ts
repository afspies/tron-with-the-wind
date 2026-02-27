import { PLAYER_COLORS, PLAYER_NAMES } from '@tron/shared';
import type { AIDifficulty } from '@tron/shared';
import { ColyseusClient, LobbyState } from '../network/ColyseusClient';

export class Lobby {
  private onlinePanel: HTMLElement;
  private lobbyDiv: HTMLElement;
  private colyseus: ColyseusClient;
  private getNickname: () => string;
  private onStart: () => void;
  private onLeave: () => void;

  constructor(colyseus: ColyseusClient, getNickname: () => string, onStart: () => void, onLeave: () => void) {
    this.colyseus = colyseus;
    this.getNickname = getNickname;
    this.onStart = onStart;
    this.onLeave = onLeave;
    this.onlinePanel = document.getElementById('online-panel')!;
    this.lobbyDiv = document.getElementById('lobby')!;

    // Create room button
    document.getElementById('btn-create-room')!.addEventListener('click', async () => {
      const aiCountSel = document.getElementById('lobby-ai-count') as HTMLSelectElement;
      const aiDiffSel = document.getElementById('lobby-ai-difficulty') as HTMLSelectElement;
      const roundsSel = document.getElementById('lobby-rounds') as HTMLSelectElement;
      const code = await this.colyseus.createRoom({
        aiCount: parseInt(aiCountSel.value),
        aiDifficulty: aiDiffSel.value as AIDifficulty,
        roundsToWin: parseInt(roundsSel.value),
        name: this.getNickname() || undefined,
      });
      this.showLobby(code, true);
    });

    // Join room button
    document.getElementById('btn-join-room')!.addEventListener('click', () => {
      const input = document.getElementById('join-input') as HTMLInputElement;
      const code = input.value.trim().toUpperCase();
      if (code.length < 3 || !/^[A-Z]+(-[A-Z]+)*$/.test(code)) return;
      this.attemptJoin(code);
    });

    // Cancel button
    document.getElementById('btn-joining-cancel')!.addEventListener('click', () => {
      this.colyseus.leave();
      this.returnToMenu();
    });

    // Lobby start button (host only)
    document.getElementById('btn-lobby-start')!.addEventListener('click', () => {
      if (!this.colyseus.isHost) return;
      this.onStart();
    });

    // Lobby leave button
    document.getElementById('btn-lobby-leave')!.addEventListener('click', () => {
      this.colyseus.leave();
      this.hide();
      this.onLeave();
    });

    // Host config controls
    const aiCountSel = document.getElementById('lobby-ai-count') as HTMLSelectElement;
    const aiDiffSel = document.getElementById('lobby-ai-difficulty') as HTMLSelectElement;
    const roundsSel = document.getElementById('lobby-rounds') as HTMLSelectElement;

    const updateConfig = () => {
      if (!this.colyseus.isHost) return;
      this.colyseus.sendConfig({
        aiCount: parseInt(aiCountSel.value),
        aiDifficulty: aiDiffSel.value,
        roundsToWin: parseInt(roundsSel.value),
      });
    };

    aiCountSel.addEventListener('change', updateConfig);
    aiDiffSel.addEventListener('change', updateConfig);
    roundsSel.addEventListener('change', updateConfig);
  }

  showCreateJoin(): void {
    const visible = this.onlinePanel.style.display !== 'none';
    this.onlinePanel.style.display = visible ? 'none' : 'block';
    this.lobbyDiv.style.display = 'none';
    if (!visible) {
      (document.getElementById('join-input') as HTMLInputElement).value = '';
    }
  }

  private async attemptJoin(code: string): Promise<void> {
    const joiningOverlay = document.getElementById('joining-overlay')!;
    const menu = document.getElementById('menu')!;
    const statusEl = document.getElementById('joining-status')!;

    joiningOverlay.style.display = 'flex';
    menu.style.display = 'none';
    document.getElementById('joining-room-code')!.textContent = code;
    statusEl.textContent = 'Connecting...';

    // Show simple connecting state (no multi-phase P2P flow)
    this.resetPhases();
    const relays = document.getElementById('phase-relays')!;
    relays.classList.add('active');

    try {
      await this.colyseus.joinRoom(code, { name: this.getNickname() || undefined });

      // Connected successfully
      joiningOverlay.style.display = 'none';
      this.showLobby(code, this.colyseus.isHost);
      this.updatePlayers(this.colyseus.getLobbyState());
    } catch {
      statusEl.textContent = 'Could not connect. Check the code and try again.';
      this.markPhaseFailed('connecting-relays');
      setTimeout(() => {
        this.returnToMenu();
      }, 3000);
    }
  }

  private returnToMenu(): void {
    const joiningOverlay = document.getElementById('joining-overlay')!;
    const menu = document.getElementById('menu')!;
    joiningOverlay.style.display = 'none';
    menu.style.display = 'flex';
  }

  private resetPhases(): void {
    const phases = ['phase-relays', 'phase-search', 'phase-peer'];
    for (const id of phases) {
      const el = document.getElementById(id)!;
      el.classList.remove('active', 'done', 'failed');
    }
  }

  private markPhaseFailed(phase: string): void {
    const relays = document.getElementById('phase-relays')!;
    relays.classList.remove('active', 'done', 'failed');
    if (phase === 'connecting-relays') {
      relays.classList.add('failed');
    }
  }

  private showLobby(code: string, isHost: boolean): void {
    this.onlinePanel.style.display = 'none';
    document.getElementById('menu')!.style.display = 'none';
    this.lobbyDiv.style.display = 'flex';

    document.getElementById('lobby-code')!.textContent = code;
    this.setupShareButton(code);
    this.updateHostUI(isHost);
    this.updatePlayers(this.colyseus.getLobbyState());
  }

  /** Called by Game.ts when Colyseus state changes while lobby is visible */
  refresh(): void {
    if (this.lobbyDiv.style.display === 'none') return;
    this.updatePlayers(this.colyseus.getLobbyState());
    this.updateHostUI(this.colyseus.isHost);
  }

  private updateHostUI(isHost: boolean): void {
    document.getElementById('lobby-host-controls')!.style.display = isHost ? 'block' : 'none';
    document.getElementById('btn-lobby-start')!.style.display = isHost ? 'block' : 'none';
    document.getElementById('lobby-wait-msg')!.style.display = isHost ? 'none' : 'block';
  }

  updatePlayers(state: LobbyState): void {
    const listEl = document.getElementById('lobby-player-list')!;
    listEl.innerHTML = '';

    // Show human players
    for (const player of state.players) {
      const row = document.createElement('div');
      row.className = 'lobby-player-row';
      const color = PLAYER_COLORS[player.slot] || '#888';
      const displayName = player.name || PLAYER_NAMES[player.slot] || `Player ${player.slot + 1}`;
      const isLocal = player.sessionId === this.colyseus.localSessionId;
      row.innerHTML = `
        <div class="lobby-dot" style="background:${color}; box-shadow: 0 0 8px ${color}"></div>
        <span>${displayName}${isLocal ? ' (You)' : ''}</span>
      `;
      listEl.appendChild(row);
    }

    // Show AI slots
    const humanSlots = new Set(state.players.map(p => p.slot));
    let aiShown = 0;
    for (let slot = 0; slot < 4 && aiShown < state.aiCount; slot++) {
      if (humanSlots.has(slot)) continue;
      const color = PLAYER_COLORS[slot] || '#888';
      const name = PLAYER_NAMES[slot] || `Player ${slot + 1}`;
      const row = document.createElement('div');
      row.className = 'lobby-player-row';
      row.innerHTML = `
        <div class="lobby-dot" style="background:${color}; box-shadow: 0 0 8px ${color}; opacity: 0.5"></div>
        <span style="opacity:0.6">${name} (AI - ${state.aiDifficulty})</span>
      `;
      listEl.appendChild(row);
      aiShown++;
    }

    // Update config selects for clients (read-only display)
    if (!this.colyseus.isHost) {
      (document.getElementById('lobby-ai-count') as HTMLSelectElement).value = String(state.aiCount);
      (document.getElementById('lobby-ai-difficulty') as HTMLSelectElement).value = state.aiDifficulty;
      (document.getElementById('lobby-rounds') as HTMLSelectElement).value = String(state.roundsToWin);
    }
  }

  private setupShareButton(code: string): void {
    const btn = document.getElementById('btn-share-room')!;
    const status = document.getElementById('share-status')!;

    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;

    // Replace button to remove old listeners
    const newBtn = btn.cloneNode(true) as HTMLElement;
    btn.parentNode!.replaceChild(newBtn, btn);

    newBtn.addEventListener('click', async () => {
      // Try native share on mobile, fall back to clipboard
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Tron with the Wind', text: `Join my game!`, url });
          return;
        } catch {
          // User cancelled or share failed — fall through to clipboard
        }
      }

      try {
        await navigator.clipboard.writeText(url);
        status.textContent = 'Copied!';
      } catch {
        status.textContent = 'Copy failed';
      }
      setTimeout(() => { status.textContent = ''; }, 2000);
    });
  }

  autoJoin(code: string): void {
    const cleaned = code.trim().toUpperCase();
    if (cleaned.length < 3 || !/^[A-Z]+$/.test(cleaned)) return;
    this.attemptJoin(cleaned);
  }

  hide(): void {
    this.onlinePanel.style.display = 'none';
    this.lobbyDiv.style.display = 'none';
  }
}
