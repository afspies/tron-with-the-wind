import * as THREE from 'three';
import { ARENA_SIZE, ARENA_HALF, WALL_HEIGHT, CEILING_HEIGHT, RAMP_RADIUS } from '@tron/shared';

export class Arena {
  ground: THREE.Mesh;
  walls: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    const R = RAMP_RADIUS;
    const flatFloorSize = ARENA_SIZE - R * 2; // floor shrinks by ramp radius on each side
    const flatWallHeight = WALL_HEIGHT - R * 2; // flat wall between floor-ramp and ceiling-ramp

    // Ground plane (shrunk to flat floor area, ramp covers the rest)
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

    // Shared wall material
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x5a3a7a,
      emissive: 0x3a2a5a,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    // Ramp material (slightly different tint)
    const rampMat = new THREE.MeshStandardMaterial({
      color: 0x4a3060,
      emissive: 0x3a2a5a,
      emissiveIntensity: 0.7,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });

    // Flat wall sections (between floor-ramp top and ceiling-ramp bottom)
    const wallConfigs = [
      { x: 0, z: -ARENA_HALF, rotY: 0 },
      { x: 0, z: ARENA_HALF, rotY: 0 },
      { x: -ARENA_HALF, z: 0, rotY: Math.PI / 2 },
      { x: ARENA_HALF, z: 0, rotY: Math.PI / 2 },
    ];

    for (const cfg of wallConfigs) {
      const wallGeo = new THREE.PlaneGeometry(ARENA_SIZE, flatWallHeight);
      const wall = new THREE.Mesh(wallGeo, wallMat.clone());
      wall.position.set(cfg.x, R + flatWallHeight / 2, cfg.z);
      wall.rotation.y = cfg.rotY;
      scene.add(wall);
      this.walls.push(wall);
    }

    // Floor-wall ramps (4 quarter-cylinder curves at floor-wall junctions)
    // Each ramp runs along the full arena length of the respective wall
    const rampSegs = 12; // arc segments for smooth quarter-circle
    this.buildFloorWallRamps(scene, rampMat, R, rampSegs);
    this.buildCeilingWallRamps(scene, rampMat, R, rampSegs);

    // Vertical corner ramps (4 quarter-cylinder curves at wall-wall junctions)
    this.buildVerticalCornerRamps(scene, rampMat, R, rampSegs);

    // Corner pillars (now extend full height)
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

    // Wall grid overlays for spatial reference
    for (const cfg of wallConfigs) {
      const wallGrid = new THREE.GridHelper(ARENA_SIZE, 20, 0x3a2a5a, 0x3a2a5a);
      (wallGrid.material as THREE.Material).transparent = true;
      (wallGrid.material as THREE.Material).opacity = 0.15;

      if (cfg.rotY === 0) {
        wallGrid.rotation.x = Math.PI / 2;
        wallGrid.position.set(cfg.x, WALL_HEIGHT / 2, cfg.z);
      } else {
        wallGrid.rotation.z = Math.PI / 2;
        wallGrid.position.set(cfg.x, WALL_HEIGHT / 2, cfg.z);
      }
      scene.add(wallGrid);
    }
  }

  /**
   * Build quarter-cylinder ramp meshes at all 4 floor-wall junctions.
   * Each ramp is an extruded quarter-circle arc from floor (y=0) up to the wall (y=R).
   */
  private buildFloorWallRamps(scene: THREE.Scene, mat: THREE.Material, R: number, segs: number): void {
    // wallDef: wallPos on the axis, sign (+1/-1), axis ('x' or 'z')
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

    // Vertical ramp height: from floor ramp top (R) to ceiling ramp bottom (CEILING_HEIGHT - R)
    const rampHeight = WALL_HEIGHT - R * 2;

    for (const cd of cornerDefs) {
      const geo = this.createCornerRampGeometry(R, segs, rampHeight, cd.xSign, cd.zSign);
      const mesh = new THREE.Mesh(geo, mat.clone());
      scene.add(mesh);
    }
  }

  /**
   * Create geometry for a vertical quarter-cylinder ramp at a wall-wall corner.
   * The ramp runs vertically from y=R to y=R+height.
   */
  private createCornerRampGeometry(
    R: number, segs: number, height: number,
    xSign: number, zSign: number,
  ): THREE.BufferGeometry {
    const centerX = xSign * (ARENA_HALF - R);
    const centerZ = zSign * (ARENA_HALF - R);
    const yBottom = R; // starts above floor ramp
    const yTop = yBottom + height; // ends below ceiling ramp

    const verts: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const heightSegs = 1;

    for (let hi = 0; hi <= heightSegs; hi++) {
      const y = yBottom + (height * hi) / heightSegs;

      for (let ai = 0; ai <= segs; ai++) {
        const t = ai / segs;
        // Arc from one wall face to the adjacent wall face
        // angle 0 = at the X-wall, angle PI/2 = at the Z-wall
        const angle = t * (Math.PI / 2);

        // Point on the arc in XZ plane, offset from center
        const px = centerX + Math.cos(angle) * xSign * R;
        const pz = centerZ + Math.sin(angle) * zSign * R;

        // Normal points inward (toward arena center)
        const nx = -Math.cos(angle) * xSign;
        const nz = -Math.sin(angle) * zSign;

        verts.push(px, y, pz);
        normals.push(nx, 0, nz);
      }
    }

    // Build triangle indices
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
   * The ramp is a strip of quads tracing a quarter-circle arc, extruded along the wall length.
   *
   * For floor ramps: arc center is at (wallPos - sign*R, R), arc goes from
   *   wall face (angle=0, vertical tangent) to floor (angle=PI/2, horizontal tangent).
   * For ceiling ramps: arc center is at (wallPos - sign*R, CEILING_HEIGHT - R).
   */
  private createRampGeometry(
    R: number, segs: number, length: number,
    axis: 'x' | 'z', sign: number, edge: 'floor' | 'ceiling',
  ): THREE.BufferGeometry {
    // Arc center in the wall-axis/Y plane
    const wallPos = sign * ARENA_HALF;
    const centerW = wallPos - sign * R;
    const centerY = edge === 'floor' ? R : CEILING_HEIGHT - R;

    // Arc angle: 0 = at the wall face, PI/2 = at the floor/ceiling
    // For floor: angle 0 -> point at (wallPos, R) going to (centerW, 0)
    // For ceiling: angle 0 -> point at (wallPos, CH-R) going to (centerW, CH)
    const verts: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    const strips = segs;
    const lengthSegs = 1; // single segment along wall length

    for (let li = 0; li <= lengthSegs; li++) {
      const along = -length / 2 + (length * li) / lengthSegs;

      for (let ai = 0; ai <= strips; ai++) {
        const t = ai / strips;
        const angle = t * (Math.PI / 2);

        // Point on the arc (in the wallAxis/Y plane)
        let w: number, y: number;
        let nw: number, ny: number;

        if (edge === 'floor') {
          // Arc from wall face down to floor
          w = centerW + Math.sin(angle) * sign * R; // sign ensures correct direction
          y = centerY - Math.cos(angle) * R;
          nw = -Math.sin(angle) * sign; // normal points inward
          ny = Math.cos(angle);
        } else {
          // Arc from wall face up to ceiling
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

    // Build triangle indices
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
