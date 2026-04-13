import { ActionRegistry } from './ActionRegistry';
import { Navigator } from './Navigator';
import { PipelineClient } from './clients/PipelineClient';
import { TaskClient } from './clients/TaskClient';
import { WebSocketClient } from './WebSocketClient';
import { AuthService } from './AuthService';

export interface AppState {
  theme: 'light' | 'dark';
}

export class AppContext {
  public readonly actionRegistry: ActionRegistry;
  public readonly navigator: Navigator;
  public readonly pipelineClient: PipelineClient;
  public readonly taskClient: TaskClient;
  public readonly wsClient: WebSocketClient;
  public readonly authService: AuthService;
  private state: AppState;

  constructor(containerId: string, apiBaseUrl: string) {
    this.actionRegistry = new ActionRegistry();
    this.navigator = new Navigator(containerId);
    this.authService = new AuthService();
    this.pipelineClient = new PipelineClient(apiBaseUrl, this.authService);
    this.taskClient = new TaskClient(apiBaseUrl, this.authService);
    this.wsClient = new WebSocketClient(apiBaseUrl, this.authService);
    
    const savedTheme = document.documentElement.getAttribute('data-theme') as 'light' | 'dark' | null;
    this.state = {
      theme: savedTheme || 'dark'
    };

    this.initGlobalActions();
  }

  private initGlobalActions() {
    this.actionRegistry.register('toggle_theme', () => {
      const newTheme = this.state.theme === 'light' ? 'dark' : 'light';
      this.state.theme = newTheme;
      document.documentElement.setAttribute('data-theme', newTheme);
    });

    this.actionRegistry.register('perform_logout', async () => {
      await this.authService.logout();
      window.location.hash = '#/login';
    });
  }

  getState(): AppState {
    return { ...this.state };
  }

  start() {
    this.wsClient.connect();
    this.navigator.start();
    console.log('Ajapopaja AppContext Started');
  }
}
