import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ARENA_SIZE,
  ARENA_HALF,
  STADIUM_INNER_GAP,
  STADIUM_TIER_COUNT,
  STADIUM_TIER_HEIGHT,
  STADIUM_TIER_DEPTH,
} from '@tron/shared';

const SEAT_COLOR = 0x2a1a3a;
const RISER_COLOR = 0x3a2a4a;

export class Stadium {
  constructor(scene: THREE.Scene) {
    const seatMat = new THREE.MeshStandardMaterial({
      color: SEAT_COLOR,
      roughness: 0.9,
      metalness: 0.05,
    });
    const riserMat = new THREE.MeshStandardMaterial({
      color: RISER_COLOR,
      roughness: 0.85,
      metalness: 0.1,
    });

    // Build 4 sides
    const sides: Array<{ axis: 'x' | 'z'; sign: 1 | -1 }> = [
      { axis: 'z', sign: -1 }, // north
      { axis: 'z', sign: 1 },  // south
      { axis: 'x', sign: -1 }, // west
      { axis: 'x', sign: 1 },  // east
    ];

    for (const side of sides) {
      const geos: THREE.BoxGeometry[] = [];

      for (let t = 0; t < STADIUM_TIER_COUNT; t++) {
        const tierStart = ARENA_HALF + STADIUM_INNER_GAP + t * STADIUM_TIER_DEPTH;
        const tierY = t * STADIUM_TIER_HEIGHT;

        // Tier surface (seat) — swap width/depth for x-axis sides
        const seatGeo = side.axis === 'z'
          ? new THREE.BoxGeometry(ARENA_SIZE, STADIUM_TIER_HEIGHT, STADIUM_TIER_DEPTH)
          : new THREE.BoxGeometry(STADIUM_TIER_DEPTH, STADIUM_TIER_HEIGHT, ARENA_SIZE);

        if (side.axis === 'z') {
          seatGeo.translate(
            0,
            tierY + STADIUM_TIER_HEIGHT / 2,
            side.sign * (tierStart + STADIUM_TIER_DEPTH / 2),
          );
        } else {
          seatGeo.translate(
            side.sign * (tierStart + STADIUM_TIER_DEPTH / 2),
            tierY + STADIUM_TIER_HEIGHT / 2,
            0,
          );
        }

        geos.push(seatGeo);
      }

      const merged = mergeGeometries(geos, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, seatMat);
        scene.add(mesh);
      }
    }

    // Corner fills — fill the gaps where sides meet
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        const cornerGeos: THREE.BoxGeometry[] = [];

        for (let t = 0; t < STADIUM_TIER_COUNT; t++) {
          const tierStart = ARENA_HALF + STADIUM_INNER_GAP + t * STADIUM_TIER_DEPTH;
          const tierY = t * STADIUM_TIER_HEIGHT;

          const cornerGeo = new THREE.BoxGeometry(
            STADIUM_TIER_DEPTH,
            STADIUM_TIER_HEIGHT,
            STADIUM_TIER_DEPTH,
          );
          cornerGeo.translate(
            sx * (tierStart + STADIUM_TIER_DEPTH / 2),
            tierY + STADIUM_TIER_HEIGHT / 2,
            sz * (tierStart + STADIUM_TIER_DEPTH / 2),
          );
          cornerGeos.push(cornerGeo);
        }

        const merged = mergeGeometries(cornerGeos, false);
        if (merged) {
          scene.add(new THREE.Mesh(merged, riserMat));
        }
      }
    }

    // Outer wall behind top tier
    const outerWallHeight = STADIUM_TIER_COUNT * STADIUM_TIER_HEIGHT + 5;
    const outerDist = ARENA_HALF + STADIUM_INNER_GAP + STADIUM_TIER_COUNT * STADIUM_TIER_DEPTH;
    const outerLength = outerDist * 2; // full perimeter
    const outerWallMat = new THREE.MeshStandardMaterial({
      color: 0x1a0a2e,
      roughness: 0.9,
      metalness: 0.05,
    });

    const outerWallConfigs = [
      { x: 0, z: -outerDist, rotY: 0 },
      { x: 0, z: outerDist, rotY: 0 },
      { x: -outerDist, z: 0, rotY: Math.PI / 2 },
      { x: outerDist, z: 0, rotY: Math.PI / 2 },
    ];

    for (const cfg of outerWallConfigs) {
      const wallGeo = new THREE.PlaneGeometry(outerLength, outerWallHeight);
      const wall = new THREE.Mesh(wallGeo, outerWallMat);
      wall.position.set(cfg.x, outerWallHeight / 2, cfg.z);
      wall.rotation.y = cfg.rotY;
      scene.add(wall);
    }
  }
}
