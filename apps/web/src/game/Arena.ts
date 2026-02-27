import * as THREE from 'three';
import { ARENA_SIZE, ARENA_HALF, WALL_HEIGHT, CEILING_HEIGHT, RAMP_RADIUS } from '@tron/shared';

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

  constructor(scene: THREE.Scene) {
    const R = RAMP_RADIUS;
    const flatWallHeight = WALL_HEIGHT - R * 2; // flat wall between floor-ramp and ceiling-ramp

    // Ground plane
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

    // Ramp material
    const rampMat = new THREE.MeshStandardMaterial({
      color: 0x4a3060,
      emissive: 0x3a2a5a,
      emissiveIntensity: 0.7,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });

    // Boundary walls — translucent grid shader (positioned between ramp zones)
    const wallConfigs = [
      { x: 0, z: -ARENA_HALF, rotY: 0 },
      { x: 0, z: ARENA_HALF, rotY: 0 },
      { x: -ARENA_HALF, z: 0, rotY: Math.PI / 2 },
      { x: ARENA_HALF, z: 0, rotY: Math.PI / 2 },
    ];

    for (const cfg of wallConfigs) {
      const wallGeo = new THREE.PlaneGeometry(ARENA_SIZE, flatWallHeight);
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
      wall.position.set(cfg.x, R + flatWallHeight / 2, cfg.z);
      wall.rotation.y = cfg.rotY;
      scene.add(wall);
      this.walls.push(wall);
    }

    // Floor-wall ramps (4 quarter-cylinder curves at floor-wall junctions)
    const rampSegs = 12;
    this.buildFloorWallRamps(scene, rampMat, R, rampSegs);
    this.buildCeilingWallRamps(scene, rampMat, R, rampSegs);

    // Vertical corner ramps (4 quarter-cylinder curves at wall-wall junctions)
    this.buildVerticalCornerRamps(scene, rampMat, R, rampSegs);

    // Corner pillars (extend full height)
    const pillarGeo = new THREE.CylinderGeometry(0.5, 0.5, WALL_HEIGHT + 1, 8);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x6a3a8a,
      emissive: 0x9966CC,
      emissiveIntensity: 0.8,
    });
    const corners = [
      [-ARENA_HALF, -ARENA_HALF],
      [-ARENA_HALF, ARENA_HALF],
      [ARENA_HALF, -ARENA_HALF],
      [ARENA_HALF, ARENA_HALF],
    ];
    for (const [cx, cz] of corners) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(cx, (WALL_HEIGHT + 1) / 2, cz);
      scene.add(pillar);

      const orbGeo = new THREE.SphereGeometry(0.8, 16, 16);
      const orbMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        emissive: 0xffd700,
        emissiveIntensity: 1.5,
      });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.set(cx, WALL_HEIGHT + 1.5, cz);
      scene.add(orb);

      const orbLight = new THREE.PointLight(0xffd700, 3, 20);
      orbLight.position.set(cx, WALL_HEIGHT + 1.5, cz);
      scene.add(orbLight);
    }

    // Ceiling plane (semi-transparent)
    const ceilingGeo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a3a,
      emissive: 0x1a0a2a,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = CEILING_HEIGHT;
    scene.add(ceiling);

    // Ceiling grid
    const ceilingGrid = new THREE.GridHelper(ARENA_SIZE, 20, 0x4a2a6a, 0x4a2a6a);
    ceilingGrid.position.y = CEILING_HEIGHT;
    (ceilingGrid.material as THREE.Material).transparent = true;
    (ceilingGrid.material as THREE.Material).opacity = 0.15;
    scene.add(ceilingGrid);
  }

  /**
   * Build quarter-cylinder ramp meshes at all 4 floor-wall junctions.
   */
  private buildFloorWallRamps(scene: THREE.Scene, mat: THREE.Material, R: number, segs: number): void {
    const wallDefs: Array<{ wallPos: number; sign: number; axis: 'x' | 'z' }> = [
      { wallPos: ARENA_HALF, sign: 1, axis: 'x' },
      { wallPos: -ARENA_HALF, sign: -1, axis: 'x' },
      { wallPos: ARENA_HALF, sign: 1, axis: 'z' },
      { wallPos: -ARENA_HALF, sign: -1, axis: 'z' },
    ];

    for (const wd of wallDefs) {
      const geo = this.createRampGeometry(R, segs, ARENA_SIZE, wd.axis, wd.sign, 'floor');
      const mesh = new THREE.Mesh(geo, mat.clone());
      scene.add(mesh);
    }
  }

  /**
   * Build quarter-cylinder ramp meshes at all 4 wall-ceiling junctions.
   */
  private buildCeilingWallRamps(scene: THREE.Scene, mat: THREE.Material, R: number, segs: number): void {
    const wallDefs: Array<{ wallPos: number; sign: number; axis: 'x' | 'z' }> = [
      { wallPos: ARENA_HALF, sign: 1, axis: 'x' },
      { wallPos: -ARENA_HALF, sign: -1, axis: 'x' },
      { wallPos: ARENA_HALF, sign: 1, axis: 'z' },
      { wallPos: -ARENA_HALF, sign: -1, axis: 'z' },
    ];

    for (const wd of wallDefs) {
      const geo = this.createRampGeometry(R, segs, ARENA_SIZE, wd.axis, wd.sign, 'ceiling');
      const mesh = new THREE.Mesh(geo, mat.clone());
      scene.add(mesh);
    }
  }

  /**
   * Build vertical quarter-cylinder ramp meshes at all 4 wall-wall corner junctions.
   */
  private buildVerticalCornerRamps(scene: THREE.Scene, mat: THREE.Material, R: number, segs: number): void {
    const cornerDefs: Array<{ xSign: number; zSign: number }> = [
      { xSign: 1, zSign: 1 },
      { xSign: 1, zSign: -1 },
      { xSign: -1, zSign: 1 },
      { xSign: -1, zSign: -1 },
    ];

    const rampHeight = WALL_HEIGHT - R * 2;

    for (const cd of cornerDefs) {
      const geo = this.createCornerRampGeometry(R, segs, rampHeight, cd.xSign, cd.zSign);
      const mesh = new THREE.Mesh(geo, mat.clone());
      scene.add(mesh);
    }
  }

  /**
   * Create geometry for a vertical quarter-cylinder ramp at a wall-wall corner.
   */
  private createCornerRampGeometry(
    R: number, segs: number, height: number,
    xSign: number, zSign: number,
  ): THREE.BufferGeometry {
    const centerX = xSign * (ARENA_HALF - R);
    const centerZ = zSign * (ARENA_HALF - R);
    const yBottom = R;

    const verts: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const heightSegs = 1;

    for (let hi = 0; hi <= heightSegs; hi++) {
      const y = yBottom + (height * hi) / heightSegs;

      for (let ai = 0; ai <= segs; ai++) {
        const t = ai / segs;
        const angle = t * (Math.PI / 2);

        const px = centerX + Math.cos(angle) * xSign * R;
        const pz = centerZ + Math.sin(angle) * zSign * R;

        const nx = -Math.cos(angle) * xSign;
        const nz = -Math.sin(angle) * zSign;

        verts.push(px, y, pz);
        normals.push(nx, 0, nz);
      }
    }

    const vertsPerRow = segs + 1;
    for (let hi = 0; hi < heightSegs; hi++) {
      for (let ai = 0; ai < segs; ai++) {
        const a = hi * vertsPerRow + ai;
        const b = a + 1;
        const c = a + vertsPerRow;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    return geo;
  }

  /**
   * Create geometry for a quarter-cylinder ramp running along one wall edge.
   */
  private createRampGeometry(
    R: number, segs: number, length: number,
    axis: 'x' | 'z', sign: number, edge: 'floor' | 'ceiling',
  ): THREE.BufferGeometry {
    const wallPos = sign * ARENA_HALF;
    const centerW = wallPos - sign * R;
    const centerY = edge === 'floor' ? R : CEILING_HEIGHT - R;

    const verts: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const strips = segs;
    const lengthSegs = 1;

    for (let li = 0; li <= lengthSegs; li++) {
      const along = -length / 2 + (length * li) / lengthSegs;

      for (let ai = 0; ai <= strips; ai++) {
        const t = ai / strips;
        const angle = t * (Math.PI / 2);

        let w: number, y: number;
        let nw: number, ny: number;

        if (edge === 'floor') {
          w = centerW + Math.sin(angle) * sign * R;
          y = centerY - Math.cos(angle) * R;
          nw = -Math.sin(angle) * sign;
          ny = Math.cos(angle);
        } else {
          w = centerW + Math.sin(angle) * sign * R;
          y = centerY + Math.cos(angle) * R;
          nw = -Math.sin(angle) * sign;
          ny = -Math.cos(angle);
        }

        if (axis === 'x') {
          verts.push(w, y, along);
          normals.push(nw, ny, 0);
        } else {
          verts.push(along, y, w);
          normals.push(0, ny, nw);
        }
      }
    }

    const vertsPerRow = strips + 1;
    for (let li = 0; li < lengthSegs; li++) {
      for (let ai = 0; ai < strips; ai++) {
        const a = li * vertsPerRow + ai;
        const b = a + 1;
        const c = a + vertsPerRow;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setIndex(indices);
    return geo;
  }
}
