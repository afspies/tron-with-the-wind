import * as THREE from 'three';
import {
  ARENA_SIZE,
  ARENA_HALF,
  WALL_HEIGHT,
  ARENA_CEILING_HEIGHT,
  MAP_PLATFORMS,
  WALL_RAMP_WIDTH,
  WALL_RAMP_DEPTH,
  WALL_RAMP_HEIGHT,
  WALL_RAMP_THICKNESS,
} from '@tron/shared';

const gridWallVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const gridWallFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    // Grid lines: ~20 cells across each axis
    vec2 grid = abs(fract(vUv * 20.0 - 0.5) - 0.5);
    float line = min(grid.x, grid.y);
    float gridMask = 1.0 - smoothstep(0.0, 0.04, line);

    // Base nearly invisible, grid lines more visible
    float alpha = mix(0.03, 0.25, gridMask);
    vec3 color = mix(uColor * 0.5, uColor, gridMask);
    gl_FragColor = vec4(color, alpha);
  }
`;

export class Arena {
  ground: THREE.Mesh;
  walls: THREE.Mesh[] = [];
  ceiling: THREE.Mesh;
  platforms: THREE.Mesh[] = [];
  ramps: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    // Ground plane with grid pattern
    const groundGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE, 40, 40);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a3a,
      roughness: 0.85,
      metalness: 0.1,
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground);

    // Grid lines on ground
    const gridHelper = new THREE.GridHelper(ARENA_SIZE, 40, 0x3a2a5a, 0x3a2a5a);
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.3;
    scene.add(gridHelper);

    // Boundary walls — translucent grid shader
    const wallConfigs = [
      { x: 0, z: -ARENA_HALF, rotY: 0 },
      { x: 0, z: ARENA_HALF, rotY: 0 },
      { x: -ARENA_HALF, z: 0, rotY: Math.PI / 2 },
      { x: ARENA_HALF, z: 0, rotY: Math.PI / 2 },
    ];

    for (const cfg of wallConfigs) {
      const wallGeo = new THREE.PlaneGeometry(ARENA_SIZE, WALL_HEIGHT);
      const wallMat = new THREE.ShaderMaterial({
        vertexShader: gridWallVertex,
        fragmentShader: gridWallFragment,
        uniforms: {
          uColor: { value: new THREE.Color(0x9966CC) },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(cfg.x, WALL_HEIGHT / 2, cfg.z);
      wall.rotation.y = cfg.rotY;
      scene.add(wall);
      this.walls.push(wall);

      // Glowing edge at top of wall
      const edgeGeo = new THREE.BoxGeometry(ARENA_SIZE, 0.15, 0.15);
      const edgeMat = new THREE.MeshStandardMaterial({
        color: 0x9966CC,
        emissive: 0x9966CC,
        emissiveIntensity: 1.5,
      });
      const edge = new THREE.Mesh(edgeGeo, edgeMat);
      edge.position.set(cfg.x, WALL_HEIGHT, cfg.z);
      edge.rotation.y = cfg.rotY;
      scene.add(edge);

      // Glowing edge at bottom of wall
      const bottomEdge = new THREE.Mesh(edgeGeo.clone(), edgeMat.clone());
      bottomEdge.position.set(cfg.x, 0.075, cfg.z);
      bottomEdge.rotation.y = cfg.rotY;
      scene.add(bottomEdge);
    }

    const rampMat = new THREE.MeshStandardMaterial({
      color: 0x2a3f55,
      emissive: 0x30506c,
      emissiveIntensity: 0.25,
      roughness: 0.55,
      metalness: 0.3,
    });
    const rampGeo = new THREE.BoxGeometry(WALL_RAMP_WIDTH, WALL_RAMP_THICKNESS, WALL_RAMP_DEPTH);
    const rampSlope = Math.atan2(WALL_RAMP_HEIGHT, WALL_RAMP_DEPTH);
    const rampConfigs = [
      { x: 0, z: ARENA_HALF - WALL_RAMP_DEPTH * 0.5, rotY: 0 },
      { x: 0, z: -ARENA_HALF + WALL_RAMP_DEPTH * 0.5, rotY: Math.PI },
      { x: ARENA_HALF - WALL_RAMP_DEPTH * 0.5, z: 0, rotY: -Math.PI / 2 },
      { x: -ARENA_HALF + WALL_RAMP_DEPTH * 0.5, z: 0, rotY: Math.PI / 2 },
    ];

    for (const cfg of rampConfigs) {
      const ramp = new THREE.Mesh(rampGeo, rampMat.clone());
      ramp.position.set(cfg.x, WALL_RAMP_HEIGHT * 0.5, cfg.z);
      ramp.rotation.y = cfg.rotY;
      ramp.rotation.x = -rampSlope;
      scene.add(ramp);
      this.ramps.push(ramp);
    }

    const ceilingGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE, 40, 40);
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0x1a2238,
      emissive: 0x24304f,
      emissiveIntensity: 0.25,
      roughness: 0.8,
      metalness: 0.25,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    this.ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    this.ceiling.rotation.x = Math.PI / 2;
    this.ceiling.position.y = ARENA_CEILING_HEIGHT;
    scene.add(this.ceiling);

    for (const p of MAP_PLATFORMS) {
      const platform = new THREE.Mesh(
        new THREE.BoxGeometry(p.width, p.height, p.depth),
        new THREE.MeshStandardMaterial({
          color: 0x2e4c66,
          emissive: 0x3b6c92,
          emissiveIntensity: 0.3,
          roughness: 0.45,
          metalness: 0.45,
        }),
      );
      platform.position.set(p.x, p.y, p.z);
      scene.add(platform);
      this.platforms.push(platform);
    }
  }
}
