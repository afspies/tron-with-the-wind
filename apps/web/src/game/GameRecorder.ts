/**
 * GameRecorder: Captures gameplay video using MediaRecorder API.
 * Uses captureStream() directly on the game canvas for zero-overhead recording.
 * Produces a video Blob at stop().
 */

export class GameRecorder {
  private gameCanvas: HTMLCanvasElement;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  private resolveStop: ((blob: Blob) => void) | null = null;
  private recording = false;

  constructor(gameCanvas: HTMLCanvasElement) {
    this.gameCanvas = gameCanvas;
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

    const stream = this.gameCanvas.captureStream(30);
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 2_500_000,
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
