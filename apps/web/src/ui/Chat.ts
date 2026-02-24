export interface ChatMessage {
  sender: string;
  color: string;
  text: string;
}

export class Chat {
  private container: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private onSend: ((msg: ChatMessage) => void) | null = null;
  private localName = '';
  private localColor = '';
  private fadeTimers: number[] = [];

  constructor() {
    this.container = document.getElementById('chat-container')!;
    this.messagesEl = document.getElementById('chat-messages')!;
    this.inputEl = document.getElementById('chat-input') as HTMLInputElement;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' && this.container.style.display !== 'none') {
        if (this.inputEl.style.display === 'none') {
          // Open chat input
          this.inputEl.style.display = 'block';
          this.inputEl.focus();
          e.preventDefault();
        } else if (document.activeElement === this.inputEl) {
          // Send message
          const text = this.inputEl.value.trim();
          if (text && this.onSend) {
            const msg: ChatMessage = { sender: this.localName, color: this.localColor, text };
            this.onSend(msg);
            this.addMessage(msg);
          }
          this.inputEl.value = '';
          this.inputEl.style.display = 'none';
          this.inputEl.blur();
          e.preventDefault();
        }
      } else if (e.code === 'Escape' && document.activeElement === this.inputEl) {
        this.inputEl.value = '';
        this.inputEl.style.display = 'none';
        this.inputEl.blur();
        e.preventDefault();
      }
    });
  }

  show(localName: string, localColor: string, onSend: (msg: ChatMessage) => void): void {
    this.localName = localName;
    this.localColor = localColor;
    this.onSend = onSend;
    this.messagesEl.innerHTML = '';
    this.container.style.display = 'block';
    this.inputEl.style.display = 'none';
    for (const t of this.fadeTimers) clearTimeout(t);
    this.fadeTimers = [];
  }

  hide(): void {
    this.container.style.display = 'none';
    this.inputEl.style.display = 'none';
    this.inputEl.blur();
    for (const t of this.fadeTimers) clearTimeout(t);
    this.fadeTimers = [];
  }

  addMessage(msg: ChatMessage): void {
    const el = document.createElement('div');
    el.className = 'chat-msg';
    el.innerHTML = `<span style="color:${msg.color};font-weight:700;">${this.escapeHtml(msg.sender)}</span>: ${this.escapeHtml(msg.text)}`;
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

    // Auto-fade after 8 seconds
    const timer = window.setTimeout(() => {
      el.classList.add('faded');
    }, 8000);
    this.fadeTimers.push(timer);
  }

  private escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
}
