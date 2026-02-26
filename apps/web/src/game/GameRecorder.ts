/**
 * GameRecorder: Captures gameplay video using MediaRecorder API.
 * Composites the game canvas with a branding watermark onto an offscreen canvas,
 * then records the stream. Produces a video Blob at stop().
 */

export class GameRecorder {
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private gameCanvas: HTMLCanvasElement;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  private resolveStop: ((blob: Blob) => void) | null = null;
  private recording = false;

  constructor(gameCanvas: HTMLCanvasElement) {
    this.gameCanvas = gameCanvas;
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = gameCanvas.width;
    this.offscreen.height = gameCanvas.height;
    this.offCtx = this.offscreen.getContext('2d')!;
  }

  static isSupported(): boolean {
    return typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  start(): void {
    if (this.recording) return;

    // Pick best available MIME type
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    this.mimeType = candidates.find(m => MediaRecorder.isTypeSupported(m)) || '';
    if (!this.mimeType) return;

    const stream = this.offscreen.captureStream(30);
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 4_000_000,
    });

    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mimeType });
      this.chunks = [];
      this.resolveStop?.(blob);
      this.resolveStop = null;
    };

    this.recorder.start(1000); // collect data every second
    this.recording = true;
  }

  captureFrame(): void {
    if (!this.recording) return;

    // Resize offscreen if game canvas size changed
    if (this.offscreen.width !== this.gameCanvas.width ||
        this.offscreen.height !== this.gameCanvas.height) {
      this.offscreen.width = this.gameCanvas.width;
      this.offscreen.height = this.gameCanvas.height;
    }

    // Draw game canvas
    this.offCtx.drawImage(this.gameCanvas, 0, 0);

    // Draw branding watermark
    this.drawWatermark();
  }

  private drawWatermark(): void {
    const ctx = this.offCtx;
    const w = this.offscreen.width;
    const h = this.offscreen.height;

    const fontSize = Math.max(12, Math.round(h * 0.018));
    ctx.save();
    ctx.font = `${fontSize}px Cinzel, serif`;
    ctx.fillStyle = 'rgba(255, 215, 0, 0.4)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Tron with the Wind \u00B7 tron.afspies.com', w - 16, h - 12);
    ctx.restore();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve(new Blob([], { type: this.mimeType }));
        return;
      }
      this.resolveStop = resolve;
      this.recorder.stop();
      this.recording = false;
    });
  }

  getMimeType(): string {
    return this.mimeType;
  }

  isRecording(): boolean {
    return this.recording;
  }

  dispose(): void {
    if (this.recording) {
      this.recorder?.stop();
      this.recording = false;
    }
    this.recorder = null;
    this.chunks = [];
    this.resolveStop = null;
  }
}
