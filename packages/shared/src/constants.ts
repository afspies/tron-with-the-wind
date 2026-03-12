export const MAX_PLAYERS = 4;
export const ARENA_SIZE = 200;
export const ARENA_HALF = ARENA_SIZE / 2;
export const CEILING_HEIGHT = 60;
export const WALL_HEIGHT = CEILING_HEIGHT;

export const BIKE_SPEED = 30;
export const TURN_RATE = 3; // rad/s
export const TRAIL_SAMPLE_DISTANCE = 1.0;
export const TRAIL_HEIGHT = 2.0;
export const TRAIL_SKIP_SEGMENTS = 3;
export const BIKE_COLLISION_HEIGHT = 1.0;
export const SELF_TRAIL_GRACE_RADIUS = 4.0;

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

// Local predicted bike: snap physics to server, decay render offset smoothly
export const VISUAL_CORRECTION_RATE = 18; // exponential decay speed for render offset
export const RENDER_OFFSET_SNAP_THRESHOLD = 10; // error above which we teleport (zero offset)
export const RENDER_OFFSET_MIN_CORRECTION = 0.05; // error below which we skip correction

// Remote bikes: fractional render tick interpolation
export const REMOTE_TICK_CORRECTION_RATE = 0.1; // drift correction blend per server tick
export const REMOTE_TICK_SNAP_THRESHOLD = 2; // tick drift above which we snap

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

// Flight (boost during double-jump airborne)
export const FLIGHT_PITCH_RATE = 2.0;          // rad/s pitch-up while boosting in air
export const FLIGHT_PITCH_RETURN_RATE = 3.0;   // rad/s pitch returns to 0 when not boosting
export const FLIGHT_MAX_PITCH = 1.22;          // ~70°, prevents fully vertical flight
export const FLIGHT_THRUST = 32.0;             // upward acceleration (vs GRAVITY=20)
export const FLIGHT_AIR_TURN_MULT = 0.5;       // yaw turn rate halved during flight
export const FLIGHT_BOOST_DRAIN_MULT = 1.3;    // boost drains 30% faster during flight
export const FLIGHT_LANDING_MAX_PITCH = 0.79;  // ~45°, steep landings kill

// Trail ramp
export const TRAIL_RAMP_SEGMENTS = 5; // segments at trail end that ramp height

// Wall driving
export const RAMP_RADIUS = 8;
export const WALL_MIN_SPEED = 8;
export const WALL_MAX_SPEED = 60;
export const CEILING_RESTITUTION = 0.5;
export const WALL_ATTACH_MIN_VEL = 5;

// Stadium
export const STADIUM_INNER_GAP = 5;
export const STADIUM_TIER_COUNT = 8;
export const STADIUM_TIER_HEIGHT = 5;
export const STADIUM_TIER_DEPTH = 7;
export const STADIUM_SIDES: Array<{ axis: 'x' | 'z'; sign: 1 | -1 }> = [
  { axis: 'z', sign: -1 }, // north
  { axis: 'z', sign: 1 },  // south
  { axis: 'x', sign: -1 }, // west
  { axis: 'x', sign: 1 },  // east
];

// Drift
export const DRIFT_TURN_MULTIPLIER = 1.8;
export const DRIFT_SPEED_MULTIPLIER = 0.85;
export const DRIFT_TRACTION = 4.0;   // low = more slide (try 2.0-8.0)
export const NORMAL_TRACTION = 60.0; // high = instant grip
