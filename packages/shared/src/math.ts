// Lightweight quaternion + Vec3 math with no Three.js dependency

import type { Quat, Vec3 } from './types';

// ---- Quaternion operations ----

export function quatIdentity(): Quat {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return {
    x: axis.x * s,
    y: axis.y * s,
    z: axis.z * s,
    w: Math.cos(half),
  };
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatInverse(q: Quat): Quat {
  const dot = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  const invDot = dot > 0 ? 1 / dot : 0;
  return { x: -q.x * invDot, y: -q.y * invDot, z: -q.z * invDot, w: q.w * invDot };
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len < 1e-10) return quatIdentity();
  const inv = 1 / len;
  return { x: q.x * inv, y: q.y * inv, z: q.z * inv, w: q.w * inv };
}

export function quatDot(a: Quat, b: Quat): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

export function quatNegate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
}

export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let dot = a.x * bx + a.y * by + a.z * bz + a.w * bw;

  // Handle double-cover
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }

  if (dot > 0.9995) {
    // Very close — linear interpolation
    return quatNormalize({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }

  const theta = Math.acos(Math.min(dot, 1));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;

  return {
    x: a.x * wa + bx * wb,
    y: a.y * wa + by * wb,
    z: a.z * wa + bz * wb,
    w: a.w * wa + bw * wb,
  };
}

export function quatRotateVec3(q: Quat, v: Vec3): Vec3 {
  // q * v * q^-1 (optimized)
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** Construct quaternion from orthonormal basis vectors (right, up, forward). */
export function quatFromBasis(right: Vec3, up: Vec3, forward: Vec3): Quat {
  // Rotation matrix columns: right=col0, up=col1, forward=col2
  const m00 = right.x, m01 = up.x, m02 = forward.x;
  const m10 = right.y, m11 = up.y, m12 = forward.y;
  const m20 = right.z, m21 = up.z, m22 = forward.z;

  const trace = m00 + m11 + m22;
  let q: Quat;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    q = {
      w: 0.25 / s,
      x: (m21 - m12) * s,
      y: (m02 - m20) * s,
      z: (m10 - m01) * s,
    };
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    q = {
      w: (m21 - m12) / s,
      x: 0.25 * s,
      y: (m01 + m10) / s,
      z: (m02 + m20) / s,
    };
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    q = {
      w: (m02 - m20) / s,
      x: (m01 + m10) / s,
      y: 0.25 * s,
      z: (m12 + m21) / s,
    };
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    q = {
      w: (m10 - m01) / s,
      x: (m02 + m20) / s,
      y: (m12 + m21) / s,
      z: 0.25 * s,
    };
  }

  return quatNormalize(q);
}

/** Extract yaw angle (rotation around Y axis) from quaternion. */
export function quatToYawAngle(q: Quat): number {
  // Forward vector projected onto XZ plane
  const fwd = quatRotateVec3(q, { x: 0, y: 0, z: 1 });
  return Math.atan2(fwd.x, fwd.z);
}

// ---- Vec3 operations ----

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function vec3LengthSq(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < 1e-10) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Project vector onto plane defined by normal. */
export function vec3ProjectOnPlane(v: Vec3, normal: Vec3): Vec3 {
  const d = vec3Dot(v, normal);
  return { x: v.x - normal.x * d, y: v.y - normal.y * d, z: v.z - normal.z * d };
}

/** Reflect vector across a normal. */
export function vec3Reflect(v: Vec3, normal: Vec3): Vec3 {
  const d = 2 * vec3Dot(v, normal);
  return { x: v.x - normal.x * d, y: v.y - normal.y * d, z: v.z - normal.z * d };
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function vec3DistSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

// ---- 3D collision utilities ----

/** Minimum distance between two 3D line segments. */
export function segmentSegmentDistance3D(
  a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3,
): number {
  const d1 = vec3Sub(a2, a1);
  const d2 = vec3Sub(b2, b1);
  const r = vec3Sub(a1, b1);

  const a = vec3Dot(d1, d1);
  const e = vec3Dot(d2, d2);
  const f = vec3Dot(d2, r);

  if (a < 1e-10 && e < 1e-10) {
    return vec3Length(r);
  }

  let s: number, t: number;

  if (a < 1e-10) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = vec3Dot(d1, r);
    if (e < 1e-10) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = vec3Dot(d1, d2);
      const denom = a * e - b * b;

      if (denom !== 0) {
        s = Math.max(0, Math.min(1, (b * f - c * e) / denom));
      } else {
        s = 0;
      }

      t = (b * s + f) / e;

      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }

  const closest1 = vec3Add(a1, vec3Scale(d1, s));
  const closest2 = vec3Add(b1, vec3Scale(d2, t));
  return vec3Length(vec3Sub(closest1, closest2));
}

/** Ray-triangle intersection, returns distance along ray or null. */
function rayTriIntersect(
  origin: Vec3, dir: Vec3,
  v0: Vec3, v1: Vec3, v2: Vec3,
): number | null {
  const e1 = vec3Sub(v1, v0);
  const e2 = vec3Sub(v2, v0);
  const h = vec3Cross(dir, e2);
  const a = vec3Dot(e1, h);
  if (Math.abs(a) < 1e-10) return null;

  const f = 1 / a;
  const s = vec3Sub(origin, v0);
  const u = f * vec3Dot(s, h);
  if (u < 0 || u > 1) return null;

  const q = vec3Cross(s, e1);
  const v = f * vec3Dot(dir, q);
  if (v < 0 || u + v > 1) return null;

  const t = f * vec3Dot(e2, q);
  if (t < 0) return null;
  return t;
}

/** Ray-quad intersection (two triangles). Returns distance along ray or null. */
export function rayQuadIntersect(
  origin: Vec3, dir: Vec3,
  v0: Vec3, v1: Vec3, v2: Vec3, v3: Vec3,
): number | null {
  const t1 = rayTriIntersect(origin, dir, v0, v1, v2);
  const t2 = rayTriIntersect(origin, dir, v0, v2, v3);
  if (t1 !== null && t2 !== null) return Math.min(t1, t2);
  return t1 ?? t2;
}
