import * as THREE from 'three';

export function setupEnvironment(scene: THREE.Scene): void {
  // Sunset gradient sky using a large sphere with shader material
  const skyGeo = new THREE.SphereGeometry(500, 32, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x1a0a2e) },
      midColor: { value: new THREE.Color(0x4a2040) },
      bottomColor: { value: new THREE.Color(0xff8844) },
      offset: { value: 20 },
      exponent: { value: 0.4 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        float t = max(pow(max(h, 0.0), exponent), 0.0);
        vec3 color;
        if (h > 0.0) {
          color = mix(midColor, topColor, t);
        } else {
          color = mix(midColor, bottomColor, -h * 3.0);
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // Floating ambient particles
  const particleCount = 200;
  const particlePositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 200;
    particlePositions[i * 3 + 1] = 3 + Math.random() * 30;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 200;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0xffd700,
    size: 0.3,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // Animate particles slowly (store reference for animation)
  (scene as any)._ambientParticles = { positions: particlePositions, mesh: particles };
}

export function updateEnvironment(scene: THREE.Scene, time: number): void {
  const ambient = (scene as any)._ambientParticles;
  if (!ambient) return;

  const positions = ambient.positions as Float32Array;
  for (let i = 0; i < positions.length / 3; i++) {
    positions[i * 3 + 1] += Math.sin(time + i * 0.1) * 0.003;
    positions[i * 3] += Math.cos(time * 0.5 + i * 0.2) * 0.002;
  }
  (ambient.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}
