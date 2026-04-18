/**
 * Copyright 2026 Marc Baechinger
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ActionRegistry } from './ActionRegistry';
import { Navigator } from './Navigator';
import { PipelineClient } from './clients/PipelineClient';
import { TaskClient } from './clients/TaskClient';
import { SystemClient } from './clients/SystemClient';
import { WebSocketClient } from './WebSocketClient';
import { AuthService } from './AuthService';
import { AssistantService } from './AssistantService';
import { SearchDialog } from '../ui/components/SearchDialog';
import { AssistantPanel } from '../ui/components/AssistantPanel';

export interface AppState {
  theme: 'light' | 'dark';
}

export class AppContext {
  public readonly actionRegistry: ActionRegistry;
  public readonly navigator: Navigator;
  public readonly pipelineClient: PipelineClient;
  public readonly taskClient: TaskClient;
  public readonly systemClient: SystemClient;
  public readonly wsClient: WebSocketClient;
  public readonly authService: AuthService;
  public readonly assistantService: AssistantService;
  private state: AppState;

  constructor(containerId: string, apiBaseUrl: string) {
    this.actionRegistry = new ActionRegistry();
    this.navigator = new Navigator(containerId);
    this.authService = new AuthService();
    this.pipelineClient = new PipelineClient(apiBaseUrl, this.authService);
    this.taskClient = new TaskClient(apiBaseUrl, this.authService);
    this.systemClient = new SystemClient(this.authService);
    this.wsClient = new WebSocketClient(apiBaseUrl, this.authService);
    this.assistantService = new AssistantService(this.wsClient, this.authService);
    
    // Initialize singleton components
    new AssistantPanel(this);
    
    const savedTheme = document.documentElement.getAttribute('data-theme') as 'light' | 'dark' | null;
    this.state = {
      theme: savedTheme || 'dark'
    };

    this.initGlobalActions();
    this.setupGlobalShortcuts();
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

    this.actionRegistry.register('open_search', (_e, el) => {
      if (this.authService.isAuthenticated()) {
        // Try to get pipelineId from element or URL hash
        let pipelineId = el.closest('[data-pipeline-id]')?.getAttribute('data-pipeline-id');
        
        if (!pipelineId) {
          const hash = window.location.hash;
          const match = hash.match(/#\/pipeline\/([a-f0-9]+)/);
          if (match) {
            pipelineId = match[1];
          }
        }
        
        new SearchDialog(this, pipelineId || undefined).show();
      }
    });

    this.actionRegistry.register('toggle_assistant', () => {
      if (this.authService.isAuthenticated()) {
        const event = new CustomEvent('toggle-assistant');
        window.dispatchEvent(event);
      }
    });
  }

  private setupGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+K or Cmd+K for search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.actionRegistry.execute('open_search', e, document.body);
      }
      
      // Ctrl+Alt+A or Cmd+Alt+A or Ctrl+Shift+A for assistant
      if ((e.ctrlKey || e.metaKey) && (e.altKey || e.shiftKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.actionRegistry.execute('toggle_assistant', e, document.body);
      }
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
