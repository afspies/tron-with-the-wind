export const MAX_PLAYERS = 4;
export const ARENA_SIZE = 200;
export const ARENA_HALF = ARENA_SIZE / 2;
export const WALL_HEIGHT = 6;

export const BIKE_SPEED = 30;
export const TURN_RATE = 3; // rad/s
export const TRAIL_SAMPLE_DISTANCE = 1.0;
export const TRAIL_HEIGHT = 2.0;
export const TRAIL_SKIP_SEGMENTS = 3;
export const BIKE_COLLISION_HEIGHT = 1.0;

export const JUMP_PEAK_HEIGHT = 3.0;
export const GRAVITY = 20.0;
export const JUMP_INITIAL_VY = Math.sqrt(2 * GRAVITY * JUMP_PEAK_HEIGHT);
export const JUMP_COOLDOWN = 0.3;

export const PLAYER_COLORS = [
  '#50C878', // emerald
  '#E0115F', // ruby
  '#0F52BA', // sapphire
  '#9966CC', // amethyst
];

export const PLAYER_NAMES = ['Emerald', 'Ruby', 'Sapphire', 'Amethyst'];

// forward = (sin(angle), 0, cos(angle)), all face toward center
export const SPAWN_POSITIONS: Array<{ x: number; z: number; angle: number }> = [
  { x: -ARENA_HALF + 20, z: -ARENA_HALF + 20, angle: Math.PI * 0.25 },   // (-80,-80) -> (+,+)
  { x: ARENA_HALF - 20, z: ARENA_HALF - 20, angle: -Math.PI * 0.75 },    // (80,80)   -> (-,-)
  { x: ARENA_HALF - 20, z: -ARENA_HALF + 20, angle: -Math.PI * 0.25 },   // (80,-80)  -> (-,+)
  { x: -ARENA_HALF + 20, z: ARENA_HALF - 20, angle: Math.PI * 0.75 },    // (-80,80)  -> (+,-)
];

// Boost
export const BOOST_MULTIPLIER = 1.6;
export const BOOST_MAX = 3.0;        // seconds of boost
export const BOOST_DRAIN = 1.0;      // drain rate per second while boosting
export const BOOST_RECHARGE = 0.6;   // base recharge rate per second (non-linear curve slows at low levels)

export const COUNTDOWN_DURATION = 3;

export const NET_TICK_DURATION_MS = 1000 / 30; // ~33.33ms per tick
export const VISUAL_CORRECTION_RATE = 18; // exponential smoothing speed for visual position

// Power-ups
export const POWERUP_PICKUP_RADIUS = 3.0;
export const INVULNERABILITY_DURATION = 5.0;
export const TRAIL_DESTROY_RADIUS = 8.0;
export const POWERUP_SPAWN_INTERVAL = 10.0;
export const POWERUP_SPAWN_DELAY = 5.0;
export const POWERUP_MAX_ACTIVE = 2;
export const DOUBLE_JUMP_COOLDOWN = 30; // seconds before double-jump is available again

// Boost recharge
export const BOOST_RECHARGE_DELAY = 1.5; // seconds after releasing boost before recharge

// Trail ramp
export const TRAIL_RAMP_SEGMENTS = 5; // segments at trail end that ramp height

// Drift
export const DRIFT_TURN_MULTIPLIER = 1.8;
export const DRIFT_SPEED_MULTIPLIER = 0.85;
export const DRIFT_TRACTION = 4.0;   // low = more slide (try 2.0-8.0)
export const NORMAL_TRACTION = 60.0; // high = instant grip
