export class ConfirmationDialog {
  private dialog: HTMLDialogElement;
  private resolveRef: ((value: boolean) => void) | null = null;
  private title: string;
  private message: string;
  private confirmLabel: string;
  private cancelLabel: string;

  constructor(
    title: string,
    message: string,
    confirmLabel: string = 'Confirm',
    cancelLabel: string = 'Cancel'
  ) {
    this.title = title;
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.cancelLabel = cancelLabel;
    this.dialog = this.createDialog();
    document.body.appendChild(this.dialog);
  }

  private createDialog(): HTMLDialogElement {
    const dialog = document.createElement('dialog');
    dialog.className = 'bg-app-surface text-app-text p-0 rounded-xl shadow-2xl border border-app-border backdrop:bg-black/50 backdrop:backdrop-blur-sm max-w-md w-full fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0';
    
    dialog.innerHTML = `
      <div class="p-6">
        <h3 class="text-xl font-bold text-app-accent-1 mb-2">${this.title}</h3>
        <p class="text-app-text/80 mb-6">${this.message}</p>
        <div class="flex justify-end gap-3">
          <button id="dialog-cancel" class="px-4 py-2 text-app-muted hover:text-app-text transition-colors cursor-pointer font-medium">
            ${this.cancelLabel}
          </button>
          <button id="dialog-confirm" class="px-6 py-2 bg-app-accent-1 hover:brightness-110 text-white rounded-lg transition-all font-bold shadow-lg cursor-pointer">
            ${this.confirmLabel}
          </button>
        </div>
      </div>
    `;

    dialog.querySelector('#dialog-cancel')?.addEventListener('click', () => this.handleClose(false));
    dialog.querySelector('#dialog-confirm')?.addEventListener('click', () => this.handleClose(true));
    
    // Close on backdrop click
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
      if (!isInDialog) {
        this.handleClose(false);
      }
    });

    // Handle Escape key
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.handleClose(false);
    });

    return dialog;
  }

  private handleClose(result: boolean) {
    this.dialog.close();
    if (this.resolveRef) {
      this.resolveRef(result);
    }
    this.cleanup();
  }

  private cleanup() {
    setTimeout(() => {
      if (this.dialog.parentNode) {
        document.body.removeChild(this.dialog);
      }
    }, 300); // Wait for potential fade out
  }

  public async show(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveRef = resolve;
      this.dialog.showModal();
    });
  }
}
