import type { Vec3 } from '@tron/shared';

/** Rodrigues' rotation formula: rotate vector v around unit axis k by angle theta */
export function rotateVectorAroundAxis(v: Vec3, k: Vec3, theta: number): Vec3 {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const dot = k.x * v.x + k.y * v.y + k.z * v.z;
  return {
    x: v.x * cosT + (k.y * v.z - k.z * v.y) * sinT + k.x * dot * (1 - cosT),
    y: v.y * cosT + (k.z * v.x - k.x * v.z) * sinT + k.y * dot * (1 - cosT),
    z: v.z * cosT + (k.x * v.y - k.y * v.x) * sinT + k.z * dot * (1 - cosT),
  };
}

/** Project a vector onto a surface plane (remove the normal component) and renormalize */
export function projectOntoSurfacePlane(v: Vec3, normal: Vec3): Vec3 {
  const dot = v.x * normal.x + v.y * normal.y + v.z * normal.z;
  const proj = {
    x: v.x - dot * normal.x,
    y: v.y - dot * normal.y,
    z: v.z - dot * normal.z,
  };
  const len = Math.sqrt(proj.x * proj.x + proj.y * proj.y + proj.z * proj.z);
  if (len < 0.001) return { x: 0, y: 0, z: 0 };
  return { x: proj.x / len, y: proj.y / len, z: proj.z / len };
}
