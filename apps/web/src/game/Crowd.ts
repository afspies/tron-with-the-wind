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

    // Death reaction jump — vary height per instance
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

export class Crowd {
  private meshes: THREE.InstancedMesh[] = [];
  private reactionTimer = 0;
  private material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    // Compute crowd positions across all tiers and sides, bucketed by side
    const buckets: Array<Array<{ x: number; y: number; z: number; sideIdx: number }>> = [[], [], [], []];

    const sides: Array<{ axis: 'x' | 'z'; sign: 1 | -1; sideIdx: number }> = [
      { axis: 'z', sign: -1, sideIdx: 0 },
      { axis: 'z', sign: 1, sideIdx: 1 },
      { axis: 'x', sign: -1, sideIdx: 2 },
      { axis: 'x', sign: 1, sideIdx: 3 },
    ];

    for (const side of sides) {
      for (let t = 0; t < STADIUM_TIER_COUNT; t++) {
        const tierSpacing = t >= 5 ? 3.0 : 2.0;
        const tierCenter = ARENA_HALF + STADIUM_INNER_GAP + t * STADIUM_TIER_DEPTH + STADIUM_TIER_DEPTH / 2;
        const tierTopY = (t + 1) * STADIUM_TIER_HEIGHT;
        const tierHalfSpan = ARENA_HALF + STADIUM_INNER_GAP + (t + 1) * STADIUM_TIER_DEPTH - STADIUM_TIER_DEPTH / 2;
        const crowdPerRow = Math.floor((tierHalfSpan * 2) / tierSpacing);

        for (let c = 0; c < crowdPerRow; c++) {
          const along = -tierHalfSpan + tierSpacing * 0.5 + c * tierSpacing + (Math.random() - 0.5) * 0.5;

          if (side.axis === 'z') {
            buckets[side.sideIdx].push({
              x: along,
              y: tierTopY,
              z: side.sign * tierCenter,
              sideIdx: side.sideIdx,
            });
          } else {
            buckets[side.sideIdx].push({
              x: side.sign * tierCenter,
              y: tierTopY,
              z: along,
              sideIdx: side.sideIdx,
            });
          }
        }
      }
    }

    // Shared geometry and material
    const geo = new THREE.PlaneGeometry(0.8, 1.5);

    this.material = new THREE.ShaderMaterial({
      vertexShader: CROWD_VERTEX,
      fragmentShader: CROWD_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uReaction: { value: 0 },
      },
    });

    const dummy = new THREE.Object3D();

    // Create one InstancedMesh per side
    for (let s = 0; s < 4; s++) {
      const positions = buckets[s];
      const count = positions.length;

      const mesh = new THREE.InstancedMesh(geo, this.material, count);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(count * 3), 3,
      );

      const phases = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const p = positions[i];

        dummy.position.set(p.x, p.y + 0.75 + (Math.random() - 0.5) * 0.4, p.z);

        // Face toward arena center
        if (p.sideIdx === 0) dummy.rotation.y = 0;
        else if (p.sideIdx === 1) dummy.rotation.y = Math.PI;
        else if (p.sideIdx === 2) dummy.rotation.y = Math.PI / 2;
        else dummy.rotation.y = -Math.PI / 2;

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
