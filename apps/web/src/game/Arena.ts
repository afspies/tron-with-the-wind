import * as THREE from 'three';
import { ARENA_SIZE, ARENA_HALF, CURVE_RADIUS, CEILING_HEIGHT } from '@tron/shared';

const R = CURVE_RADIUS;
const FLAT_HALF = ARENA_HALF - R;

// Wall height (drivable section between curves)
const WALL_MIN_Y = R;
const WALL_MAX_Y = CEILING_HEIGHT - R;
const WALL_DRIVABLE_HEIGHT = WALL_MAX_Y - WALL_MIN_Y;

const gridWallVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const gridWallFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlphaScale;
  varying vec2 vUv;
  void main() {
    vec2 grid = abs(fract(vUv * 20.0 - 0.5) - 0.5);
    float line = min(grid.x, grid.y);
    float gridMask = 1.0 - smoothstep(0.0, 0.04, line);
    float alpha = mix(0.03, 0.25, gridMask) * uAlphaScale;
    vec3 color = mix(uColor * 0.5, uColor, gridMask);
    gl_FragColor = vec4(color, alpha);
  }
`;

const AMETHYST = 0x9966CC;
const CURVE_SEGMENTS = 16;

function makeGridMaterial(alphaScale = 1.0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: gridWallVertex,
    fragmentShader: gridWallFragment,
    uniforms: {
      uColor: { value: new THREE.Color(AMETHYST) },
      uAlphaScale: { value: alphaScale },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

function makeEdgeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: AMETHYST,
    emissive: AMETHYST,
    emissiveIntensity: 1.5,
  });
}

export class Arena {
  ground: THREE.Mesh;
  walls: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    // --- Floor ---
    // Flat inner rectangle (inside the curves)
    const floorSize = FLAT_HALF * 2;
    const groundGeo = new THREE.PlaneGeometry(floorSize, floorSize, 40, 40);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a3a,
      roughness: 0.85,
      metalness: 0.1,
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    scene.add(this.ground);

    // Grid lines on floor
    const gridHelper = new THREE.GridHelper(floorSize, 40, 0x3a2a5a, 0x3a2a5a);
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.3;
    scene.add(gridHelper);

    // --- Bottom quarter-cylinder curves (4) ---
    this.buildBottomCurves(scene);

    // --- Walls (4) ---
    this.buildWalls(scene);

    // --- Top quarter-cylinder curves (4) ---
    this.buildTopCurves(scene);

    // --- Ceiling ---
    this.buildCeiling(scene);

    // --- Glowing edges at surface transitions ---
    this.buildEdges(scene);
  }

  private buildBottomCurves(scene: THREE.Scene): void {
    // 4 curves at floor-wall boundaries
    const configs: Array<{ axis: 'x' | 'z'; sign: 1 | -1 }> = [
      { axis: 'x', sign: 1 },
      { axis: 'x', sign: -1 },
      { axis: 'z', sign: 1 },
      { axis: 'z', sign: -1 },
    ];

    for (const cfg of configs) {
      const geo = this.createQuarterCylinderGeo(cfg.axis, cfg.sign, 'bottom');
      const mat = makeGridMaterial();
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      this.walls.push(mesh);
    }
  }

  private buildTopCurves(scene: THREE.Scene): void {
    const configs: Array<{ axis: 'x' | 'z'; sign: 1 | -1 }> = [
      { axis: 'x', sign: 1 },
      { axis: 'x', sign: -1 },
      { axis: 'z', sign: 1 },
      { axis: 'z', sign: -1 },
    ];

    for (const cfg of configs) {
      const geo = this.createQuarterCylinderGeo(cfg.axis, cfg.sign, 'top');
      const mat = makeGridMaterial(0.5); // dimmer for non-drivable
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
    }
  }

  private createQuarterCylinderGeo(
    axis: 'x' | 'z',
    sign: 1 | -1,
    position: 'bottom' | 'top',
  ): THREE.BufferGeometry {
    // The curve runs along the full arena length on the perpendicular axis
    const lengthAxis = axis === 'x' ? 'z' : 'x';
    const length = FLAT_HALF * 2; // full flat extent

    const segsArc = CURVE_SEGMENTS;
    const segsLength = 20;
    const vertCount = (segsArc + 1) * (segsLength + 1);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);

    // Curve center
    const centerOnAxis = FLAT_HALF * sign;
    const centerY = position === 'bottom' ? R : CEILING_HEIGHT - R;

    // Arc angles: bottom = 0 (floor normal up) to PI/2 (wall normal inward)
    // top = PI/2 (wall normal inward) to PI (ceiling normal down)
    const startAngle = position === 'bottom' ? 0 : Math.PI / 2;
    const endAngle = position === 'bottom' ? Math.PI / 2 : Math.PI;

    let idx = 0;
    let uvIdx = 0;
    for (let j = 0; j <= segsLength; j++) {
      const v = j / segsLength;
      const lengthPos = -FLAT_HALF + v * length;

      for (let i = 0; i <= segsArc; i++) {
        const u = i / segsArc;
        const theta = startAngle + u * (endAngle - startAngle);

        // Normal direction in the axis-Y plane
        let nx: number, ny: number, nz: number;
        let px: number, py: number, pz: number;

        if (axis === 'x') {
          // Curve along X axis, extends along Z
          nx = -Math.sin(theta) * sign;
          ny = Math.cos(theta);
          nz = 0;
          px = centerOnAxis + Math.sin(theta) * R * sign;
          py = centerY + Math.cos(theta) * R;
          pz = lengthPos;
        } else {
          // Curve along Z axis, extends along X
          nx = 0;
          ny = Math.cos(theta);
          nz = -Math.sin(theta) * sign;
          px = lengthPos;
          py = centerY + Math.cos(theta) * R;
          pz = centerOnAxis + Math.sin(theta) * R * sign;
        }

        // Inward-facing normal (flip for correct face direction)
        positions[idx] = px;
        positions[idx + 1] = py;
        positions[idx + 2] = pz;
        normals[idx] = -nx;
        normals[idx + 1] = -ny;
        normals[idx + 2] = -nz;
        idx += 3;

        uvs[uvIdx] = u;
        uvs[uvIdx + 1] = v;
        uvIdx += 2;
      }
    }

    // Build index buffer
    const triCount = segsArc * segsLength * 2;
    const indices = new Uint16Array(triCount * 3);
    let triIdx = 0;
    for (let j = 0; j < segsLength; j++) {
      for (let i = 0; i < segsArc; i++) {
        const a = j * (segsArc + 1) + i;
        const b = a + 1;
        const c = (j + 1) * (segsArc + 1) + i;
        const d = c + 1;

        indices[triIdx++] = a;
        indices[triIdx++] = c;
        indices[triIdx++] = b;
        indices[triIdx++] = b;
        indices[triIdx++] = c;
        indices[triIdx++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }

  private buildWalls(scene: THREE.Scene): void {
    // 4 vertical walls from Y=R to Y=CEILING_HEIGHT-R
    const wallConfigs = [
      { pos: new THREE.Vector3(ARENA_HALF, (WALL_MIN_Y + WALL_MAX_Y) / 2, 0), rotY: Math.PI / 2 },
      { pos: new THREE.Vector3(-ARENA_HALF, (WALL_MIN_Y + WALL_MAX_Y) / 2, 0), rotY: Math.PI / 2 },
      { pos: new THREE.Vector3(0, (WALL_MIN_Y + WALL_MAX_Y) / 2, ARENA_HALF), rotY: 0 },
      { pos: new THREE.Vector3(0, (WALL_MIN_Y + WALL_MAX_Y) / 2, -ARENA_HALF), rotY: 0 },
    ];

    for (const cfg of wallConfigs) {
      const wallGeo = new THREE.PlaneGeometry(ARENA_SIZE, WALL_DRIVABLE_HEIGHT);
      const wallMat = makeGridMaterial();
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.copy(cfg.pos);
      wall.rotation.y = cfg.rotY;
      scene.add(wall);
      this.walls.push(wall);
    }
  }

  private buildCeiling(scene: THREE.Scene): void {
    const ceilingSize = FLAT_HALF * 2;
    const ceilingGeo = new THREE.PlaneGeometry(ceilingSize, ceilingSize);
    const ceilingMat = makeGridMaterial(0.3); // dimmer for ceiling (bounce zone)
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = Math.PI / 2; // face downward
    ceiling.position.y = CEILING_HEIGHT;
    scene.add(ceiling);
  }

  private buildEdges(scene: THREE.Scene): void {
    const edgeMat = makeEdgeMaterial();
    const edgeSize = 0.15;

    // Floor-curve transition edges (4 edges at Y=0, at the curve start)
    const floorEdgeConfigs = [
      { pos: new THREE.Vector3(0, 0.075, FLAT_HALF), len: FLAT_HALF * 2, rotY: 0 },
      { pos: new THREE.Vector3(0, 0.075, -FLAT_HALF), len: FLAT_HALF * 2, rotY: 0 },
      { pos: new THREE.Vector3(FLAT_HALF, 0.075, 0), len: FLAT_HALF * 2, rotY: Math.PI / 2 },
      { pos: new THREE.Vector3(-FLAT_HALF, 0.075, 0), len: FLAT_HALF * 2, rotY: Math.PI / 2 },
    ];

    for (const cfg of floorEdgeConfigs) {
      const geo = new THREE.BoxGeometry(cfg.len, edgeSize, edgeSize);
      const edge = new THREE.Mesh(geo, edgeMat.clone());
      edge.position.copy(cfg.pos);
      edge.rotation.y = cfg.rotY;
      scene.add(edge);
    }

    // Wall-ceiling transition edges (4 edges at Y=CEILING_HEIGHT-R)
    const topEdgeConfigs = [
      { pos: new THREE.Vector3(0, CEILING_HEIGHT, FLAT_HALF), len: FLAT_HALF * 2, rotY: 0 },
      { pos: new THREE.Vector3(0, CEILING_HEIGHT, -FLAT_HALF), len: FLAT_HALF * 2, rotY: 0 },
      { pos: new THREE.Vector3(FLAT_HALF, CEILING_HEIGHT, 0), len: FLAT_HALF * 2, rotY: Math.PI / 2 },
      { pos: new THREE.Vector3(-FLAT_HALF, CEILING_HEIGHT, 0), len: FLAT_HALF * 2, rotY: Math.PI / 2 },
    ];

    for (const cfg of topEdgeConfigs) {
      const geo = new THREE.BoxGeometry(cfg.len, edgeSize, edgeSize);
      const edge = new THREE.Mesh(geo, edgeMat.clone());
      edge.position.copy(cfg.pos);
      edge.rotation.y = cfg.rotY;
      scene.add(edge);
    }
  }
}
