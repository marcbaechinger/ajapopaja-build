import { BaseDialog } from './dialog_common.ts';
import type { AppContext } from '../../core/AppContext.ts';

export class HealthCheckDialog extends BaseDialog {
  private appContext: AppContext;
  
  constructor(appContext: AppContext) {
    super({
      title: 'System Health Check',
      maxWidth: 'max-w-xl',
      maxHeight: 'max-h-[80vh]',
      iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
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

    this.loadHealthCheck(container);
    
    return container;
  }

  private async loadHealthCheck(container: HTMLElement) {
    try {
      const health = await this.appContext.systemClient.getHealth();
      
      const createRow = (name: string, data: {status: string, details: string}) => {
        const isOk = data.status === 'ok';
        const icon = isOk 
            ? '<svg class="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'
            : '<svg class="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
        
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
    const result = await super.show();
    
    // Wait for render before attaching events
    setTimeout(() => {
      this.dialog.querySelector('#close-health-btn')?.addEventListener('click', () => this.close());
    }, 0);
    
    return result;
  }
}
