import type { Vec2, Vec3, PlayerInput } from '@tron/shared';
import {
  BIKE_SPEED, TURN_RATE,
  JUMP_INITIAL_VY, GRAVITY, JUMP_COOLDOWN,
  BOOST_MULTIPLIER, BOOST_MAX, BOOST_DRAIN, BOOST_RECHARGE, BOOST_RECHARGE_DELAY,
  ARENA_HALF, ARENA_CEILING_HEIGHT, TRAIL_DESTROY_RADIUS,
  DOUBLE_JUMP_COOLDOWN,
  DRIFT_TURN_MULTIPLIER, DRIFT_SPEED_MULTIPLIER, DRIFT_TRACTION, NORMAL_TRACTION,
  FLIGHT_PITCH_RATE, FLIGHT_MAX_PITCH,
  FLIGHT_THRUST, FLIGHT_AIR_TURN_MULT, FLIGHT_BOOST_DRAIN_MULT,
  BIKE_COLLISION_HEIGHT,
  WORLD_BOUNCE_RESTITUTION, WORLD_BOUNCE_MIN_SPEED, WORLD_BOUNCE_TANGENT_DAMPING,
  WALL_RIDE_GRAVITY_MULTIPLIER, WALL_RIDE_CLIMB_MULTIPLIER, WALL_RIDE_ATTACH_DOT_MIN,
  WALL_RIDE_STICK_DISTANCE, WALL_HEIGHT, MAP_PLATFORMS,
  WALL_RAMP_WIDTH, WALL_RAMP_DEPTH, WALL_RAMP_HEIGHT,
} from '@tron/shared';
import { SimTrail } from './SimTrail';
import { checkTrailCollision, checkTrailCollisionDetailed, type TrailHitInfo } from './Collision';
import type { SimPowerUpEffect } from './powerups/SimPowerUpEffect';
import { createSimEffect } from './powerups/SimPowerUpRegistry';

export class SimBike {
  position: Vec3;
  angle: number;
  speed: number;
  vy = 0;
  alive = true;
  grounded = true;
  jumpCooldown = 0;
  boostMeter = BOOST_MAX;
  boosting = false;
  playerIndex: number;
  color: string;
  trail: SimTrail;

  pitch = 0;
  flying = false;
  wallNormal: Vec2 | null = null;

  activeEffect: SimPowerUpEffect | null = null;
  effectTimer = 0;

  get invulnerable(): boolean {
    return this.activeEffect?.type === 'invulnerability' && this.effectTimer > 0;
  }

  get invulnerableTimer(): number {
    return this.invulnerable ? this.effectTimer : 0;
  }

  lastTrailDestruction: TrailHitInfo | null = null;

  doubleJumpReady = true;
  doubleJumpCooldown = 0;
  usedDoubleJumpThisAirborne = false;
  boostRechargeTimer = 0;

  drifting = false;
  velocityAngle!: number;
  driftTimer = 0;
  vx!: number;
  vz!: number;

  constructor(playerIndex: number, color: string, x: number, z: number, angle: number) {
    this.playerIndex = playerIndex;
    this.color = color;
    this.position = { x, y: 0, z };
    this.angle = angle;
    this.speed = BIKE_SPEED;
    this.initVelocity(angle);
    this.trail = new SimTrail();
  }

  update(dt: number, input: PlayerInput, allTrails: SimTrail[], skipCollision = false): void {
    if (!this.alive) return;

    const oldPos: Vec3 = { x: this.position.x, y: this.position.y, z: this.position.z };
    const oldPos2D: Vec2 = { x: oldPos.x, z: oldPos.z };

    const wantsDrift = input.drift && this.grounded && !this.wallNormal;
    if (wantsDrift !== this.drifting) {
      this.drifting = wantsDrift;
      this.driftTimer = 0;
    }
    if (this.drifting) this.driftTimer += dt;

    const turnRate = this.drifting ? TURN_RATE * DRIFT_TURN_MULTIPLIER
      : this.flying ? TURN_RATE * FLIGHT_AIR_TURN_MULT
      : TURN_RATE;
    if (input.left) this.angle += turnRate * dt;
    if (input.right) this.angle -= turnRate * dt;

    this.boosting = input.boost && this.boostMeter > 0;
    this.flying = !this.grounded && !this.wallNormal && this.boosting;

    if (this.boosting) {
      const drain = this.flying ? BOOST_DRAIN * FLIGHT_BOOST_DRAIN_MULT : BOOST_DRAIN;
      this.boostMeter = Math.max(0, this.boostMeter - drain * dt);
      this.boostRechargeTimer = BOOST_RECHARGE_DELAY;
    } else if (this.boostRechargeTimer > 0) {
      this.boostRechargeTimer -= dt;
    } else {
      const fillFraction = this.boostMeter / BOOST_MAX;
      const rate = BOOST_RECHARGE * (0.3 + 0.7 * fillFraction);
      this.boostMeter = Math.min(BOOST_MAX, this.boostMeter + rate * dt);
    }

    const driftMul = this.drifting ? DRIFT_SPEED_MULTIPLIER : 1.0;
    const currentSpeed = this.speed * (this.boosting ? BOOST_MULTIPLIER : 1.0) * driftMul;
    const forward: Vec2 = { x: Math.sin(this.angle), z: Math.cos(this.angle) };

    if (!this.grounded && !this.wallNormal) {
      if (input.pitchUp) {
        this.pitch = Math.min(FLIGHT_MAX_PITCH, this.pitch + FLIGHT_PITCH_RATE * dt);
      } else if (input.pitchDown) {
        this.pitch = Math.max(0, this.pitch - FLIGHT_PITCH_RATE * dt);
      }
    } else {
      this.pitch = 0;
    }

    const desiredVx = forward.x * currentSpeed;
    const desiredVz = forward.z * currentSpeed;
    const traction = this.drifting ? DRIFT_TRACTION : NORMAL_TRACTION;
    const blendFactor = 1 - Math.exp(-traction * dt);
    this.vx += (desiredVx - this.vx) * blendFactor;
    this.vz += (desiredVz - this.vz) * blendFactor;

    const len = Math.sqrt(this.vx * this.vx + this.vz * this.vz);
    if (len > 0.001) {
      this.vx = (this.vx / len) * currentSpeed;
      this.vz = (this.vz / len) * currentSpeed;
    }
    this.velocityAngle = Math.atan2(this.vx, this.vz);

    if (this.wallNormal) {
      this.moveAlongWall(dt, currentSpeed, forward);
    } else if (this.flying) {
      const horizSpeed = BIKE_SPEED * BOOST_MULTIPLIER * Math.cos(this.pitch);
      this.position.x += forward.x * horizSpeed * dt;
      this.position.z += forward.z * horizSpeed * dt;
      this.vy += FLIGHT_THRUST * Math.sin(this.pitch) * dt;
    } else if (!this.grounded && this.pitch > 0) {
      const horizSpeed = BIKE_SPEED * Math.cos(this.pitch);
      this.position.x += forward.x * horizSpeed * dt;
      this.position.z += forward.z * horizSpeed * dt;
    } else {
      this.position.x += this.vx * dt;
      this.position.z += this.vz * dt;
    }

    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (input.jump && this.jumpCooldown <= 0) {
      if (this.wallNormal) {
        this.jumpOffWall(currentSpeed);
      } else if (this.grounded) {
        this.vy = JUMP_INITIAL_VY;
        this.grounded = false;
        this.jumpCooldown = JUMP_COOLDOWN;
        this.usedDoubleJumpThisAirborne = false;
      } else if (this.doubleJumpReady) {
        this.vy = JUMP_INITIAL_VY;
        this.usedDoubleJumpThisAirborne = true;
        this.doubleJumpReady = false;
        this.doubleJumpCooldown = DOUBLE_JUMP_COOLDOWN;
        this.jumpCooldown = JUMP_COOLDOWN;
      }
    }

    if (this.wallNormal) {
      this.position.y += this.vy * dt;
      this.vy -= GRAVITY * WALL_RIDE_GRAVITY_MULTIPLIER * dt;
    } else if (!this.grounded) {
      this.position.y += this.vy * dt;
      this.vy -= GRAVITY * dt;
    }

    this.resolveFloorContact();
    this.resolveCeilingBounce();
    this.resolveArenaWallContact(forward, currentSpeed);
    this.resolvePlatformCollisions(oldPos);
    this.resolvePlatformSupport();

    const newPos: Vec2 = { x: this.position.x, z: this.position.z };

    if (this.activeEffect) {
      if (!this.activeEffect.onUpdate(this, dt)) {
        const effect = this.activeEffect;
        this.activeEffect = null;
        effect.onExpire(this);
      }
    }

    if (!this.doubleJumpReady) {
      this.doubleJumpCooldown -= dt;
      if (this.doubleJumpCooldown <= 0) {
        this.doubleJumpReady = true;
        this.doubleJumpCooldown = 0;
      }
    }

    if (!skipCollision) {
      if (this.invulnerable) {
        const hit = checkTrailCollisionDetailed(oldPos2D, newPos, this.position.y, allTrails, this.playerIndex);
        if (hit && hit.trailIndex !== this.playerIndex) {
          allTrails[hit.trailIndex].deleteSegmentsInRadius(hit.contactX, hit.contactZ, TRAIL_DESTROY_RADIUS);
          this.lastTrailDestruction = hit;
        }
      } else if (checkTrailCollision(oldPos2D, newPos, this.position.y, allTrails, this.playerIndex)) {
        this.die();
        return;
      }
    }

    this.trail.addPoint(this.position.x, this.position.y, this.position.z);
  }

  private moveAlongWall(dt: number, currentSpeed: number, forward: Vec2): void {
    if (!this.wallNormal) return;

    const normal = this.wallNormal;
    const tangent = { x: normal.z, z: -normal.x };
    const alongWall = forward.x * tangent.x + forward.z * tangent.z;
    const intoWall = Math.max(0, -(forward.x * normal.x + forward.z * normal.z));

    this.vy += currentSpeed * intoWall * WALL_RIDE_CLIMB_MULTIPLIER * dt;
    this.position.x += tangent.x * currentSpeed * alongWall * dt;
    this.position.z += tangent.z * currentSpeed * alongWall * dt;

    this.stickToWall(normal);

    const facingAway = forward.x * normal.x + forward.z * normal.z;
    if (facingAway > 0.35) {
      this.wallNormal = null;
    }
  }

  private jumpOffWall(currentSpeed: number): void {
    if (!this.wallNormal) return;
    const normal = this.wallNormal;
    this.wallNormal = null;
    this.vy = JUMP_INITIAL_VY;
    this.vx += normal.x * currentSpeed * 0.5;
    this.vz += normal.z * currentSpeed * 0.5;
    this.grounded = false;
    this.jumpCooldown = JUMP_COOLDOWN;
  }

  private resolveFloorContact(): void {
    const supportY = this.getGroundSupportY(this.position.x, this.position.z);
    if (this.position.y > supportY) return;
    const wasOffGround = !this.grounded || this.wallNormal !== null;
    this.position.y = supportY;
    this.vy = 0;
    this.grounded = true;
    this.pitch = 0;
    this.flying = false;
    this.wallNormal = null;
    if (wasOffGround) {
      this.jumpCooldown = Math.max(this.jumpCooldown, JUMP_COOLDOWN);
    }
  }

  private resolveCeilingBounce(): void {
    const ceilingBaseY = ARENA_CEILING_HEIGHT - BIKE_COLLISION_HEIGHT;
    if (this.position.y <= ceilingBaseY) return;

    this.position.y = ceilingBaseY;
    if (this.vy > 0) {
      this.vy = -Math.max(this.vy * WORLD_BOUNCE_RESTITUTION, WORLD_BOUNCE_MIN_SPEED);
    }
    this.grounded = false;
    this.flying = false;
    this.wallNormal = null;
    this.pitch = 0;
  }

  private resolveArenaWallContact(forward: Vec2, currentSpeed: number): void {
    if (this.position.x > ARENA_HALF) {
      this.position.x = ARENA_HALF;
      this.handleSideSurface({ x: -1, z: 0 }, forward, currentSpeed);
    } else if (this.position.x < -ARENA_HALF) {
      this.position.x = -ARENA_HALF;
      this.handleSideSurface({ x: 1, z: 0 }, forward, currentSpeed);
    }

    if (this.position.z > ARENA_HALF) {
      this.position.z = ARENA_HALF;
      this.handleSideSurface({ x: 0, z: -1 }, forward, currentSpeed);
    } else if (this.position.z < -ARENA_HALF) {
      this.position.z = -ARENA_HALF;
      this.handleSideSurface({ x: 0, z: 1 }, forward, currentSpeed);
    }

    if (this.wallNormal) {
      const dist = this.wallNormal.x !== 0
        ? Math.abs(Math.abs(this.position.x) - ARENA_HALF)
        : Math.abs(Math.abs(this.position.z) - ARENA_HALF);
      if (dist > WALL_RIDE_STICK_DISTANCE) this.wallNormal = null;
    }
  }

  private handleSideSurface(normal: Vec2, forward: Vec2, currentSpeed: number): void {
    const intoWall = -(forward.x * normal.x + forward.z * normal.z);
    const canAttach = this.position.y >= 0 && this.position.y <= WALL_HEIGHT && intoWall > WALL_RIDE_ATTACH_DOT_MIN;

    if (canAttach) {
      this.wallNormal = { x: normal.x, z: normal.z };
      this.grounded = false;
      this.flying = false;
      this.vy = Math.max(this.vy, currentSpeed * intoWall * WALL_RIDE_CLIMB_MULTIPLIER * 0.35);
      this.stickToWall(normal);
      return;
    }

    this.wallNormal = null;
    this.reflectHorizontal(normal);
  }

  private resolvePlatformCollisions(oldPos: Vec3): void {
    for (const p of MAP_PLATFORMS) {
      const minX = p.x - p.width * 0.5;
      const maxX = p.x + p.width * 0.5;
      const minY = p.y - p.height * 0.5;
      const maxY = p.y + p.height * 0.5;
      const minZ = p.z - p.depth * 0.5;
      const maxZ = p.z + p.depth * 0.5;

      const withinX = this.position.x >= minX && this.position.x <= maxX;
      const withinZ = this.position.z >= minZ && this.position.z <= maxZ;

      if (withinX && withinZ) {
        if (oldPos.y >= maxY && this.position.y <= maxY && this.vy <= 0) {
          this.position.y = maxY;
          this.vy = 0;
          this.grounded = true;
          this.flying = false;
          this.wallNormal = null;
          this.pitch = 0;
          return;
        }

        const oldTop = oldPos.y + BIKE_COLLISION_HEIGHT;
        const newTop = this.position.y + BIKE_COLLISION_HEIGHT;
        if (oldTop <= minY && newTop >= minY && this.vy > 0) {
          this.position.y = minY - BIKE_COLLISION_HEIGHT;
          this.vy = -Math.max(this.vy * WORLD_BOUNCE_RESTITUTION, WORLD_BOUNCE_MIN_SPEED);
          this.grounded = false;
          this.flying = false;
          this.wallNormal = null;
          this.pitch = 0;
        }
      }

      const overlapsY = this.position.y < maxY && this.position.y + BIKE_COLLISION_HEIGHT > minY;
      if (!overlapsY) continue;

      if (this.position.z >= minZ && this.position.z <= maxZ) {
        if (oldPos.x <= minX && this.position.x > minX) {
          this.position.x = minX;
          this.reflectHorizontal({ x: -1, z: 0 });
        } else if (oldPos.x >= maxX && this.position.x < maxX) {
          this.position.x = maxX;
          this.reflectHorizontal({ x: 1, z: 0 });
        }
      }

      if (this.position.x >= minX && this.position.x <= maxX) {
        if (oldPos.z <= minZ && this.position.z > minZ) {
          this.position.z = minZ;
          this.reflectHorizontal({ x: 0, z: -1 });
        } else if (oldPos.z >= maxZ && this.position.z < maxZ) {
          this.position.z = maxZ;
          this.reflectHorizontal({ x: 0, z: 1 });
        }
      }
    }
  }

  private resolvePlatformSupport(): void {
    if (!this.grounded || this.wallNormal) return;

    const supportY = this.getGroundSupportY(this.position.x, this.position.z);
    if (Math.abs(this.position.y - supportY) < 0.05) return;

    for (const p of MAP_PLATFORMS) {
      const minX = p.x - p.width * 0.5;
      const maxX = p.x + p.width * 0.5;
      const maxY = p.y + p.height * 0.5;
      const minZ = p.z - p.depth * 0.5;
      const maxZ = p.z + p.depth * 0.5;

      const nearTop = Math.abs(this.position.y - maxY) < 0.05;
      const withinX = this.position.x >= minX && this.position.x <= maxX;
      const withinZ = this.position.z >= minZ && this.position.z <= maxZ;
      if (nearTop && withinX && withinZ) return;
    }

    this.grounded = false;
  }

  private reflectHorizontal(normal: Vec2): void {
    const tangent = { x: -normal.z, z: normal.x };
    const vn = this.vx * normal.x + this.vz * normal.z;
    if (vn >= 0) return;

    const reflectedVx = this.vx - (1 + WORLD_BOUNCE_RESTITUTION) * vn * normal.x;
    const reflectedVz = this.vz - (1 + WORLD_BOUNCE_RESTITUTION) * vn * normal.z;

    const outN = reflectedVx * normal.x + reflectedVz * normal.z;
    const outT = (reflectedVx * tangent.x + reflectedVz * tangent.z) * WORLD_BOUNCE_TANGENT_DAMPING;

    this.vx = outN * normal.x + outT * tangent.x;
    this.vz = outN * normal.z + outT * tangent.z;

    this.velocityAngle = Math.atan2(this.vx, this.vz);
    this.angle = this.velocityAngle;
  }

  private stickToWall(normal: Vec2): void {
    if (normal.x !== 0) this.position.x = -normal.x * ARENA_HALF;
    if (normal.z !== 0) this.position.z = -normal.z * ARENA_HALF;
  }

  private getGroundSupportY(x: number, z: number): number {
    return Math.max(0, this.getRampHeightAt(x, z));
  }

  private getRampHeightAt(x: number, z: number): number {
    let rampY = 0;

    if (Math.abs(x) <= WALL_RAMP_WIDTH * 0.5) {
      const northDist = ARENA_HALF - z;
      if (northDist >= 0 && northDist <= WALL_RAMP_DEPTH) {
        rampY = Math.max(rampY, (1 - northDist / WALL_RAMP_DEPTH) * WALL_RAMP_HEIGHT);
      }

      const southDist = ARENA_HALF + z;
      if (southDist >= 0 && southDist <= WALL_RAMP_DEPTH) {
        rampY = Math.max(rampY, (1 - southDist / WALL_RAMP_DEPTH) * WALL_RAMP_HEIGHT);
      }
    }

    if (Math.abs(z) <= WALL_RAMP_WIDTH * 0.5) {
      const eastDist = ARENA_HALF - x;
      if (eastDist >= 0 && eastDist <= WALL_RAMP_DEPTH) {
        rampY = Math.max(rampY, (1 - eastDist / WALL_RAMP_DEPTH) * WALL_RAMP_HEIGHT);
      }

      const westDist = ARENA_HALF + x;
      if (westDist >= 0 && westDist <= WALL_RAMP_DEPTH) {
        rampY = Math.max(rampY, (1 - westDist / WALL_RAMP_DEPTH) * WALL_RAMP_HEIGHT);
      }
    }

    return rampY;
  }

  grantInvulnerability(): void {
    createSimEffect('invulnerability')?.onGrant(this);
  }

  private initVelocity(angle: number): void {
    this.velocityAngle = angle;
    this.vx = Math.sin(angle) * BIKE_SPEED;
    this.vz = Math.cos(angle) * BIKE_SPEED;
  }

  private die(): void {
    this.alive = false;
    const effect = this.activeEffect;
    this.activeEffect = null;
    effect?.onExpire(this);
  }

  reset(x: number, z: number, angle: number): void {
    this.position = { x, y: 0, z };
    this.angle = angle;
    this.vy = 0;
    this.alive = true;
    this.grounded = true;
    this.jumpCooldown = 0;
    this.boostMeter = BOOST_MAX;
    this.boosting = false;
    const effect = this.activeEffect;
    this.activeEffect = null;
    effect?.onExpire(this);
    this.lastTrailDestruction = null;
    this.doubleJumpReady = true;
    this.doubleJumpCooldown = 0;
    this.usedDoubleJumpThisAirborne = false;
    this.boostRechargeTimer = 0;
    this.drifting = false;
    this.driftTimer = 0;
    this.initVelocity(angle);
    this.pitch = 0;
    this.flying = false;
    this.wallNormal = null;
    this.trail.reset();
  }
}
