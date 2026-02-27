import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ARENA_HALF,
  STADIUM_INNER_GAP,
  STADIUM_TIER_COUNT,
  STADIUM_TIER_HEIGHT,
  STADIUM_TIER_DEPTH,
} from '@tron/shared';

const SEAT_COLOR = 0x2a1a3a;

export class Stadium {
  constructor(scene: THREE.Scene) {
    const seatMat = new THREE.MeshLambertMaterial({ color: SEAT_COLOR });

    // Collect all tier geometries across all 4 sides
    const allSeatGeos: THREE.BoxGeometry[] = [];

    const sides: Array<{ axis: 'x' | 'z'; sign: 1 | -1 }> = [
      { axis: 'z', sign: -1 }, // north
      { axis: 'z', sign: 1 },  // south
      { axis: 'x', sign: -1 }, // west
      { axis: 'x', sign: 1 },  // east
    ];

    for (const side of sides) {
      for (let t = 0; t < STADIUM_TIER_COUNT; t++) {
        const tierStart = ARENA_HALF + STADIUM_INNER_GAP + t * STADIUM_TIER_DEPTH;
        const tierOuterEdge = tierStart + STADIUM_TIER_DEPTH;
        const tierY = t * STADIUM_TIER_HEIGHT;
        const tierLength = tierOuterEdge * 2; // full span including corners

        const seatGeo = side.axis === 'z'
          ? new THREE.BoxGeometry(tierLength, STADIUM_TIER_HEIGHT, STADIUM_TIER_DEPTH)
          : new THREE.BoxGeometry(STADIUM_TIER_DEPTH, STADIUM_TIER_HEIGHT, tierLength);

        if (side.axis === 'z') {
          seatGeo.translate(0, tierY + STADIUM_TIER_HEIGHT / 2, side.sign * (tierStart + STADIUM_TIER_DEPTH / 2));
        } else {
          seatGeo.translate(side.sign * (tierStart + STADIUM_TIER_DEPTH / 2), tierY + STADIUM_TIER_HEIGHT / 2, 0);
        }

        allSeatGeos.push(seatGeo);
      }
    }

    const mergedSeats = mergeGeometries(allSeatGeos, false);
    if (mergedSeats) {
      scene.add(new THREE.Mesh(mergedSeats, seatMat));
    }

    // Outer walls — merge all 4 into a single mesh
    const outerWallHeight = STADIUM_TIER_COUNT * STADIUM_TIER_HEIGHT + 5;
    const outerDist = ARENA_HALF + STADIUM_INNER_GAP + STADIUM_TIER_COUNT * STADIUM_TIER_DEPTH;
    const outerLength = outerDist * 2;
    const outerWallMat = new THREE.MeshLambertMaterial({ color: 0x1a0a2e });

    const outerWallConfigs = [
      { x: 0, z: -outerDist, rotY: 0 },
      { x: 0, z: outerDist, rotY: 0 },
      { x: -outerDist, z: 0, rotY: Math.PI / 2 },
      { x: outerDist, z: 0, rotY: Math.PI / 2 },
    ];

    const allWallGeos: THREE.BufferGeometry[] = [];
    for (const cfg of outerWallConfigs) {
      const wallGeo = new THREE.PlaneGeometry(outerLength, outerWallHeight);
      wallGeo.rotateY(cfg.rotY);
      wallGeo.translate(cfg.x, outerWallHeight / 2, cfg.z);
      allWallGeos.push(wallGeo);
    }

    const mergedWalls = mergeGeometries(allWallGeos, false);
    if (mergedWalls) {
      scene.add(new THREE.Mesh(mergedWalls, outerWallMat));
    }
  }
}
