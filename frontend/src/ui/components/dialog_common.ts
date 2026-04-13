export interface DialogOptions {
  maxWidth?: string;
  maxHeight?: string;
  title: string;
  iconSvg?: string;
}

export abstract class BaseDialog<T = void> {
  private static openDialogs: Map<string, BaseDialog<any>> = new Map();
  protected dialog: HTMLDialogElement;
  private resolveRef: ((value: T | null) => void) | null = null;
  private container: HTMLDivElement;

  constructor(options: DialogOptions) {
    this.container = document.createElement('div');
    this.container.className = 'dialog-wrapper dialog-closed';

    this.dialog = document.createElement('dialog');
    
    // Apply common classes and layout
    const maxWidth = options.maxWidth || 'max-w-md';
    const maxHeight = options.maxHeight || 'max-h-[80vh]';
    
    this.dialog.className = `p-0 m-0 border-none bg-transparent backdrop:bg-transparent fixed inset-0 z-50 w-full h-full max-w-none max-h-none overflow-hidden flex flex-col pointer-events-none dialog-closed`;
    
    this.renderLayout(options, maxWidth, maxHeight);
    this.attachEventListeners();
  }

  private renderLayout(options: DialogOptions, maxWidth: string, maxHeight: string) {
    const iconHtml = options.iconSvg ? `<span class="text-app-accent-2">${options.iconSvg}</span>` : '';
    
    this.dialog.innerHTML = `
      <div class="dialog-backdrop pointer-events-auto"></div>
      <div class="dialog-panel">
        <div class="dialog-content ${maxWidth} ${maxHeight}">
          <div class="p-4 border-b border-app-border flex justify-between items-center bg-app-bg shrink-0">
            <h3 class="text-lg font-bold text-app-accent-2 flex items-center gap-2">
              ${iconHtml}
              ${options.title}
            </h3>
            <button id="dialog-close-btn" class="text-app-muted hover:text-app-text transition-colors cursor-pointer p-1 rounded hover:bg-app-surface">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
          <div id="dialog-body-container" class="p-0 overflow-y-auto overflow-x-hidden grow custom-scrollbar">
            <!-- Body will be injected here -->
          </div>
          <div id="dialog-footer-container" class="shrink-0">
            <!-- Footer will be injected here -->
          </div>
        </div>
      </div>
    `;

    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    const bodyContent = this.renderBody();
    if (typeof bodyContent === 'string') {
      bodyContainer.innerHTML = bodyContent;
    } else {
      bodyContainer.appendChild(bodyContent);
    }

    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    if (this.renderFooter) {
      const footerContent = this.renderFooter();
      if (typeof footerContent === 'string') {
        footerContainer.innerHTML = footerContent;
      } else {
        footerContainer.appendChild(footerContent);
      }
    } else {
      footerContainer.remove();
    }

    this.dialog.querySelector('#dialog-close-btn')?.addEventListener('click', () => this.close(null));
  }

  private attachEventListeners() {
    // Close on backdrop click
    this.dialog.querySelector('.dialog-backdrop')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close(null);
    });

    // Handle Escape key
    this.dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.close(null);
    });
  }

  // Abstract methods for child classes to implement
  protected abstract renderBody(): string | HTMLElement;
  protected renderFooter?(): string | HTMLElement; // Optional

  // Unified show method returning a promise
  public async show(): Promise<T | null> {
    const dialogName = this.constructor.name;
    const existing = BaseDialog.openDialogs.get(dialogName);
    if (existing) {
      // Don't open a new one, just shake the existing one
      const content = existing.dialog.querySelector('.dialog-content') as HTMLElement;
      if (content) {
        content.classList.remove('animate-dialog-shake');
        void content.offsetWidth; // Force reflow
        content.classList.add('animate-dialog-shake');
      }
      return null;
    }
    BaseDialog.openDialogs.set(dialogName, this);

    document.body.appendChild(this.dialog);
    this.dialog.showModal();
    
    // Trigger transition
    requestAnimationFrame(() => {
      this.dialog.classList.remove('dialog-closed');
      this.dialog.classList.add('dialog-open');
    });

    return new Promise((resolve) => {
      this.resolveRef = resolve;
    });
  }

  // Unified close method
  protected close(result: T | null = null) {
    const dialogName = this.constructor.name;
    if (BaseDialog.openDialogs.get(dialogName) === this) {
      BaseDialog.openDialogs.delete(dialogName);
    }

    // Trigger exit transition
    this.dialog.classList.remove('dialog-open');
    this.dialog.classList.add('dialog-closed');

    if (this.resolveRef) {
      this.resolveRef(result);
      this.resolveRef = null;
    }

    // Cleanup after transition
    setTimeout(() => {
      if (this.dialog.open) {
        this.dialog.close();
      }
      if (this.dialog.parentNode) {
        document.body.removeChild(this.dialog);
      }
    }, 300);
  }
}
