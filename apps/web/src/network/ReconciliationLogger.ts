export class ReconciliationLogger {
  private entries: { tick: number; posError: number; angleError: number }[] = [];
  private warnThreshold: number;

  constructor(warnThreshold = 0.5) {
    this.warnThreshold = warnThreshold;
  }

  log(tick: number, posError: number, angleError: number): void {
    this.entries.push({ tick, posError, angleError });
    if (posError > this.warnThreshold) {
      console.warn(`[Reconciliation] tick=${tick} posError=${posError.toFixed(4)} angleError=${angleError.toFixed(4)}`);
    }
  }

  summary(): { max: number; avg: number; p95: number; correctionCount: number } {
    if (this.entries.length === 0) return { max: 0, avg: 0, p95: 0, correctionCount: 0 };
    const errs = this.entries.map(e => e.posError);
    const sorted = [...errs].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1];
    const avg = errs.reduce((a, b) => a + b, 0) / errs.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const correctionCount = errs.filter(e => e > 0.001).length;
    return { max, avg, p95, correctionCount };
  }

  clear(): void {
    this.entries.length = 0;
  }
}
