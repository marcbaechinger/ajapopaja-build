import { BaseDialog } from './dialog_common.ts';

export class ConfirmationDialog extends BaseDialog<boolean> {
  private message: string;
  private confirmLabel: string;
  private cancelLabel: string;

  constructor(
    title: string,
    message: string,
    confirmLabel: string = 'Confirm',
    cancelLabel: string = 'Cancel'
  ) {
    super({ title });
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.cancelLabel = cancelLabel;
    
    // Re-render layout because we need labels
    this.updateContent();
  }

  private updateContent() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody() as string;
    
    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    footerContainer.innerHTML = this.renderFooter() as string;

    this.dialog.querySelector('#dialog-cancel')?.addEventListener('click', () => this.close(false));
    this.dialog.querySelector('#dialog-confirm')?.addEventListener('click', () => this.close(true));
  }

  protected renderBody(): string {
    return `
      <div class="p-6">
        <p class="text-app-text/80">${this.message}</p>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-6 pt-0 flex justify-end gap-3">
        <button id="dialog-cancel" class="px-4 py-2 text-app-muted hover:text-app-text transition-colors cursor-pointer font-medium">
          ${this.cancelLabel}
        </button>
        <button id="dialog-confirm" class="px-6 py-2 bg-app-accent-1 hover:brightness-110 text-white rounded-lg transition-all font-bold shadow-lg cursor-pointer">
          ${this.confirmLabel}
        </button>
      </div>
    `;
  }

  public async show(): Promise<boolean> {
    const result = await super.show();
    return result ?? false;
  }
}
