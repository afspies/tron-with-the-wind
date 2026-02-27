import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ARENA_HALF,
  STADIUM_INNER_GAP,
  STADIUM_TIER_COUNT,
  STADIUM_TIER_HEIGHT,
  STADIUM_TIER_DEPTH,
  STADIUM_SIDES,
} from '@tron/shared';

const SEAT_COLOR = 0x2a1a3a;
const OUTER_WALL_COLOR = 0x1a0a2e;
const OUTER_WALL_OVERHANG = 5;

export class Stadium {
  private seatsMesh: THREE.Mesh | null = null;
  private wallsMesh: THREE.Mesh | null = null;
  private seatMat: THREE.MeshLambertMaterial;
  private wallMat: THREE.MeshLambertMaterial;

  constructor(scene: THREE.Scene) {
    this.seatMat = new THREE.MeshLambertMaterial({ color: SEAT_COLOR });
    this.wallMat = new THREE.MeshLambertMaterial({ color: OUTER_WALL_COLOR });

    this.seatsMesh = this.buildSeats();
    if (this.seatsMesh) scene.add(this.seatsMesh);

    this.wallsMesh = this.buildOuterWalls();
    if (this.wallsMesh) scene.add(this.wallsMesh);
  }

  private buildSeats(): THREE.Mesh | null {
    const allGeos: THREE.BoxGeometry[] = [];

    for (const side of STADIUM_SIDES) {
      for (let t = 0; t < STADIUM_TIER_COUNT; t++) {
        const tierStart = ARENA_HALF + STADIUM_INNER_GAP + t * STADIUM_TIER_DEPTH;
        const tierLength = (tierStart + STADIUM_TIER_DEPTH) * 2;
        const tierY = t * STADIUM_TIER_HEIGHT + STADIUM_TIER_HEIGHT / 2;
        const tierPos = side.sign * (tierStart + STADIUM_TIER_DEPTH / 2);

        const isZAxis = side.axis === 'z';
        const geo = new THREE.BoxGeometry(
          isZAxis ? tierLength : STADIUM_TIER_DEPTH,
          STADIUM_TIER_HEIGHT,
          isZAxis ? STADIUM_TIER_DEPTH : tierLength,
        );
        geo.translate(
          isZAxis ? 0 : tierPos,
          tierY,
          isZAxis ? tierPos : 0,
        );

        allGeos.push(geo);
      }
    }

    const merged = mergeGeometries(allGeos, false);
    return merged ? new THREE.Mesh(merged, this.seatMat) : null;
  }

  private buildOuterWalls(): THREE.Mesh | null {
    const outerWallHeight = STADIUM_TIER_COUNT * STADIUM_TIER_HEIGHT + OUTER_WALL_OVERHANG;
    const outerDist = ARENA_HALF + STADIUM_INNER_GAP + STADIUM_TIER_COUNT * STADIUM_TIER_DEPTH;
    const outerLength = outerDist * 2;

    const wallConfigs = [
      { x: 0, z: -outerDist, rotY: 0 },
      { x: 0, z: outerDist, rotY: 0 },
      { x: -outerDist, z: 0, rotY: Math.PI / 2 },
      { x: outerDist, z: 0, rotY: Math.PI / 2 },
    ];

    const allGeos: THREE.BufferGeometry[] = [];
    for (const cfg of wallConfigs) {
      const geo = new THREE.PlaneGeometry(outerLength, outerWallHeight);
      geo.rotateY(cfg.rotY);
      geo.translate(cfg.x, outerWallHeight / 2, cfg.z);
      allGeos.push(geo);
    }

    const merged = mergeGeometries(allGeos, false);
    return merged ? new THREE.Mesh(merged, this.wallMat) : null;
  }

  dispose(): void {
    this.seatsMesh?.geometry.dispose();
    this.wallsMesh?.geometry.dispose();
    this.seatMat.dispose();
    this.wallMat.dispose();
  }
}
