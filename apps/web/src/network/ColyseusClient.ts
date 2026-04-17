import { Client, Room } from 'colyseus.js';
import { ClientMsg, ServerMsg } from '@tron/shared';
import type { PlayerInput, AIDifficulty } from '@tron/shared';
import type { ChatMessage } from '../ui/Chat';
import { getRandomWord } from '../data/words';

function getServerUrl(): string {
  // Allow explicit override via build-time env variable
  const envUrl = (import.meta as any).env?.VITE_COLYSEUS_URL;
  if (envUrl) return envUrl;

  // Derive server URL from current page hostname
  const { hostname, protocol } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'ws://localhost:2567';
  }

  const wsProtocol = protocol === 'https:' ? 'wss' : 'ws';

  // tron.afspies.com → tron-server.afspies.com
  // tron-staging.afspies.com → tron-staging-server.afspies.com
  // pr-42.tron.afspies.com → pr-42.tron-server.afspies.com
  const serverHost = hostname.replace('tron.', 'tron-server.');
  return `${wsProtocol}://${serverHost}`;
}

export interface LobbyPlayer {
  sessionId: string;
  slot: number;
  name: string;
}

export interface LobbyState {
  players: LobbyPlayer[];
  aiCount: number;
  aiDifficulty: AIDifficulty;
  roundsToWin: number;
}

export class ColyseusClient {
  private client: Client;
  room: Room | null = null;
  roomCode = '';
  isHost = false;
  localSessionId = '';

  // Monotonically increasing seq stamped onto every outbound PlayerInput.
  // The server echoes the last-processed seq back on BikeSchema.lastInputSeq
  // so the client can replay unacked inputs after a rewind.
  private nextInputSeq = 1;

  // Callbacks
  onStateChange: (() => void) | null = null;
  onChatReceived: ((msg: ChatMessage) => void) | null = null;
  onPowerUpEvent: ((event: any) => void) | null = null;
  onDisconnect: ((code: number) => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  constructor() {
    this.client = new Client(getServerUrl());
  }

  async createRoom(options?: { aiCount?: number; aiDifficulty?: AIDifficulty; roundsToWin?: number; name?: string }): Promise<string> {
    this.roomCode = getRandomWord();
    this.room = await this.client.create('tron', {
      roomCode: this.roomCode,
      ...options,
    });
    this.localSessionId = this.room.sessionId;
    this.isHost = true;
    this.setupRoomListeners();
    return this.roomCode;
  }

  async joinRoom(code: string, options?: { name?: string }): Promise<void> {
    this.roomCode = code.toUpperCase();
    this.room = await this.client.join('tron', {
      roomCode: this.roomCode,
      ...options,
    });
    this.localSessionId = this.room.sessionId;
    this.isHost = false;
    this.setupRoomListeners();

    // Check if we're the host (first player)
    this.updateHostStatus();
  }

  private setupRoomListeners(): void {
    if (!this.room) return;

    this.room.onStateChange(() => {
      this.updateHostStatus();
      this.onStateChange?.();
    });

    this.room.onMessage(ServerMsg.Chat, (data: ChatMessage) => {
      this.onChatReceived?.(data);
    });

    this.room.onMessage(ServerMsg.PowerUpEffect, (data: any) => {
      this.onPowerUpEvent?.(data);
    });

    this.room.onLeave((code: number) => {
      this.onDisconnect?.(code);
    });

    this.room.onError((code, message) => {
      this.onError?.(new Error(`Room error ${code}: ${message}`));
    });
  }

  private updateHostStatus(): void {
    if (!this.room?.state) return;
    const state = this.room.state as any;
    this.isHost = state.hostSessionId === this.localSessionId;
  }

  /** Send a PlayerInput to the server, stamping it with a fresh sequence number. Returns the seq assigned. */
  sendInput(input: PlayerInput): number {
    const seq = this.nextInputSeq++;
    input.inputSeq = seq;
    this.room?.send(ClientMsg.Input, input);
    return seq;
  }

  /** Reset the input seq counter — call when starting a new round/match. */
  resetInputSeq(): void {
    this.nextInputSeq = 1;
  }

  sendChat(text: string): void {
    this.room?.send(ClientMsg.Chat, { text });
  }

  sendConfig(config: { aiCount?: number; aiDifficulty?: string; roundsToWin?: number }): void {
    this.room?.send(ClientMsg.SetConfig, config);
  }

  sendStartGame(): void {
    this.room?.send(ClientMsg.StartGame, {});
  }

  sendPlayAgain(): void {
    this.room?.send(ClientMsg.PlayAgain, {});
  }

  getLocalSlot(): number {
    if (!this.room?.state) return 0;
    const state = this.room.state as any;
    const player = state.players?.get(this.localSessionId);
    return player ? player.slot : 0;
  }

  getLobbyState(): LobbyState {
    if (!this.room?.state) {
      return { players: [], aiCount: 0, aiDifficulty: 'medium', roundsToWin: 3 };
    }
    const state = this.room.state as any;
    const players: LobbyPlayer[] = [];
    state.players?.forEach((p: any) => {
      players.push({ sessionId: p.sessionId, slot: p.slot, name: p.name });
    });
    return {
      players,
      aiCount: state.aiCount ?? 0,
      aiDifficulty: (state.aiDifficulty ?? 'medium') as AIDifficulty,
      roundsToWin: state.roundsToWin ?? 3,
    };
  }

  leave(): void {
    this.room?.leave();
    this.room = null;
    this.roomCode = '';
    this.isHost = false;
    this.localSessionId = '';
  }
}
