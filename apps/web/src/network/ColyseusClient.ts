import { Client, Room } from 'colyseus.js';
import { ClientMsg, ServerMsg } from '@tron/shared';
import type { PlayerInput, AIDifficulty } from '@tron/shared';
import type { ChatMessage } from '../ui/Chat';

const DEFAULT_SERVER_URL = 'ws://localhost:2567';

function getServerUrl(): string {
  // Allow override via env variable at build time
  return (import.meta as any).env?.VITE_COLYSEUS_URL || DEFAULT_SERVER_URL;
}

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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

  // Callbacks
  onStateChange: (() => void) | null = null;
  onChatReceived: ((msg: ChatMessage) => void) | null = null;
  onPowerUpEvent: ((event: any) => void) | null = null;
  onDisconnect: ((code: number) => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  constructor() {
    this.client = new Client(getServerUrl());
  }

  async createRoom(options?: { aiCount?: number; aiDifficulty?: AIDifficulty; roundsToWin?: number }): Promise<string> {
    this.roomCode = generateCode();
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

  sendInput(input: PlayerInput): void {
    this.room?.send(ClientMsg.Input, input);
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
