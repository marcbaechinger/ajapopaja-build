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
import { DocBotClient } from './clients/DocBotClient';
import { ReviewBotClient } from './clients/ReviewBotClient';
import { ArchBotClient } from './clients/ArchBotClient';
import { SpecBotClient } from './clients/SpecBotClient';
import { CoderBotClient } from './clients/CoderBotClient';
import { PullRequestClient } from './clients/PullRequestClient';
import { EditorClient } from './clients/EditorClient';
import { FileBrowserClient } from './clients/FileBrowserClient';
import { WebSocketClient } from './WebSocketClient.ts';
import { DataManager } from './DataManager.ts';
import { AuthService } from './AuthService.ts';

import { AssistantService } from './AssistantService';
import { CoderBotService } from './CoderBotService.ts';
import { InteractiveCodingService } from './InteractiveCodingService.ts';
import { DevProcessService } from './DevProcessService.ts';
import { NotificationService } from './NotificationService.ts';
import { SearchDialog } from '../ui/components/SearchDialog';
import { FileView } from '../ui/components/FileView';
import { AssistantPanel } from '../ui/components/AssistantPanel';
import { SessionManagerPanel, registerSessionGenerateTitleAction } from '../ui/components/SessionManagerPanel';
import { SessionManagerButton } from '../ui/components/SessionManagerButton';
import { HealthCheckDialog } from '../ui/components/HealthCheckDialog';
import { handleQuickPromptButtonClick } from '../ui/components/QuickPromptButton';
import { setTaskSpecProposalUpdater } from '../ui/components/SpecSection';
import { registerOnePromptHandlers } from './oneprompt';

export interface AppState {
  theme: 'light' | 'dark';
}

export class AppContext {
  public readonly actionRegistry: ActionRegistry;
  public readonly navigator: Navigator;
  public readonly pipelineClient: PipelineClient;
  public readonly taskClient: TaskClient;
  public readonly systemClient: SystemClient;
  public readonly docBotClient: DocBotClient;
  public readonly reviewBotClient: ReviewBotClient;
  public readonly archBotClient: ArchBotClient;
  public readonly specBotClient: SpecBotClient;
  public readonly coderBotClient: CoderBotClient;
  public readonly pullRequestClient: PullRequestClient;
  public readonly editorClient: EditorClient;
  public readonly fileBrowserClient: FileBrowserClient;
  public readonly wsClient: WebSocketClient;
  public readonly dataManager: DataManager;
  public readonly authService: AuthService;
  public readonly assistantService: AssistantService;
  public readonly coderBotService: CoderBotService;
  public readonly interactiveCodingService: InteractiveCodingService;
  public readonly devProcessService: DevProcessService;
  public readonly notifications: NotificationService;
  public readonly sessionManagerPanel: SessionManagerPanel;
  private state: AppState;

  constructor(containerId: string, apiBaseUrl: string) {
    this.actionRegistry = new ActionRegistry();
    this.navigator = new Navigator(containerId);
    this.authService = new AuthService();
    this.pipelineClient = new PipelineClient(apiBaseUrl, this.authService);
    this.taskClient = new TaskClient(apiBaseUrl, this.authService);
    this.systemClient = new SystemClient(this.authService);
    this.docBotClient = new DocBotClient(apiBaseUrl, this.authService);
    this.reviewBotClient = new ReviewBotClient(apiBaseUrl, this.authService);
    this.archBotClient = new ArchBotClient(apiBaseUrl, this.authService);
    this.specBotClient = new SpecBotClient(apiBaseUrl, this.authService);
    this.coderBotClient = new CoderBotClient(this.authService);
    this.pullRequestClient = new PullRequestClient(this.authService);
    this.editorClient = new EditorClient(apiBaseUrl, this.authService);
    this.fileBrowserClient = new FileBrowserClient(apiBaseUrl, this.authService);
    this.wsClient = new WebSocketClient(apiBaseUrl, this.authService);
    this.dataManager = new DataManager(this.wsClient);
    this.assistantService = new AssistantService(this.wsClient, this.authService);
    this.coderBotService = new CoderBotService(this.wsClient, this.authService);
    this.interactiveCodingService = new InteractiveCodingService(
      this.wsClient,
      this.authService,
      this.coderBotClient
    );
    this.devProcessService = new DevProcessService(this.wsClient);
    this.notifications = new NotificationService(this.wsClient, this.authService);

    this.initOnePrompt();

    // Initialize singleton components
    new AssistantPanel(this);
    this.sessionManagerPanel = new SessionManagerPanel(this);
    this.setupSessionManager();
    
    const savedTheme = document.documentElement.getAttribute('data-theme') as 'light' | 'dark' | null;
    this.state = {
      theme: savedTheme || 'dark'
    };

    this.initGlobalActions();
    this.setupGlobalShortcuts();
  }

  /**
   * Registers the one-shot AI prompt framework (retained for session titles)
   * and the SpecAgent trigger dispatcher.
   */
  private initOnePrompt() {
    registerOnePromptHandlers(this.wsClient);

    // The "Open" action on a SpecAgent proposal notification navigates to the
    // owning pipeline, where the durable reconciliation re-surfaces the proposal.
    this.notifications.onActionResult((result) => {
      const target = result.result;
      if (
        result.action === 'specagent_open' &&
        result.status === 'ok' &&
        target &&
        typeof target === 'object' &&
        target.pipeline_id
      ) {
        window.location.hash = `#/pipeline/${target.pipeline_id}`;
      }
    });

    // Accepted SpecAgent proposals are written back onto the task spec through
    // the regular task update endpoint.
    setTaskSpecProposalUpdater(async (taskId, spec) => {
      const task = this.dataManager.getTask(taskId);
      const updated = await this.taskClient.updateDetails(taskId, task?.version ?? 1, { spec });
      this.dataManager.updateTask(updated);
    });

    registerSessionGenerateTitleAction(async (uid, title) => {
      await this.interactiveCodingService.renameSession(uid, title);
    });

    this.actionRegistry.register('quick_prompt', (_e, el) => {
      handleQuickPromptButtonClick(this.wsClient, el);
    });

    this.actionRegistry.register('trigger_specagent', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      const pipelineId =
        el.getAttribute('data-pipeline-id') ||
        el.closest('[data-pipeline-id]')?.getAttribute('data-pipeline-id');
      console.log('[SpecAgent] (0) action trigger_specagent (AppContext handler)', {
        taskId,
        pipelineId,
      });
      if (!taskId || !pipelineId) return;
      try {
        await this.specBotClient.trigger(pipelineId, taskId);
        console.log('[SpecAgent] (0) trigger request sent (AppContext handler)', { taskId });
      } catch (error) {
        console.error('[SpecAgent] (0) trigger failed (AppContext handler)', error);
        alert('Failed to trigger the specification bot');
      }
    });
  }

  private initGlobalActions() {
    // The diff/file views share a single "copy path" action so any file header
    // can write its repository-relative path to the clipboard.
    FileView.registerActions(this.actionRegistry);

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

    this.actionRegistry.register('toggle_session_manager', (_e, el) => {
      if (!this.authService.isAuthenticated()) return;
      // A button inside a pipeline header scopes the panel to that pipeline.
      const pipelineId =
        el.closest('[data-pipeline-id]')?.getAttribute('data-pipeline-id') ?? null;
      this.sessionManagerPanel.toggle(pipelineId || null);
    });

    this.actionRegistry.register('open_health_check', () => {
      if (this.authService.isAuthenticated()) {
        new HealthCheckDialog(this).show();
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

      // Ctrl+J or Cmd+J for the session manager.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        this.actionRegistry.execute('toggle_session_manager', e, document.body);
      }
    });
  }

  /**
   * Keep the header session buttons in sync with the service cache and kick off
   * the initial session discovery. The panel itself subscribes to the service;
   * this only updates the always-visible badge counters.
   */
  private setupSessionManager() {
    const updateButtons = () => {
      const sessions = this.interactiveCodingService.getSessions();
      const pausedCount = sessions.filter((s) =>
        s.status === 'paused' || s.status === 'completed' || s.status === 'failed'
      ).length;
      SessionManagerButton.updateAll(document, {
        pausedCount,
        busy: this.interactiveCodingService.isBusy(),
      });
    };

    this.interactiveCodingService.onSessionsChange(updateButtons);
    this.interactiveCodingService.onSessionChange(updateButtons);

    // Buttons are (re)rendered on every navigation; refresh them after the
    // view has mounted.
    window.addEventListener('hashchange', () => setTimeout(updateButtons, 0));
    window.addEventListener('toggle-session-manager', () =>
      this.sessionManagerPanel.toggle()
    );

    updateButtons();
    void this.interactiveCodingService.initialize().then(updateButtons).catch(() => {
      /* discovery is best-effort */
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
