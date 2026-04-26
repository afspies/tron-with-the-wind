import { Schema, ArraySchema, MapSchema, type } from '@colyseus/schema';

export class BikeSchema extends Schema {
  @type('uint8') slot: number = 0;
  @type('float32') x: number = 0;
  @type('float32') y: number = 0;
  @type('float32') z: number = 0;
  @type('float32') angle: number = 0;
  @type('boolean') alive: boolean = true;
}

export class PlayerSchema extends Schema {
  @type('string') sessionId: string = '';
  @type('uint8') slot: number = 0;
  @type('string') name: string = '';
}

export class TronState extends Schema {
  @type('string') phase: string = 'lobby';
  @type('uint8') roundNumber: number = 0;
  @type('uint8') roundsToWin: number = 3;
  @type('float32') countdownTimer: number = 0;
  @type('uint32') tick: number = 0;
  @type('uint8') aiCount: number = 0;
  @type('string') aiDifficulty: string = 'medium';
  @type('string') hostSessionId: string = '';

  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type([BikeSchema]) bikes = new ArraySchema<BikeSchema>();
  @type(['uint8']) scores = new ArraySchema<number>();
}
