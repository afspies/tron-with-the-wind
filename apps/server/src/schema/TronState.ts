import { Schema, ArraySchema, MapSchema, type } from '@colyseus/schema';

export class TrailPointSchema extends Schema {
  @type('float32') x: number = 0;
  @type('float32') y: number = 0;
  @type('float32') z: number = 0;
}

export class BikeSchema extends Schema {
  @type('uint8') slot: number = 0;
  @type('float32') x: number = 0;
  @type('float32') y: number = 0;
  @type('float32') z: number = 0;
  @type('float32') angle: number = 0;
  @type('float32') vy: number = 0;
  @type('boolean') alive: boolean = true;
  @type('boolean') grounded: boolean = true;
  @type('float32') boostMeter: number = 0;
  @type('boolean') boosting: boolean = false;
  @type('boolean') invulnerable: boolean = false;
  @type('float32') invulnerableTimer: number = 0;
  @type('float32') doubleJumpCooldown: number = 0;
  @type('boolean') drifting: boolean = false;
  @type('float32') velocityAngle: number = 0;
  @type('float32') pitch: number = 0;
  @type('boolean') flying: boolean = false;
  @type('uint8') surfaceType: number = 0;
  @type('float32') forwardX: number = 0;
  @type('float32') forwardY: number = 0;
  @type('float32') forwardZ: number = 1;
  @type([TrailPointSchema]) trail = new ArraySchema<TrailPointSchema>();
}

export class PlayerSchema extends Schema {
  @type('string') sessionId: string = '';
  @type('uint8') slot: number = 0;
  @type('string') name: string = '';
}

export class PowerUpSchema extends Schema {
  @type('uint16') id: number = 0;
  @type('string') puType: string = 'invulnerability';
  @type('float32') x: number = 0;
  @type('float32') z: number = 0;
  @type('boolean') active: boolean = true;
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
  @type([PowerUpSchema]) powerUps = new ArraySchema<PowerUpSchema>();
  @type(['uint8']) scores = new ArraySchema<number>();
}
