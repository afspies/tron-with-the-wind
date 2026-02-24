import * as THREE from 'three';

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
}
