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
import { SearchDialog } from '../ui/components/dialogs/SearchDialog';
import { FileView } from '../ui/components/files/FileView';
import { AssistantPanel } from '../ui/components/session/AssistantPanel';
import { SessionManagerPanel, registerSessionGenerateTitleAction } from '../ui/components/session/SessionManagerPanel';
import { SessionManagerButton } from '../ui/components/session/SessionManagerButton';
import { HealthCheckDialog } from '../ui/components/dialogs/HealthCheckDialog';
import { handleQuickPromptButtonClick } from '../ui/components/common/QuickPromptButton';
import { wasThemeSetPickerEventHandled } from '../ui/components/common/ThemeSetPicker.ts';
import { setTaskSpecProposalUpdater } from '../ui/components/pipeline/SpecSection';
import { registerOnePromptHandlers } from './oneprompt';
import * as themeSets from '../ui/theme/themeSets.ts';

const { DEFAULT_THEME_SET, themeManager } = themeSets;
/** Prefer the registry's key, with a literal fallback for partial mocks. */
const THEME_SET_STORAGE_KEY =
  themeSets.THEME_SET_STORAGE_KEY ?? 'ajapopaja:theme-set';

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
    // Restore the persisted theme before anything else can read theme state.
    // The ThemeManager singleton also restores on import, but doing it here
    // keeps AppContext correct even if the manager was already constructed by
    // another import in the same page/session.
    this.restorePersistedTheme();

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

    // Re-derive the light/dark mode from the manager's applied document
    // attribute, then stay in sync with changes made through the manager.
    this.state = {
      theme: this.readActiveTheme()
    };
    themeManager.onSetChange(() => {
      this.state.theme = this.readActiveTheme();
    });

    this.initGlobalActions();
    this.setupGlobalShortcuts();
  }

  /**
   * Restore the persisted theme-set selection. A missing, corrupt or unknown
   * selection falls back to the default set; the manager itself applies the
   * persisted mode and writes the document attributes.
   */
  private restorePersistedTheme(): void {
    let persistedSetId: string | null = null;
    let persistedMode: 'light' | 'dark' | null = null;
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(THEME_SET_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            setId?: unknown;
            mode?: unknown;
          } | null;
          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.setId === 'string') persistedSetId = parsed.setId;
            if (parsed.mode === 'light' || parsed.mode === 'dark') {
              persistedMode = parsed.mode;
            }
          }
        }
      }
    } catch {
      // Corrupt or unavailable storage is treated as no persisted choice.
    }

    const registry = themeSets.THEME_SETS;
    const known =
      persistedSetId !== null &&
      !!registry &&
      Object.prototype.hasOwnProperty.call(registry, persistedSetId);
    themeManager.setSet(known ? persistedSetId! : DEFAULT_THEME_SET);

    // The manager usually restores the mode on import. Re-apply it explicitly
    // so a manager constructed before storage was populated still matches.
    if (persistedMode && this.readActiveTheme() !== persistedMode) {
      themeManager.setMode(persistedMode);
    }
  }

  /** The mode currently applied by the theme manager. */
  private readActiveTheme(): 'light' | 'dark' {
    return document.documentElement.getAttribute('data-theme') === 'light'
      ? 'light'
      : 'dark';
  }

  /** Resolve the set id carried by a picker/action element. */
  private static resolveThemeSetId(element: HTMLElement): string | null {
    const attributeId =
      element.getAttribute('data-theme-set-id') ??
      element.getAttribute('data-set-id') ??
      element.getAttribute('data-theme-set');
    if (attributeId) return attributeId;
    if (element instanceof HTMLSelectElement) return element.value || null;
    return null;
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
      // Light/dark is a mode switch within the active set; the manager owns
      // the document attributes and persistence.
      themeManager.setMode(this.state.theme === 'light' ? 'dark' : 'light');
    });

    this.actionRegistry.register('set_theme_set', (event, element) => {
      // The picker applies its own row selection directly (so it also works in
      // lightweight hosts); don't apply the same click twice via the registry.
      if (wasThemeSetPickerEventHandled(event)) return;
      const setId = AppContext.resolveThemeSetId(element);
      if (setId) themeManager.setSet(setId);
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
    void this.wsClient.connect();
    this.navigator.start();
    console.log('Ajapopaja AppContext Started');
  }
}
