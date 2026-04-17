/**
 * Dev-only overlay that shows the live state of client-side prediction and
 * reconciliation. Toggle with the backtick (`) key. Reads from Game.netStats,
 * which is mutated by the reconciler and updatePlayingOnline each frame.
 *
 * Not shipped in the production UI. The goal is to make the invisible visible:
 *  - Frame dt (is the render loop smooth?)
 *  - Server tick dt (is the server broadcasting evenly?)
 *  - RTT (from input seq ACK)
 *  - Post-replay error magnitude (near zero means prediction is aligned)
 *  - Render offset magnitude (the visual smoothing buffer)
 *  - Reconcile action counts (snaps are bad; applies are fine)
 *  - Replay step count (how many unacked inputs we're replaying per tick)
 */

export interface NetStatsBag {
  frameDtMs: number;
  serverTickDtMs: number;
  lastServerTickAtMs: number;
  rttMs: number;
  reconcileErrorM: number;
  reconcileSnaps: number;
  reconcileApplies: number;
  renderOffsetMag: number;
  inputHistoryLen: number;
  replaySteps: number;
  localTick: number;
  serverTick: number;
}

export class NetDebugOverlay {
  private el: HTMLDivElement;
  private visible = false;
  private frameDtWindow: number[] = [];
  private readonly windowSize = 60;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'netdebug-overlay';
    this.el.style.cssText = [
      'position: fixed', 'top: 10px', 'right: 10px', 'z-index: 10000',
      'padding: 8px 12px', 'background: rgba(0,0,0,0.78)', 'color: #9f9',
      'font: 11px/1.35 ui-monospace, Menlo, monospace', 'border: 1px solid #2a2',
      'border-radius: 4px', 'pointer-events: none', 'min-width: 220px',
      'white-space: pre', 'display: none',
    ].join(';');
    document.body.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      // Backtick toggles the overlay. Ignore when typing in an input.
      if (e.key !== '`') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  /** Called each frame from Game's loop when the overlay is visible. */
  update(stats: NetStatsBag): void {
    if (!this.visible) return;

    this.frameDtWindow.push(stats.frameDtMs);
    if (this.frameDtWindow.length > this.windowSize) this.frameDtWindow.shift();
    const avgFrame = this.frameDtWindow.reduce((a, b) => a + b, 0) / this.frameDtWindow.length;
    const p95Frame = percentile(this.frameDtWindow, 0.95);

    const lines = [
      'NET DEBUG (`) to hide',
      `frame dt       ${fmtMs(avgFrame)} avg   ${fmtMs(p95Frame)} p95`,
      `server tick dt ${fmtMs(stats.serverTickDtMs)}`,
      `rtt            ${fmtMs(stats.rttMs)}`,
      `tick           local=${stats.localTick}  srv=${stats.serverTick}`,
      `recon error    ${stats.reconcileErrorM.toFixed(3)} m`,
      `render offset  ${stats.renderOffsetMag.toFixed(3)} m`,
      `replay steps   ${stats.replaySteps}`,
      `inputs buffered${stats.inputHistoryLen.toString().padStart(7)}`,
      `reconcile      apply=${stats.reconcileApplies}  snap=${stats.reconcileSnaps}`,
    ];
    this.el.textContent = lines.join('\n');
  }
}

function fmtMs(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '  --  ';
  return n.toFixed(1).padStart(5) + ' ms';
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}
