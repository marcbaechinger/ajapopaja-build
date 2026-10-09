import { BaseDialog } from './dialog_common.ts';
import { AppContext } from '../../../core/AppContext.ts';
import { Icon } from '../common/Icon.ts';
import { escapeHtml } from '../utils/html.ts';
import type {
  ConfigProperty,
  HealthCheckResponse
} from '../../../core/clients/SystemClient.ts';

type HealthTab = 'health' | 'config';

/**
 * Read-only system diagnostics dialog.
 *
 * The default "Health" tab shows the live status of the backing services
 * (MongoDB, Ollama, Neovim socket and the `pi` CLI). The "System Properties"
 * tab lists every server configuration property. Secret values (API keys,
 * tokens, passwords) are redacted by the server and are never transmitted – the
 * UI only ever displays `(stored)` / `(not available)` for them.
 */
export class HealthCheckDialog extends BaseDialog {
  private appContext: AppContext;
  private activeTab: HealthTab = 'health';
  private health: HealthCheckResponse | null = null;
  private healthError: string | null = null;
  private configProperties: ConfigProperty[] = [];
  private configError: string | null = null;
  private loadingHealth = true;
  private loadingConfig = true;
  private configFilter = '';

  constructor(appContext: AppContext) {
    super({
      title: 'System Health Check',
      maxWidth: 'max-w-3xl',
      maxHeight: 'max-h-[80vh]',
      iconSvg: Icon.render('check', { size: 20 })
    });
    this.appContext = appContext;
  }

  protected renderBody(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'health-check-body';
    container.className = 'flex flex-col';
    return container;
  }

  /** Renders the tab bar and the currently active panel. */
  private render(): void {
    const root = this.dialog.querySelector<HTMLElement>('#health-check-body');
    if (!root) return;

    root.innerHTML = `
      <div class="flex items-center gap-1 border-b border-app-border px-4 pt-3 bg-app-bg sticky top-0 z-10">
        ${this.renderTabButton('health', 'Health', 'check')}
        ${this.renderTabButton(
          'config',
          'System Properties',
          'settings',
          this.configProperties.length || undefined
        )}
      </div>
      <div class="p-4">${this.renderActivePanel()}</div>
    `;

    this.attachTabListeners();
    this.attachPanelListeners();
  }

  private renderTabButton(
    tab: HealthTab,
    label: string,
    icon: string,
    count?: number
  ): string {
    const active = this.activeTab === tab;
    const classes = active
      ? 'border-app-accent-2 text-app-accent-2'
      : 'border-transparent text-app-muted hover:text-app-text hover:border-app-border';
    const badge =
      count !== undefined
        ? `<span class="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            active
              ? 'bg-app-accent-2/15 text-app-accent-2'
              : 'bg-app-border text-app-muted'
          }">${count}</span>`
        : '';
    return `
      <button
        type="button"
        data-health-tab="${tab}"
        class="flex items-center gap-2 px-4 py-2 -mb-px border-b-2 text-sm font-semibold transition-colors cursor-pointer ${classes}"
      >
        ${Icon.render(icon, { size: 16 })}
        ${escapeHtml(label)}
        ${badge}
      </button>
    `;
  }

  private renderActivePanel(): string {
    return this.activeTab === 'health'
      ? this.renderHealthPanel()
      : this.renderConfigPanel();
  }

  // -------------------------------------------------------------------------
  // Health tab
  // -------------------------------------------------------------------------

  private renderHealthPanel(): string {
    if (this.loadingHealth) {
      return this.renderSpinner('Running health checks...');
    }
    if (this.healthError) {
      return `
        <div class="p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-500 text-sm">
          Failed to run health checks. ${escapeHtml(this.healthError)}
        </div>
      `;
    }
    const health = this.health;
    if (!health) return '';

    return `
      <div class="grid grid-cols-1 gap-4">
        ${this.renderHealthRow('MongoDB', health.mongodb)}
        ${this.renderHealthRow('Ollama', health.ollama)}
        ${this.renderHealthRow('Neovim Socket', health.nvim)}
        ${this.renderHealthRow('PI', health.pi)}
      </div>
    `;
  }

  private renderHealthRow(
    name: string,
    data: { status: string; details: string }
  ): string {
    const isOk = data.status === 'ok';
    const icon = isOk
      ? Icon.render('check', { size: 20, className: 'text-green-500 shrink-0' })
      : Icon.render('close', { size: 20, className: 'text-red-500 shrink-0' });
    const badge = isOk
      ? '<span class="text-[10px] font-bold uppercase tracking-wider text-green-500 bg-green-500/10 border border-green-500/30 rounded-full px-2 py-0.5">OK</span>'
      : '<span class="text-[10px] font-bold uppercase tracking-wider text-red-500 bg-red-500/10 border border-red-500/30 rounded-full px-2 py-0.5">Error</span>';

    return `
      <div class="flex flex-col border border-app-border rounded-lg p-4 bg-app-surface">
        <div class="flex items-center gap-3 mb-2">
          ${icon}
          <h4 class="font-bold text-app-text capitalize grow">${escapeHtml(name)}</h4>
          ${badge}
        </div>
        <div class="text-sm text-app-muted font-mono whitespace-pre-wrap break-all">${escapeHtml(data.details)}</div>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Configuration tab
  // -------------------------------------------------------------------------

  private renderConfigPanel(): string {
    if (this.loadingConfig) {
      return this.renderSpinner('Loading configuration...');
    }
    if (this.configError) {
      return `
        <div class="p-4 bg-red-500/10 border border-red-500/50 rounded-lg text-red-500 text-sm">
          Failed to load configuration. ${escapeHtml(this.configError)}
        </div>
      `;
    }

    const total = this.configProperties.length;
    const secretCount = this.configProperties.filter((p) => p.confidential).length;

    return `
      <div class="flex flex-col gap-3">
        <div class="flex items-start gap-2 rounded-lg border border-app-border bg-app-surface px-3 py-2">
          ${Icon.render('eyeOff', { size: 16, className: 'text-app-accent-2 mt-0.5 shrink-0' })}
          <p class="text-xs text-app-muted leading-relaxed">
            Read-only server configuration. Secret values are never transmitted –
            they are shown as <span class="font-semibold text-app-text">(stored)</span>
            or <span class="font-semibold text-app-text">(not available)</span> only.
            <span class="text-app-muted">${total} properties, ${secretCount} confidential.</span>
          </p>
        </div>
        <div class="relative">
          <span class="absolute inset-y-0 left-3 flex items-center text-app-muted pointer-events-none">
            ${Icon.render('search', { size: 16 })}
          </span>
          <input
            id="hc-config-filter"
            type="text"
            value="${escapeHtml(this.configFilter)}"
            placeholder="Filter properties..."
            class="w-full bg-app-bg border border-app-border rounded-lg pl-9 pr-3 py-2 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1"
          />
        </div>
        <div id="hc-config-list" class="flex flex-col gap-2">
          ${this.renderConfigList()}
        </div>
      </div>
    `;
  }

  private renderConfigList(): string {
    const filter = this.configFilter.trim().toLowerCase();
    const properties = filter
      ? this.configProperties.filter(
          (p) =>
            p.key.toLowerCase().includes(filter) ||
            p.value.toLowerCase().includes(filter)
        )
      : this.configProperties;

    if (properties.length === 0) {
      return `
        <div class="p-4 text-center text-sm text-app-muted border border-dashed border-app-border rounded-lg">
          ${this.configProperties.length === 0 ? 'No configuration properties available.' : 'No properties match the filter.'}
        </div>
      `;
    }

    return properties
      .map(
        (property) => `
        <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 rounded-lg border border-app-border bg-app-surface px-3 py-2 hover:border-app-accent-2/50 transition-colors">
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-mono text-xs font-semibold text-app-text break-all">${escapeHtml(property.key)}</span>
            ${
              property.confidential
                ? Icon.render('eyeOff', { size: 14, className: 'text-app-accent-2 shrink-0' })
                : ''
            }
            ${
              property.confidential
                ? '<span class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-app-accent-2 bg-app-accent-2/10 border border-app-accent-2/30 rounded-full px-2 py-0.5">secret</span>'
                : ''
            }
          </div>
          <div class="font-mono text-xs text-app-muted break-all sm:text-right sm:max-w-[55%] ${property.confidential ? 'italic' : ''}">
            ${escapeHtml(property.value)}
          </div>
        </div>
      `
      )
      .join('');
  }

  private renderSpinner(label: string): string {
    return `
      <div class="flex items-center justify-center p-8">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-app-accent-2"></div>
        <span class="ml-3 text-app-muted">${escapeHtml(label)}</span>
      </div>
    `;
  }

  // -------------------------------------------------------------------------
  // Events & data loading
  // -------------------------------------------------------------------------

  private attachTabListeners(): void {
    this.dialog
      .querySelectorAll<HTMLButtonElement>('[data-health-tab]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.healthTab as HealthTab | undefined;
          if (tab && tab !== this.activeTab) {
            this.activeTab = tab;
            this.render();
          }
        });
      });
  }

  private attachPanelListeners(): void {
    const filterInput = this.dialog.querySelector<HTMLInputElement>(
      '#hc-config-filter'
    );
    filterInput?.addEventListener('input', () => {
      this.configFilter = filterInput.value;
      const list = this.dialog.querySelector<HTMLElement>('#hc-config-list');
      if (list) list.innerHTML = this.renderConfigList();
    });
  }

  private async loadHealthCheck(): Promise<void> {
    this.loadingHealth = true;
    this.healthError = null;
    if (this.activeTab === 'health') this.render();
    try {
      this.health = await this.appContext.systemClient.getHealth();
    } catch (error) {
      this.health = null;
      this.healthError = String(error);
    } finally {
      this.loadingHealth = false;
      if (this.activeTab === 'health') this.render();
    }
  }

  private async loadConfiguration(): Promise<void> {
    this.loadingConfig = true;
    this.configError = null;
    if (this.activeTab === 'config') this.render();
    try {
      this.configProperties =
        await this.appContext.systemClient.getConfigProperties();
    } catch (error) {
      this.configProperties = [];
      this.configError = String(error);
    } finally {
      this.loadingConfig = false;
      if (this.activeTab === 'config') this.render();
    }
  }

  protected renderFooter(): string {
    return `
      <div class="p-4 border-t border-app-border bg-app-surface flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-wider text-app-muted">Read-only diagnostics</span>
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
      this.dialog
        .querySelector('#close-health-btn')
        ?.addEventListener('click', () => this.close());

      this.render();
      void this.loadHealthCheck();
      void this.loadConfiguration();
    }, 0);

    return showPromise;
  }
}
