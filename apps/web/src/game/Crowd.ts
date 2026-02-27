import * as THREE from 'three';
import {
  ARENA_HALF,
  STADIUM_INNER_GAP,
  STADIUM_TIER_COUNT,
  STADIUM_TIER_HEIGHT,
  STADIUM_TIER_DEPTH,
  PLAYER_COLORS,
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

    // Death reaction jump
    float jump = uReaction * 2.0;

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

export class Crowd {
  private mesh: THREE.InstancedMesh;
  private reactionTimer = 0;
  private material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    // Compute crowd positions across all tiers and sides
    const positions: Array<{ x: number; y: number; z: number; side: number }> = [];

    const sides: Array<{ axis: 'x' | 'z'; sign: 1 | -1; sideIdx: number }> = [
      { axis: 'z', sign: -1, sideIdx: 0 },
      { axis: 'z', sign: 1, sideIdx: 1 },
      { axis: 'x', sign: -1, sideIdx: 2 },
      { axis: 'x', sign: 1, sideIdx: 3 },
    ];

    const spacing = 2.0;

    for (const side of sides) {
      for (let t = 0; t < STADIUM_TIER_COUNT; t++) {
        const tierCenter = ARENA_HALF + STADIUM_INNER_GAP + t * STADIUM_TIER_DEPTH + STADIUM_TIER_DEPTH / 2;
        const tierTopY = (t + 1) * STADIUM_TIER_HEIGHT;
        const tierHalfSpan = ARENA_HALF + STADIUM_INNER_GAP + (t + 1) * STADIUM_TIER_DEPTH - STADIUM_TIER_DEPTH / 2;
        const crowdPerRow = Math.floor((tierHalfSpan * 2) / spacing);

        for (let c = 0; c < crowdPerRow; c++) {
          const along = -tierHalfSpan + spacing * 0.5 + c * spacing + (Math.random() - 0.5) * 0.5;

          if (side.axis === 'z') {
            positions.push({
              x: along,
              y: tierTopY,
              z: side.sign * tierCenter,
              side: side.sideIdx,
            });
          } else {
            positions.push({
              x: side.sign * tierCenter,
              y: tierTopY,
              z: along,
              side: side.sideIdx,
            });
          }
        }
      }
    }

    const count = positions.length;

    // Geometry: small person-sized quad
    const geo = new THREE.PlaneGeometry(0.8, 1.5);

    // Shader material
    this.material = new THREE.ShaderMaterial({
      vertexShader: CROWD_VERTEX,
      fragmentShader: CROWD_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uReaction: { value: 0 },
      },
    });

    this.mesh = new THREE.InstancedMesh(geo, this.material, count);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(count * 3), 3,
    );

    // Per-instance phase attribute
    const phases = new Float32Array(count);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const p = positions[i];

      dummy.position.set(p.x, p.y + 0.75, p.z);

      // Face toward arena center
      if (p.side === 0) dummy.rotation.y = 0;           // north side faces south
      else if (p.side === 1) dummy.rotation.y = Math.PI; // south side faces north
      else if (p.side === 2) dummy.rotation.y = Math.PI / 2;  // west faces east
      else dummy.rotation.y = -Math.PI / 2;              // east faces west

      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);

      // Random color from palette
      const color = CROWD_COLORS[Math.floor(Math.random() * CROWD_COLORS.length)];
      this.mesh.setColorAt(i, color);

      // Random phase for bobbing offset
      phases[i] = Math.random() * Math.PI * 2;
    }

    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    scene.add(this.mesh);
  }

  onDeath(): void {
    this.reactionTimer = 1.0;
  }

  update(dt: number, elapsedTime: number): void {
    this.material.uniforms.uTime.value = elapsedTime;

    // Decay reaction: quick rise (0.2s), slow settle (0.8s)
    if (this.reactionTimer > 0) {
      this.reactionTimer = Math.max(0, this.reactionTimer - dt);
      // Shaped curve: fast attack, slow decay
      const t = this.reactionTimer;
      const reaction = t > 0.8 ? (1.0 - t) / 0.2 : t / 0.8;
      this.material.uniforms.uReaction.value = reaction;
    } else {
      this.material.uniforms.uReaction.value = 0;
    }
  }
}
