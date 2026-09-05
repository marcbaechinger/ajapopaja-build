import { BaseDialog } from './dialog_common.ts';
import { AppContext } from '../../core/AppContext.ts';
import { Icon } from './Icon.ts';

export class HealthCheckDialog extends BaseDialog {
  private appContext: AppContext;

  constructor(appContext: AppContext) {
    super({
      title: 'System Health Check',
      maxWidth: 'max-w-xl',
      maxHeight: 'max-h-[80vh]',
      iconSvg: Icon.render('check', { size: 20 })
    });
    this.appContext = appContext;
  }


  protected renderBody(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'p-4 flex flex-col gap-4';
    
    container.innerHTML = `
      <div class="flex items-center justify-center p-8">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-app-accent-2"></div>
        <span class="ml-3 text-app-muted">Running health checks...</span>
      </div>
    `;

    // loadHealthCheck is called from show() because appContext is initialized after super()
    return container;
  }

  private async loadHealthCheck() {
    const container = this.dialog.querySelector('.p-4.flex-col.gap-4') as HTMLElement;
    if (!container || !this.appContext) return;

    try {
      const health = await this.appContext.systemClient.getHealth();
      
      const createRow = (name: string, data: {status: string, details: string}) => {
        const isOk = data.status === 'ok';
        const icon = isOk 
            ? Icon.render('check', { size: 20, className: 'text-green-500 shrink-0' })
            : Icon.render('close', { size: 20, className: 'text-red-500 shrink-0' }); // Assuming 'close' or 'x' can be used for failure

        return `

          <div class="flex flex-col border border-app-border rounded-lg p-4 bg-app-surface">
            <div class="flex items-center gap-3 mb-2">
              ${icon}
              <h4 class="font-bold text-app-text capitalize">${name}</h4>
            </div>
            <div class="text-sm text-app-muted font-mono whitespace-pre-wrap break-all">${data.details}</div>
          </div>
        `;
      };

      container.innerHTML = `
        <div class="grid grid-cols-1 gap-4">
          ${createRow('MongoDB', health.mongodb)}
          ${createRow('Ollama', health.ollama)}
          ${createRow('Neovim Socket', health.nvim)}
          ${createRow('PI', health.pi)}
        </div>
      `;
    } catch (error) {
      container.innerHTML = `
        <div class="p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-500">
          Failed to run health checks. ${error}
        </div>
      `;
    }
  }

  protected renderFooter(): string {
    return `
      <div class="p-4 border-t border-app-border bg-app-surface flex justify-end">
        <button id="close-health-btn" class="px-4 py-2 bg-app-bg border border-app-border rounded-lg text-app-text hover:bg-app-border transition-colors cursor-pointer">
          Close
        </button>
      </div>
    `;
  }

  public async show(): Promise<void | null> {
    const showPromise = super.show();
    
    // Wait for render before attaching events
    setTimeout(() => {
      this.dialog.querySelector('#close-health-btn')?.addEventListener('click', () => this.close());
      this.loadHealthCheck();
    }, 0);
    
    return showPromise;
  }
}
