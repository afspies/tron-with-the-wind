import * as THREE from 'three';
import { ARENA_SIZE, ARENA_HALF, WALL_HEIGHT, CEILING_HEIGHT } from '@tron/shared';

export class Arena {
  ground: THREE.Mesh;
  walls: THREE.Mesh[] = [];

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

    // Boundary walls
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x4a2a6a,
      emissive: 0x2a1a4a,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });

    const wallConfigs = [
      { x: 0, z: -ARENA_HALF, rotY: 0 },
      { x: 0, z: ARENA_HALF, rotY: 0 },
      { x: -ARENA_HALF, z: 0, rotY: Math.PI / 2 },
      { x: ARENA_HALF, z: 0, rotY: Math.PI / 2 },
    ];

    for (const cfg of wallConfigs) {
      const wallGeo = new THREE.PlaneGeometry(ARENA_SIZE, WALL_HEIGHT);
      const wall = new THREE.Mesh(wallGeo, wallMat.clone());
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

    // Corner pillars
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

      // Orb on top
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

      // Rotate grid to align with wall plane
      if (cfg.rotY === 0) {
        // Z-axis wall: rotate to face along Z
        wallGrid.rotation.x = Math.PI / 2;
        wallGrid.position.set(cfg.x, WALL_HEIGHT / 2, cfg.z);
      } else {
        // X-axis wall: rotate to face along X
        wallGrid.rotation.z = Math.PI / 2;
        wallGrid.position.set(cfg.x, WALL_HEIGHT / 2, cfg.z);
      }
      scene.add(wallGrid);
    }
  }
}
