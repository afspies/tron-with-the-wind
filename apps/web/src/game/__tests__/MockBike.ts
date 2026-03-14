/** Lightweight Bike stub for headless prediction tests (no Three.js). */
export function createMockBike() {
  return {
    alive: true,
    renderOffset: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
    renderAngleOffset: 0,
    applyNetState() {},
    syncInvulnerabilityFromNet() {},
  };
}
