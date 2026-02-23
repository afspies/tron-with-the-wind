import { PLAYER_COLORS, PLAYER_NAMES } from '../game/constants';
import { NetworkManager, LobbyState, ConnectionPhase, FailureMode } from '../network/NetworkManager';
import { AIDifficulty } from '../types';

const MAX_ATTEMPTS = 2;
const ATTEMPT_TIMEOUT_MS = 20_000;
const RETRY_PAUSE_MS = 1_500;
const ERROR_DISPLAY_MS = 4_000;

export class Lobby {
  private onlinePanel: HTMLElement;
  private lobbyDiv: HTMLElement;
  private net: NetworkManager;
  private onStart: () => void;
  private onLeave: () => void;

  // Join flow state
  private joinTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private retryPauseId: ReturnType<typeof setTimeout> | null = null;
  private errorDisplayId: ReturnType<typeof setTimeout> | null = null;
  private joinSettled = false;

  constructor(net: NetworkManager, onStart: () => void, onLeave: () => void) {
    this.net = net;
    this.onStart = onStart;
    this.onLeave = onLeave;
    this.onlinePanel = document.getElementById('online-panel')!;
    this.lobbyDiv = document.getElementById('lobby')!;

    // Pre-fetch TURN config so it's cached by the time user clicks Join/Create
    this.net.prefetchTurnConfig();

    // Create room button
    document.getElementById('btn-create-room')!.addEventListener('click', async () => {
      const code = await this.net.createRoom();
      this.showLobby(code, true);
    });

    // Join room button
    document.getElementById('btn-join-room')!.addEventListener('click', () => {
      const input = document.getElementById('join-input') as HTMLInputElement;
      const code = input.value.trim().toUpperCase();
      if (code.length !== 4) return;
      this.attemptJoin(code);
    });

    // Cancel button
    document.getElementById('btn-joining-cancel')!.addEventListener('click', () => {
      this.cancelJoin();
    });

    // Lobby start button (host only)
    document.getElementById('btn-lobby-start')!.addEventListener('click', () => {
      if (!this.net.isHost) return;
      this.onStart();
    });

    // Lobby leave button
    document.getElementById('btn-lobby-leave')!.addEventListener('click', () => {
      this.net.leaveRoom();
      this.hide();
      this.onLeave();
    });

    // Host config controls
    const aiCountSel = document.getElementById('lobby-ai-count') as HTMLSelectElement;
    const aiDiffSel = document.getElementById('lobby-ai-difficulty') as HTMLSelectElement;
    const roundsSel = document.getElementById('lobby-rounds') as HTMLSelectElement;

    const updateConfig = () => {
      if (!this.net.isHost) return;
      this.net.lobbyState.aiCount = parseInt(aiCountSel.value);
      this.net.lobbyState.aiDifficulty = aiDiffSel.value as AIDifficulty;
      this.net.lobbyState.roundsToWin = parseInt(roundsSel.value);
      this.net.broadcastLobby();
    };

    aiCountSel.addEventListener('change', updateConfig);
    aiDiffSel.addEventListener('change', updateConfig);
    roundsSel.addEventListener('change', updateConfig);

    // Listen for lobby updates from network
    this.net.onLobbyUpdate = (state) => this.updatePlayers(state);
  }

  showCreateJoin(): void {
    this.onlinePanel.style.display = 'block';
    this.lobbyDiv.style.display = 'none';
    (document.getElementById('join-input') as HTMLInputElement).value = '';
  }

  private attemptJoin(code: string): void {
    // Show joining overlay, hide menu
    const joiningOverlay = document.getElementById('joining-overlay')!;
    const menu = document.getElementById('menu')!;
    joiningOverlay.style.display = 'flex';
    menu.style.display = 'none';

    // Set room code in UI
    document.getElementById('joining-room-code')!.textContent = code;

    this.joinWithRetry(code, 1);
  }

  private async joinWithRetry(code: string, attempt: number): Promise<void> {
    this.joinSettled = false;
    this.resetPhases();

    const statusEl = document.getElementById('joining-status')!;
    if (attempt > 1) {
      statusEl.textContent = 'Retrying...';
    } else {
      statusEl.textContent = '';
    }

    // Install connection progress callback
    this.net.onConnectionProgress = (progress) => {
      if (this.joinSettled) return;
      this.updatePhaseDisplay(progress.phase);
    };

    // Install lobby update handler — receiving lobby = fully connected
    this.net.onLobbyUpdate = (state) => {
      if (this.joinSettled) {
        this.updatePlayers(state);
        return;
      }
      // Success — connected
      this.joinSettled = true;
      this.clearAllTimers();
      this.net.stopConnectionMonitor();
      this.net.onConnectionProgress = null;

      const joiningOverlay = document.getElementById('joining-overlay')!;
      joiningOverlay.style.display = 'none';

      this.net.onLobbyUpdate = (s) => this.updatePlayers(s);
      this.showLobby(code, false);
      this.updatePlayers(state);
    };

    // Join the room
    await this.net.joinRoom(code);
    this.net.startConnectionMonitor();

    // Set timeout for this attempt
    this.joinTimeoutId = setTimeout(() => {
      if (this.joinSettled) return;
      this.net.stopConnectionMonitor();
      this.net.onConnectionProgress = null;

      if (attempt < MAX_ATTEMPTS) {
        // Auto-retry
        console.debug(`[TRON-NET] Attempt ${attempt} timed out, retrying...`);
        statusEl.textContent = 'Retrying...';
        this.net.leaveRoom();
        this.net.resetConnectionAttempt();

        this.retryPauseId = setTimeout(() => {
          if (this.joinSettled) return;
          this.joinWithRetry(code, attempt + 1);
        }, RETRY_PAUSE_MS);
      } else {
        // Final failure
        const failureMode = this.net.getFailureMode();
        console.debug(`[TRON-NET] All attempts failed. Failure mode: ${failureMode}`);
        this.showJoinError(code, failureMode);
      }
    }, ATTEMPT_TIMEOUT_MS);
  }

  private showJoinError(code: string, mode: FailureMode): void {
    const statusEl = document.getElementById('joining-status')!;

    // Mark the failed phase
    switch (mode) {
      case 'relay-failure':
        this.markPhaseFailed('connecting-relays');
        statusEl.textContent = 'Unable to reach game servers. Check your internet connection.';
        break;
      case 'discovery-timeout':
        this.markPhaseFailed('searching');
        statusEl.textContent = `No one found in room ${code}. Double-check the code.`;
        break;
      case 'ice-failure':
        this.markPhaseFailed('peer-found');
        statusEl.textContent = 'Found host but couldn\'t connect directly. Try again.';
        break;
      default:
        this.markPhaseFailed('searching');
        statusEl.textContent = 'Could not connect. Check the code and try again.';
        break;
    }

    this.net.leaveRoom();

    // Show error for a few seconds, then return to menu
    this.errorDisplayId = setTimeout(() => {
      this.returnToMenu();
    }, ERROR_DISPLAY_MS);
  }

  private cancelJoin(): void {
    this.joinSettled = true;
    this.clearAllTimers();
    this.net.stopConnectionMonitor();
    this.net.onConnectionProgress = null;
    this.net.leaveRoom();
    this.net.onLobbyUpdate = (s) => this.updatePlayers(s);
    this.returnToMenu();
  }

  private returnToMenu(): void {
    const joiningOverlay = document.getElementById('joining-overlay')!;
    const menu = document.getElementById('menu')!;
    joiningOverlay.style.display = 'none';
    menu.style.display = 'flex';
  }

  private clearAllTimers(): void {
    if (this.joinTimeoutId !== null) {
      clearTimeout(this.joinTimeoutId);
      this.joinTimeoutId = null;
    }
    if (this.retryPauseId !== null) {
      clearTimeout(this.retryPauseId);
      this.retryPauseId = null;
    }
    if (this.errorDisplayId !== null) {
      clearTimeout(this.errorDisplayId);
      this.errorDisplayId = null;
    }
  }

  // Phase display helpers

  private resetPhases(): void {
    const phases = ['phase-relays', 'phase-search', 'phase-peer'];
    for (const id of phases) {
      const el = document.getElementById(id)!;
      el.classList.remove('active', 'done', 'failed');
    }
  }

  private updatePhaseDisplay(phase: ConnectionPhase): void {
    const relays = document.getElementById('phase-relays')!;
    const search = document.getElementById('phase-search')!;
    const peer = document.getElementById('phase-peer')!;

    // Reset all
    relays.classList.remove('active', 'done', 'failed');
    search.classList.remove('active', 'done', 'failed');
    peer.classList.remove('active', 'done', 'failed');

    switch (phase) {
      case 'connecting-relays':
        relays.classList.add('active');
        break;
      case 'searching':
        relays.classList.add('done');
        search.classList.add('active');
        break;
      case 'peer-found':
        relays.classList.add('done');
        search.classList.add('done');
        peer.classList.add('active');
        break;
      case 'connected':
        relays.classList.add('done');
        search.classList.add('done');
        peer.classList.add('done');
        break;
    }
  }

  private markPhaseFailed(phase: ConnectionPhase): void {
    // Mark everything before the failed phase as done, then mark the failed one
    const relays = document.getElementById('phase-relays')!;
    const search = document.getElementById('phase-search')!;
    const peer = document.getElementById('phase-peer')!;

    relays.classList.remove('active', 'done', 'failed');
    search.classList.remove('active', 'done', 'failed');
    peer.classList.remove('active', 'done', 'failed');

    switch (phase) {
      case 'connecting-relays':
        relays.classList.add('failed');
        break;
      case 'searching':
        relays.classList.add('done');
        search.classList.add('failed');
        break;
      case 'peer-found':
        relays.classList.add('done');
        search.classList.add('done');
        peer.classList.add('failed');
        break;
    }
  }

  private showLobby(code: string, isHost: boolean): void {
    this.onlinePanel.style.display = 'none';
    document.getElementById('menu')!.style.display = 'none';
    this.lobbyDiv.style.display = 'flex';

    document.getElementById('lobby-code')!.textContent = code;

    // Show/hide host controls
    const hostControls = document.getElementById('lobby-host-controls')!;
    hostControls.style.display = isHost ? 'block' : 'none';

    const startBtn = document.getElementById('btn-lobby-start')!;
    startBtn.style.display = isHost ? 'block' : 'none';

    const waitMsg = document.getElementById('lobby-wait-msg')!;
    waitMsg.style.display = isHost ? 'none' : 'block';

    // Initial player list
    this.updatePlayers(this.net.lobbyState);
  }

  updatePlayers(state: LobbyState): void {
    const listEl = document.getElementById('lobby-player-list')!;
    listEl.innerHTML = '';

    // Show human players
    for (const player of state.players) {
      const row = document.createElement('div');
      row.className = 'lobby-player-row';
      const color = PLAYER_COLORS[player.slot] || '#888';
      const name = PLAYER_NAMES[player.slot] || `Player ${player.slot + 1}`;
      const isLocal = player.peerId === this.net.localPeerId;
      row.innerHTML = `
        <div class="lobby-dot" style="background:${color}; box-shadow: 0 0 8px ${color}"></div>
        <span>${name}${isLocal ? ' (You)' : ''}</span>
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
    if (!this.net.isHost) {
      (document.getElementById('lobby-ai-count') as HTMLSelectElement).value = String(state.aiCount);
      (document.getElementById('lobby-ai-difficulty') as HTMLSelectElement).value = state.aiDifficulty;
      (document.getElementById('lobby-rounds') as HTMLSelectElement).value = String(state.roundsToWin);
    }
  }

  hide(): void {
    this.onlinePanel.style.display = 'none';
    this.lobbyDiv.style.display = 'none';
  }
}
