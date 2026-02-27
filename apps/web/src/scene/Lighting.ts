import * as THREE from 'three';
import { ARENA_HALF, STADIUM_INNER_GAP, STADIUM_TIER_COUNT, STADIUM_TIER_DEPTH, STADIUM_TIER_HEIGHT } from '@tron/shared';

export function setupLighting(scene: THREE.Scene): void {
  // Warm ambient
  const ambient = new THREE.AmbientLight(0xffd4a0, 0.4);
  scene.add(ambient);

  // Main directional (golden sunset)
  const dirLight = new THREE.DirectionalLight(0xffcc77, 1.0);
  dirLight.position.set(50, 80, 30);
  dirLight.castShadow = false;
  scene.add(dirLight);

  // Cooler fill from opposite side
  const fillLight = new THREE.DirectionalLight(0x6677cc, 0.3);
  fillLight.position.set(-40, 60, -50);
  scene.add(fillLight);

  // Subtle hemisphere
  const hemiLight = new THREE.HemisphereLight(0xffd4a0, 0x2a1a3a, 0.3);
  scene.add(hemiLight);

  // Stadium floodlights — 4 spots above stadium corners aimed at arena center
  const stadiumEdge = ARENA_HALF + STADIUM_INNER_GAP + STADIUM_TIER_COUNT * STADIUM_TIER_DEPTH;
  const floodHeight = STADIUM_TIER_COUNT * STADIUM_TIER_HEIGHT + 20;
  const floodCorners = [
    [stadiumEdge, floodHeight, stadiumEdge],
    [-stadiumEdge, floodHeight, stadiumEdge],
    [stadiumEdge, floodHeight, -stadiumEdge],
    [-stadiumEdge, floodHeight, -stadiumEdge],
  ] as const;

  for (const [fx, fy, fz] of floodCorners) {
    const spot = new THREE.SpotLight(0xffd4a0, 30, 400, Math.PI / 4, 0.6, 1.0);
    spot.position.set(fx, fy, fz);
    spot.target.position.set(0, 0, 0);
    scene.add(spot);
    scene.add(spot.target);
  }
}
