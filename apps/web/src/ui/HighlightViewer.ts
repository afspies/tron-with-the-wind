/**
 * HighlightViewer: Shows gameplay highlights in the game-over screen.
 * Includes video player, filmstrip of highlight cards, and download/share actions.
 */

import type { Highlight } from '../game/HighlightTracker';

const EVENT_ICONS: Record<string, string> = {
  death: '\u2620',      // skull
  nearMiss: '\u26A0',   // warning
  roundWin: '\u2605',   // star
  gameWin: '\u2655',    // crown (queen chess)
  powerup: '\u2B50',    // star
};

export class HighlightViewer {
  private container: HTMLElement;
  private video: HTMLVideoElement | null = null;
  private blobUrl = '';
  private highlights: Highlight[] = [];
  private reelIndex = 0;
  private reelPlaying = false;

  constructor() {
    this.container = document.getElementById('highlights-section')!;
  }

  show(blob: Blob, mimeType: string, highlights: Highlight[]): void {
    this.highlights = highlights;
    if (!blob.size || !this.container) return;

    this.blobUrl = URL.createObjectURL(blob);
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

    this.container.innerHTML = '';

    // Video player with watermark overlay
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'highlight-video-wrapper';

    this.video = document.createElement('video');
    this.video.src = this.blobUrl;
    this.video.className = 'highlight-video';
    this.video.controls = true;
    this.video.playsInline = true;
    videoWrapper.appendChild(this.video);

    const watermark = document.createElement('div');
    watermark.className = 'highlight-watermark';
    watermark.textContent = 'Tron with the Wind \u00B7 tron.afspies.com';
    videoWrapper.appendChild(watermark);

    this.container.appendChild(videoWrapper);

    // Filmstrip
    if (highlights.length > 0) {
      const filmstrip = document.createElement('div');
      filmstrip.className = 'highlight-filmstrip';

      for (const hl of highlights) {
        const card = document.createElement('div');
        card.className = 'highlight-card';
        card.innerHTML = `
          <span class="hl-icon">${EVENT_ICONS[hl.type] || '\u25CF'}</span>
          <span class="hl-label">${hl.label}</span>
          <span class="hl-time">${this.formatTime(hl.timestamp)}</span>
        `;
        card.addEventListener('click', () => this.seekToHighlight(hl));
        filmstrip.appendChild(card);
      }
      this.container.appendChild(filmstrip);
    }

    // Action row
    const actions = document.createElement('div');
    actions.className = 'highlight-actions';

    if (highlights.length > 1) {
      const reelBtn = document.createElement('button');
      reelBtn.className = 'menu-btn highlight-btn';
      reelBtn.textContent = 'Watch Reel';
      reelBtn.addEventListener('click', () => this.playReel());
      actions.appendChild(reelBtn);
    }

    const dlBtn = document.createElement('a');
    dlBtn.className = 'menu-btn highlight-btn';
    dlBtn.textContent = 'Download';
    dlBtn.href = this.blobUrl;
    dlBtn.download = `tron-highlights.${ext}`;
    actions.appendChild(dlBtn);

    const shareBtn = document.createElement('button');
    shareBtn.className = 'menu-btn highlight-btn';
    shareBtn.textContent = 'Share';
    shareBtn.addEventListener('click', () => this.share(blob, ext));
    actions.appendChild(shareBtn);

    this.container.appendChild(actions);

    // Branding CTA
    const cta = document.createElement('p');
    cta.className = 'highlight-cta';
    cta.textContent = 'Play free at tron.afspies.com';
    this.container.appendChild(cta);

    this.container.style.display = 'flex';
  }

  hide(): void {
    if (this.container) {
      this.container.style.display = 'none';
      this.container.innerHTML = '';
    }
    this.reelPlaying = false;
  }

  dispose(): void {
    this.hide();
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = '';
    }
    this.video = null;
  }

  private seekToHighlight(hl: Highlight): void {
    if (!this.video) return;
    this.video.currentTime = Math.max(0, hl.timestamp - 2);
    this.video.play();
  }

  private playReel(): void {
    if (!this.video || this.highlights.length === 0) return;
    this.reelIndex = 0;
    this.reelPlaying = true;
    this.playNextInReel();
  }

  private playNextInReel(): void {
    if (!this.video || !this.reelPlaying || this.reelIndex >= this.highlights.length) {
      this.reelPlaying = false;
      return;
    }

    const hl = this.highlights[this.reelIndex];
    const startTime = Math.max(0, hl.timestamp - 2);
    const endTime = hl.timestamp + 3;
    this.video.currentTime = startTime;
    this.video.play();

    const checkEnd = () => {
      if (!this.video || !this.reelPlaying) {
        this.video?.removeEventListener('timeupdate', checkEnd);
        return;
      }
      if (this.video.currentTime >= endTime) {
        this.video.removeEventListener('timeupdate', checkEnd);
        this.video.pause();
        this.reelIndex++;
        if (this.reelIndex < this.highlights.length) {
          setTimeout(() => this.playNextInReel(), 300);
        } else {
          this.reelPlaying = false;
        }
      }
    };
    this.video.addEventListener('timeupdate', checkEnd);
  }

  private async share(blob: Blob, ext: string): Promise<void> {
    if (navigator.share) {
      try {
        const file = new File([blob], `tron-highlights.${ext}`, { type: blob.type });
        await navigator.share({
          title: 'Tron with the Wind - Highlights',
          text: 'Check out my gameplay highlights!',
          files: [file],
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText('https://tron.afspies.com');
      this.showToast('Link copied to clipboard!');
    } catch {
      this.showToast('tron.afspies.com');
    }
  }

  private showToast(message: string): void {
    const toast = document.createElement('div');
    toast.className = 'highlight-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
