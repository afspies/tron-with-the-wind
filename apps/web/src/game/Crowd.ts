import * as THREE from 'three';
import {
  ARENA_HALF,
  STADIUM_INNER_GAP,
  STADIUM_TIER_COUNT,
  STADIUM_TIER_HEIGHT,
  STADIUM_TIER_DEPTH,
  PLAYER_COLORS,
  STADIUM_SIDES,
} from '@tron/shared';

const CROWD_VERTEX = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uReaction;

  varying vec3 vColor;

  void main() {
    vColor = instanceColor;

    vec3 pos = position;

    // Idle bobbing
    float bob = sin(uTime * 1.5 + aPhase) * 0.15;

    // Death reaction jump - vary height per instance
    float jump = uReaction * (1.5 + aPhase * 0.8);

    pos.y += bob + jump;

    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const CROWD_FRAGMENT = /* glsl */ `
  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

const CROWD_COLORS = [
  ...PLAYER_COLORS.map(c => new THREE.Color(c)),
  new THREE.Color(0x888888),
  new THREE.Color(0xaaaaaa),
  new THREE.Color(0x6644aa),
  new THREE.Color(0x4466aa),
];

// Sprite dimensions
const SPRITE_WIDTH = 0.8;
const SPRITE_HEIGHT = 1.5;
const SPRITE_Y_OFFSET = SPRITE_HEIGHT / 2;
const SPRITE_Y_JITTER = 0.4;

// Spacing between crowd sprites per tier
const LOWER_TIER_SPACING = 2.0;
const UPPER_TIER_SPACING = 3.0;
const UPPER_TIER_THRESHOLD = 5;
const POSITION_JITTER = 0.5;

// Rotation to face arena center, indexed by side: north, south, west, east
const SIDE_ROTATIONS = [0, Math.PI, Math.PI / 2, -Math.PI / 2];

interface CrowdPosition {
  x: number;
  y: number;
  z: number;
}

// Max vertical shader displacement: bob (0.15) + reaction jump (max ~6.5 when aPhase ≈ 2π)
const MAX_SHADER_DISPLACEMENT = 7;

export class Crowd {
  private meshes: THREE.InstancedMesh[] = [];
  private reactionTimer = 0;
  private material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const buckets: CrowdPosition[][] = [[], [], [], []];

    for (let sideIdx = 0; sideIdx < STADIUM_SIDES.length; sideIdx++) {
      const side = STADIUM_SIDES[sideIdx];

      for (let t = 0; t < STADIUM_TIER_COUNT; t++) {
        const spacing = t >= UPPER_TIER_THRESHOLD ? UPPER_TIER_SPACING : LOWER_TIER_SPACING;
        const tierCenter = ARENA_HALF + STADIUM_INNER_GAP + t * STADIUM_TIER_DEPTH + STADIUM_TIER_DEPTH / 2;
        const tierTopY = (t + 1) * STADIUM_TIER_HEIGHT;
        const tierHalfSpan = ARENA_HALF + STADIUM_INNER_GAP + (t + 1) * STADIUM_TIER_DEPTH - STADIUM_TIER_DEPTH / 2;
        const crowdPerRow = Math.floor((tierHalfSpan * 2) / spacing);

        for (let c = 0; c < crowdPerRow; c++) {
          const along = -tierHalfSpan + spacing * 0.5 + c * spacing + (Math.random() - 0.5) * POSITION_JITTER;
          const depthPos = side.sign * tierCenter;

          const x = side.axis === 'z' ? along : depthPos;
          const z = side.axis === 'z' ? depthPos : along;

          buckets[sideIdx].push({ x, y: tierTopY, z });
        }
      }
    }

    const geo = new THREE.PlaneGeometry(SPRITE_WIDTH, SPRITE_HEIGHT);

    this.material = new THREE.ShaderMaterial({
      vertexShader: CROWD_VERTEX,
      fragmentShader: CROWD_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uReaction: { value: 0 },
      },
    });

    const dummy = new THREE.Object3D();

    for (let sideIdx = 0; sideIdx < 4; sideIdx++) {
      const positions = buckets[sideIdx];
      const count = positions.length;

      const mesh = new THREE.InstancedMesh(geo, this.material, count);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

      const phases = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const p = positions[i];

        dummy.position.set(p.x, p.y + SPRITE_Y_OFFSET + (Math.random() - 0.5) * SPRITE_Y_JITTER, p.z);
        dummy.rotation.y = SIDE_ROTATIONS[sideIdx];
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        const color = CROWD_COLORS[Math.floor(Math.random() * CROWD_COLORS.length)];
        mesh.setColorAt(i, color);

        phases[i] = Math.random() * Math.PI * 2;
      }

      // Each mesh needs its own geometry clone to hold its own aPhase attribute
      const sideGeo = geo.clone();
      sideGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
      mesh.geometry = sideGeo;

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) {
        mesh.boundingSphere.radius += MAX_SHADER_DISPLACEMENT;
      }

      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  onDeath(): void {
    this.reactionTimer = 1.0;
  }

  update(dt: number, elapsedTime: number): void {
    this.material.uniforms.uTime.value = elapsedTime;

    // Decay reaction: quick rise (0.2s), slow settle (0.8s)
    if (this.reactionTimer > 0) {
      this.reactionTimer = Math.max(0, this.reactionTimer - dt);
      const t = this.reactionTimer;
      const reaction = t > 0.8 ? (1.0 - t) / 0.2 : t / 0.8;
      this.material.uniforms.uReaction.value = reaction;
    } else {
      this.material.uniforms.uReaction.value = 0;
    }
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.material.dispose();
  }
}
