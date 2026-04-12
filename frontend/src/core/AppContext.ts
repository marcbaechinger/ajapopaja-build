import { ActionRegistry } from './ActionRegistry';
import { Navigator } from './Navigator';
import { PipelineClient } from './clients/PipelineClient';
import { TaskClient } from './clients/TaskClient';

export interface AppState {
  theme: 'light' | 'dark';
}

export class AppContext {
  public readonly actionRegistry: ActionRegistry;
  public readonly navigator: Navigator;
  public readonly pipelineClient: PipelineClient;
  public readonly taskClient: TaskClient;
  private state: AppState;

  constructor(containerId: string, apiBaseUrl: string) {
    this.actionRegistry = new ActionRegistry();
    this.navigator = new Navigator(containerId);
    this.pipelineClient = new PipelineClient(apiBaseUrl);
    this.taskClient = new TaskClient(apiBaseUrl);
    
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
  }

  getState(): AppState {
    return { ...this.state };
  }

  start() {
    this.navigator.start();
    console.log('Ajapopaja AppContext Started');
  }
}
