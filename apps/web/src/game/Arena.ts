import * as THREE from 'three';
import { ARENA_SIZE, ARENA_HALF, WALL_HEIGHT } from '@tron/shared';
import type { MapId } from '@tron/shared';
import {
  SKYBRIDGE_PLATFORM_HEIGHT,
  SKYBRIDGE_PLATFORM_HALF_WIDTH,
  SKYBRIDGE_RAMP_LENGTH,
  SKYBRIDGE_RAMP_WIDTH,
} from '@tron/shared';

const PLATFORM_Z_FRONT = 30;
const PLATFORM_Z_BACK = ARENA_HALF; // 100
const PLATFORM_DEPTH = PLATFORM_Z_BACK - PLATFORM_Z_FRONT; // 70
const RAMP_Z_START = 10;

export class Arena {
  ground: THREE.Mesh;
  walls: THREE.Mesh[] = [];
  private objects: THREE.Object3D[] = [];
  mapId: MapId;

  constructor(scene: THREE.Scene, mapId: MapId = 'classic') {
    this.mapId = mapId;

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
    this.objects.push(this.ground);

    // Grid lines on ground
    const gridHelper = new THREE.GridHelper(ARENA_SIZE, 40, 0x3a2a5a, 0x3a2a5a);
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.3;
    scene.add(gridHelper);
    this.objects.push(gridHelper);

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
      this.objects.push(wall);

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
      this.objects.push(edge);

      // Glowing edge at bottom of wall
      const bottomEdge = new THREE.Mesh(edgeGeo.clone(), edgeMat.clone());
      bottomEdge.position.set(cfg.x, 0.075, cfg.z);
      bottomEdge.rotation.y = cfg.rotY;
      scene.add(bottomEdge);
      this.objects.push(bottomEdge);
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
      this.objects.push(pillar);

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
      this.objects.push(orb);

      const orbLight = new THREE.PointLight(0xffd700, 3, 20);
      orbLight.position.set(cx, WALL_HEIGHT + 1.5, cz);
      scene.add(orbLight);
      this.objects.push(orbLight);
    }

    // Build Skybridge geometry if applicable
    if (mapId === 'skybridge') {
      this.buildSkybridge(scene);
    }
  }

  private buildSkybridge(scene: THREE.Scene): void {
    const H = SKYBRIDGE_PLATFORM_HEIGHT;
    const W = SKYBRIDGE_PLATFORM_HALF_WIDTH * 2; // 100
    const D = PLATFORM_DEPTH; // 70

    // Platform surface (top)
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x1a0a2e,
      emissive: 0x2a1a4a,
      emissiveIntensity: 0.3,
      roughness: 0.7,
      metalness: 0.2,
    });

    const platformGeo = new THREE.BoxGeometry(W, 0.5, D);
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.set(0, H - 0.25, PLATFORM_Z_FRONT + D / 2);
    scene.add(platform);
    this.objects.push(platform);

    // Grid overlay on platform top
    const platformGrid = new THREE.GridHelper(W, 20, 0x3a2a5a, 0x3a2a5a);
    (platformGrid.material as THREE.Material).transparent = true;
    (platformGrid.material as THREE.Material).opacity = 0.4;
    platformGrid.position.set(0, H, PLATFORM_Z_FRONT + D / 2);
    // Scale to match rectangular platform
    platformGrid.scale.set(1, 1, D / W);
    scene.add(platformGrid);
    this.objects.push(platformGrid);

    // Underside of platform (visible from below)
    const undersideMat = new THREE.MeshStandardMaterial({
      color: 0x1a0a2e,
      emissive: 0x150a25,
      emissiveIntensity: 0.2,
      side: THREE.BackSide,
    });
    const underside = new THREE.Mesh(platformGeo.clone(), undersideMat);
    underside.position.set(0, H - 0.25, PLATFORM_Z_FRONT + D / 2);
    scene.add(underside);
    this.objects.push(underside);

    // Support pillars under platform
    const supportMat = new THREE.MeshStandardMaterial({
      color: 0x3a1a5a,
      emissive: 0x2a1a4a,
      emissiveIntensity: 0.4,
    });
    const supportGeo = new THREE.CylinderGeometry(0.6, 0.6, H, 8);
    const pillarPositions = [
      [-SKYBRIDGE_PLATFORM_HALF_WIDTH + 5, PLATFORM_Z_FRONT + 5],
      [SKYBRIDGE_PLATFORM_HALF_WIDTH - 5, PLATFORM_Z_FRONT + 5],
      [-SKYBRIDGE_PLATFORM_HALF_WIDTH + 5, PLATFORM_Z_BACK - 5],
      [SKYBRIDGE_PLATFORM_HALF_WIDTH - 5, PLATFORM_Z_BACK - 5],
      [0, PLATFORM_Z_FRONT + D / 2], // center pillar
    ];
    for (const [px, pz] of pillarPositions) {
      const pillar = new THREE.Mesh(supportGeo, supportMat);
      pillar.position.set(px, H / 2, pz);
      scene.add(pillar);
      this.objects.push(pillar);
    }

    // Glowing edge along platform front (cliff edge)
    const frontEdgeGeo = new THREE.BoxGeometry(W, 0.15, 0.15);
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0x9966CC,
      emissive: 0x9966CC,
      emissiveIntensity: 1.5,
    });
    const frontEdge = new THREE.Mesh(frontEdgeGeo, edgeMat);
    frontEdge.position.set(0, H, PLATFORM_Z_FRONT);
    scene.add(frontEdge);
    this.objects.push(frontEdge);

    // Side edges of platform
    const sideEdgeGeo = new THREE.BoxGeometry(0.15, 0.15, D);
    for (const xSide of [-SKYBRIDGE_PLATFORM_HALF_WIDTH, SKYBRIDGE_PLATFORM_HALF_WIDTH]) {
      const sideEdge = new THREE.Mesh(sideEdgeGeo, edgeMat.clone());
      sideEdge.position.set(xSide, H, PLATFORM_Z_FRONT + D / 2);
      scene.add(sideEdge);
      this.objects.push(sideEdge);
    }

    // Ramps (left and right)
    const rampConfigs = [
      { xMin: -SKYBRIDGE_PLATFORM_HALF_WIDTH, xMax: -SKYBRIDGE_PLATFORM_HALF_WIDTH + SKYBRIDGE_RAMP_WIDTH },
      { xMin: SKYBRIDGE_PLATFORM_HALF_WIDTH - SKYBRIDGE_RAMP_WIDTH, xMax: SKYBRIDGE_PLATFORM_HALF_WIDTH },
    ];

    const rampMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a3e,
      emissive: 0x2a1a4a,
      emissiveIntensity: 0.3,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });

    for (const ramp of rampConfigs) {
      const rampWidth = ramp.xMax - ramp.xMin;
      const rampCenterX = (ramp.xMin + ramp.xMax) / 2;

      // Ramp surface: inclined plane from y=0 at z=RAMP_Z_START to y=H at z=PLATFORM_Z_FRONT
      const rampSurfaceGeo = new THREE.PlaneGeometry(rampWidth, Math.sqrt(SKYBRIDGE_RAMP_LENGTH ** 2 + H ** 2));
      const rampSurface = new THREE.Mesh(rampSurfaceGeo, rampMat);
      const rampAngle = Math.atan2(H, SKYBRIDGE_RAMP_LENGTH);
      rampSurface.rotation.x = -(Math.PI / 2 - rampAngle);
      const rampMidZ = (RAMP_Z_START + PLATFORM_Z_FRONT) / 2;
      const rampMidY = H / 2;
      rampSurface.position.set(rampCenterX, rampMidY, rampMidZ);
      scene.add(rampSurface);
      this.objects.push(rampSurface);

      // Grid on ramp
      const rampGridGeo = new THREE.PlaneGeometry(rampWidth, Math.sqrt(SKYBRIDGE_RAMP_LENGTH ** 2 + H ** 2));
      const rampGridMat = new THREE.MeshStandardMaterial({
        color: 0x3a2a5a,
        transparent: true,
        opacity: 0.3,
        wireframe: true,
        side: THREE.DoubleSide,
      });
      const rampGrid = new THREE.Mesh(rampGridGeo, rampGridMat);
      rampGrid.rotation.x = -(Math.PI / 2 - rampAngle);
      rampGrid.position.set(rampCenterX, rampMidY + 0.02, rampMidZ);
      scene.add(rampGrid);
      this.objects.push(rampGrid);

      // Side walls for ramp (triangular)
      for (const xSide of [ramp.xMin, ramp.xMax]) {
        const sideGeo = new THREE.BufferGeometry();
        const vertices = new Float32Array([
          xSide, 0, RAMP_Z_START,
          xSide, H, PLATFORM_Z_FRONT,
          xSide, 0, PLATFORM_Z_FRONT,
        ]);
        sideGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        sideGeo.computeVertexNormals();
        const sideMat = new THREE.MeshStandardMaterial({
          color: 0x3a1a5a,
          emissive: 0x2a1a4a,
          emissiveIntensity: 0.3,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
        });
        const sideWall = new THREE.Mesh(sideGeo, sideMat);
        scene.add(sideWall);
        this.objects.push(sideWall);
      }

      // Glowing edge along ramp sides
      const rampLength3D = Math.sqrt(SKYBRIDGE_RAMP_LENGTH ** 2 + H ** 2);
      const rampEdgeGeo = new THREE.BoxGeometry(0.15, 0.15, rampLength3D);
      for (const xSide of [ramp.xMin, ramp.xMax]) {
        const rampEdge = new THREE.Mesh(rampEdgeGeo, edgeMat.clone());
        rampEdge.rotation.x = -rampAngle;
        rampEdge.position.set(xSide, rampMidY, rampMidZ);
        scene.add(rampEdge);
        this.objects.push(rampEdge);
      }
    }

    // Ambient light under platform for visibility
    const underLight = new THREE.PointLight(0x6633aa, 2, 60);
    underLight.position.set(0, 2, PLATFORM_Z_FRONT + D / 2);
    scene.add(underLight);
    this.objects.push(underLight);
  }

  dispose(scene: THREE.Scene): void {
    for (const obj of this.objects) {
      scene.remove(obj);
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
    this.objects = [];
    this.walls = [];
  }
}
