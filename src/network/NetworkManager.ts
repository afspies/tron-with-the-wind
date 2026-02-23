import { joinRoom, selfId, getRelaySockets } from 'trystero/torrent';
import type { Room } from 'trystero';
import { PlayerInput } from '../game/Input';
import { AIDifficulty } from '../types';
import type { ChatMessage } from '../ui/Chat';
import { decodeGameState } from './BinaryCodec';

const APP_ID = 'tron-with-the-wind-v1';

const TRACKER_URLS = [
  'wss://tracker.webtorrent.dev',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.files.fm:7073/announce',
];

// TurnServer matches trystero's turnConfig format
interface TurnServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

async function fetchTurnConfig(): Promise<TurnServer[] | null> {
  const url = __TURN_WORKER_URL__;
  if (!url) return null;

  try {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Worker returns {iceServers: [{urls, username, credential}]} — extract the inner array
    return data.iceServers as TurnServer[];
  } catch (e) {
    console.warn('TURN credential fetch failed, falling back to STUN-only:', e);
    return null;
  }
}

export type ConnectionPhase = 'connecting-relays' | 'searching' | 'peer-found' | 'connected';

export interface ConnectionProgress {
  phase: ConnectionPhase;
  relaysConnected: number;
  relaysTotal: number;
}

export type FailureMode = 'relay-failure' | 'discovery-timeout' | 'ice-failure' | 'unknown';

export interface LobbyPlayer {
  peerId: string;
  slot: number;
  name: string;
  color: string;
}

export interface LobbyState {
  players: LobbyPlayer[];
  aiCount: number;
  aiDifficulty: AIDifficulty;
  roundsToWin: number;
}

export interface NetBikeState {
  x: number;
  z: number;
  y: number;
  angle: number;
  alive: boolean;
  vy: number;
  grounded: boolean;
  boostMeter: number;
  boosting: boolean;
}

export interface NetGameState {
  tick: number;              // monotonically increasing host tick
  bikes: number[][];         // packed flat arrays per bike
  trailDeltas: number[][];   // packed [x,y,z,...] per bike
  trailLengths?: number[];   // total trail point count per bike
  fullTrails?: number[][];   // periodic full trail resync
}

export interface NetEvent {
  type: 'countdown' | 'round-start' | 'round-end' | 'game-over' | 'powerup-spawn' | 'powerup-pickup' | 'trail-destroy';
  winnerIndex?: number;
  scores?: number[];
  round?: number;
  powerupId?: number;
  powerupX?: number;
  powerupZ?: number;
  bikeIndex?: number;
  trailIndex?: number;
  destroyX?: number;
  destroyZ?: number;
  destroyRadius?: number;
  powerupType?: string;
}

export interface StartMessage {
  playerCount: number;
  aiCount: number;
  aiDifficulty: AIDifficulty;
  roundsToWin: number;
  slots: { peerId: string; slot: number }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ActionSend = (...args: any[]) => void;

export class NetworkManager {
  private room: Room | null = null;
  private roomCode = '';
  private turnConfigPromise: Promise<TurnServer[] | null> | null = null;
  private connectionMonitorId: ReturnType<typeof setInterval> | null = null;
  private lastPhase: ConnectionPhase | null = null;
  isHost = false;
  localPeerId = selfId;
  peerJoinedDuringConnect = false;

  // Actions
  private sendInput!: ActionSend;
  private sendState!: ActionSend;
  private sendEvent!: ActionSend;
  private sendLobby!: ActionSend;
  private sendStart!: ActionSend;
  private sendChat!: ActionSend;

  // Lobby tracking
  lobbyState: LobbyState = {
    players: [],
    aiCount: 3,
    aiDifficulty: 'medium',
    roundsToWin: 3,
  };

  // Buffered inputs from remote peers (host uses this)
  peerInputs: Map<string, PlayerInput> = new Map();

  // Callbacks
  onLobbyUpdate: ((state: LobbyState) => void) | null = null;
  onGameStart: ((msg: StartMessage) => void) | null = null;
  onInputReceived: ((input: PlayerInput, peerId: string) => void) | null = null;
  onStateReceived: ((state: NetGameState) => void) | null = null;
  onEventReceived: ((event: NetEvent) => void) | null = null;
  onPeerDisconnect: ((peerId: string) => void) | null = null;
  onChatReceived: ((msg: ChatMessage) => void) | null = null;
  onConnectionProgress: ((progress: ConnectionProgress) => void) | null = null;

  prefetchTurnConfig(): void {
    if (!this.turnConfigPromise) {
      this.turnConfigPromise = fetchTurnConfig();
    }
  }

  private async getTurnConfig(): Promise<TurnServer[] | null> {
    if (this.turnConfigPromise) return this.turnConfigPromise;
    return fetchTurnConfig();
  }

  generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  async createRoom(): Promise<string> {
    this.roomCode = this.generateCode();
    this.isHost = true;
    const turnServers = await this.getTurnConfig();
    this.joinTrysteroRoom(this.roomCode, turnServers);

    // Host is slot 0
    this.lobbyState.players = [{
      peerId: selfId,
      slot: 0,
      name: '',
      color: '',
    }];

    return this.roomCode;
  }

  async joinRoom(code: string): Promise<void> {
    this.roomCode = code.toUpperCase();
    this.isHost = false;
    this.peerJoinedDuringConnect = false;
    const turnServers = await this.getTurnConfig();
    this.joinTrysteroRoom(this.roomCode, turnServers);
  }

  private joinTrysteroRoom(code: string, turnServers: TurnServer[] | null): void {
    // Use turnConfig (appends to trystero's default STUN servers) instead of rtcConfig (overwrites them)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = { appId: APP_ID, relayUrls: TRACKER_URLS };
    if (turnServers) {
      config.turnConfig = turnServers;
    }
    this.room = joinRoom(config, code);

    // Register actions
    const [sendInput, getInput] = this.room.makeAction('input');
    const [sendState, getState] = this.room.makeAction('state');
    const [sendEvent, getEvent] = this.room.makeAction('event');
    const [sendLobby, getLobby] = this.room.makeAction('lobby');
    const [sendStart, getStart] = this.room.makeAction('start');
    const [sendChat, getChat] = this.room.makeAction('chat');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- trystero's DataPayload type is too strict for our interfaces
    this.sendInput = sendInput as any;
    this.sendState = sendState as any;
    this.sendEvent = sendEvent as any;
    this.sendLobby = sendLobby as any;
    this.sendStart = sendStart as any;
    this.sendChat = sendChat as any;

    // Receive handlers
    (getInput as any)((data: PlayerInput, peerId: string) => {
      this.peerInputs.set(peerId, data);
      this.onInputReceived?.(data, peerId);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getState as any)((data: any) => {
      if (data instanceof ArrayBuffer) {
        this.onStateReceived?.(decodeGameState(data));
      } else if (ArrayBuffer.isView(data)) {
        // Trystero may deliver binary data as Uint8Array instead of ArrayBuffer
        const view = data as ArrayBufferView;
        this.onStateReceived?.(decodeGameState((view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength)));
      } else {
        this.onStateReceived?.(data as NetGameState);
      }
    });

    (getEvent as any)((data: NetEvent) => {
      this.onEventReceived?.(data);
    });

    (getLobby as any)((data: LobbyState) => {
      this.lobbyState = data;
      this.onLobbyUpdate?.(data);
    });

    (getStart as any)((data: StartMessage) => {
      this.onGameStart?.(data);
    });

    (getChat as any)((data: ChatMessage) => {
      this.onChatReceived?.(data);
    });

    // Peer events
    this.room.onPeerJoin((peerId) => {
      if (this.isHost) {
        // Assign next available slot
        const usedSlots = new Set(this.lobbyState.players.map(p => p.slot));
        let nextSlot = 1;
        while (usedSlots.has(nextSlot)) nextSlot++;

        if (nextSlot < 4) {
          this.lobbyState.players.push({
            peerId,
            slot: nextSlot,
            name: '',
            color: '',
          });
          // Delay broadcast — data channel may not be ready immediately
          setTimeout(() => this.broadcastLobby(), 200);
          setTimeout(() => this.broadcastLobby(), 1000);
        }
      } else {
        // Client: peer found during connection
        this.peerJoinedDuringConnect = true;
        console.debug('[TRON-NET] Peer joined (host found)');
        this.onConnectionProgress?.({
          phase: 'peer-found',
          relaysConnected: this.getRelayStats().connected,
          relaysTotal: TRACKER_URLS.length,
        });
      }
    });

    this.room.onPeerLeave((peerId) => {
      if (this.isHost) {
        this.lobbyState.players = this.lobbyState.players.filter(p => p.peerId !== peerId);
        this.broadcastLobby();
      }
      this.peerInputs.delete(peerId);
      this.onPeerDisconnect?.(peerId);
    });
  }

  startConnectionMonitor(): void {
    this.stopConnectionMonitor();
    this.lastPhase = null;

    this.connectionMonitorId = setInterval(() => {
      const { connected, total } = this.getRelayStats();
      let phase: ConnectionPhase;

      if (this.peerJoinedDuringConnect) {
        phase = 'peer-found';
      } else if (connected === 0) {
        phase = 'connecting-relays';
      } else {
        phase = 'searching';
      }

      if (phase !== this.lastPhase) {
        this.lastPhase = phase;
        console.debug(`[TRON-NET] Phase: ${phase} (relays: ${connected}/${total})`);
      }

      this.onConnectionProgress?.({
        phase,
        relaysConnected: connected,
        relaysTotal: total,
      });
    }, 500);
  }

  stopConnectionMonitor(): void {
    if (this.connectionMonitorId !== null) {
      clearInterval(this.connectionMonitorId);
      this.connectionMonitorId = null;
    }
    this.lastPhase = null;
  }

  resetConnectionAttempt(): void {
    this.peerJoinedDuringConnect = false;
    this.lastPhase = null;
  }

  private getRelayStats(): { connected: number; total: number } {
    try {
      const sockets = getRelaySockets();
      const entries = Object.values(sockets);
      const connected = entries.filter(ws => ws.readyState === WebSocket.OPEN).length;
      return { connected, total: entries.length || TRACKER_URLS.length };
    } catch {
      return { connected: 0, total: TRACKER_URLS.length };
    }
  }

  getFailureMode(): FailureMode {
    const { connected } = this.getRelayStats();

    // No relays connected = network/relay issue
    if (connected === 0) return 'relay-failure';

    // Relays connected but no peer found = wrong room code or host not there
    if (!this.peerJoinedDuringConnect) return 'discovery-timeout';

    // Peer found but we never got lobby = ICE failure (couldn't establish data channel)
    if (this.peerJoinedDuringConnect) return 'ice-failure';

    return 'unknown';
  }

  broadcastLobby(): void {
    if (!this.isHost) return;
    this.sendLobby(this.lobbyState);
    this.onLobbyUpdate?.(this.lobbyState);
  }

  broadcastStart(msg: StartMessage): void {
    if (!this.isHost) return;
    this.sendStart(msg);
  }

  broadcastState(state: NetGameState): void {
    if (!this.isHost) return;
    this.sendState(state);
  }

  broadcastStateBinary(data: ArrayBuffer): void {
    if (!this.isHost) return;
    this.sendState(data);
  }

  broadcastEvent(event: NetEvent): void {
    if (!this.isHost) return;
    this.sendEvent(event);
  }

  broadcastChat(msg: ChatMessage): void {
    this.sendChat(msg);
  }

  sendInputToHost(input: PlayerInput): void {
    if (this.isHost) return;
    this.sendInput(input);
  }

  getLocalSlot(): number {
    const player = this.lobbyState.players.find(p => p.peerId === selfId);
    return player ? player.slot : 0;
  }

  getPeerSlot(peerId: string): number {
    const player = this.lobbyState.players.find(p => p.peerId === peerId);
    return player ? player.slot : -1;
  }

  async pingPeer(peerId: string): Promise<number> {
    if (!this.room) return -1;
    try {
      return await this.room.ping(peerId);
    } catch {
      return -1;
    }
  }

  getPeerIds(): string[] {
    if (!this.room) return [];
    return Object.keys(this.room.getPeers());
  }

  leaveRoom(): void {
    this.stopConnectionMonitor();
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    this.roomCode = '';
    this.isHost = false;
    this.peerJoinedDuringConnect = false;
    this.lobbyState = {
      players: [],
      aiCount: 3,
      aiDifficulty: 'medium',
      roundsToWin: 3,
    };
    this.peerInputs.clear();
  }
}
