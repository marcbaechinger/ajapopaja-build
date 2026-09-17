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

import { View } from '../../core/Navigator.ts';
import { AppContext } from '../../core/AppContext.ts';
import { Pipeline, TaskStatus, Task, type GitStatus } from '../../core/domain.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';
import { TaskItem } from '../components/TaskItem.ts';
import { HistoryItemView } from '../components/HistoryItemView.ts';
import { HistoryDialog } from '../components/HistoryDialog.ts';
import { StatsDialog } from '../components/StatsDialog.ts';
import { TaskForm } from '../components/TaskForm.ts';
import { DesignDocDialog } from '../components/DesignDocDialog.ts';
import { DesignDocDiffDialog } from '../components/DesignDocDiffDialog.ts';
import { BacklogView } from '../components/BacklogView.ts';
import { ExecutionEngineView } from '../components/ExecutionEngineView.ts';
import { PipelineHistoryView } from '../components/PipelineHistoryView.ts';
import { DocBotDialog } from '../components/DocBotDialog.ts';
import { PullRequestSection } from '../components/PullRequestSection.ts';
import type { DocBotDialogProps } from '../components/DocBotDialog.ts';
import { PipelineEditDialog } from '../components/PipelineEditDialog.ts';
import { ReviewDialog } from '../components/ReviewDialog.ts';
import { UpdateDesignDialog } from '../components/UpdateDesignDialog.ts';
import { PullRequestDialog } from '../components/PullRequestDialog.ts';
import { CoderBotDialog } from '../components/CoderBotDialog.ts';
import { PiView } from '../components/PiView.ts';
import { PipelineHeaderView, type DocbotState, type ReviewbotState, type CoderbotState } from '../components/PipelineHeaderView.ts';
import EasyMDE from 'easymde';
import { LocalStorageManager } from '../../core/LocalStorageManager.ts';

export class PipelineDetailView extends View {
  private storage = LocalStorageManager.getInstance('pipeline');
  private container: HTMLElement | null = null;
  private pipelineId: string;
  private pipeline: Pipeline | null = null;
  private context: AppContext;
  private unsubs: (() => void)[] = [];
  private activeEditors: Map<string, EasyMDE> = new Map();
  private allLoadedTasks: Task[] = [];
  private collapsedTasks: Set<string> = new Set();
  private collapsedSpecs: Set<string> = new Set();
  private isFirstLoad: boolean = true;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private gitStatus: GitStatus | undefined = undefined;
  private gitStatusRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private gitStatusRefreshInProgress: boolean = false;
  private gitStatusRefreshPending: boolean = false;
  private pendingReviews: string[] = [];
  private historyPage: number = 0;
  private selectedTask: Task | null = null;
  // When a task is created via the Quick Add panel, keep its Specification open in
  // edit mode (even across WS-driven re-renders) until the user saves, cancels, or
  // selects a different task.
  private pendingSpecEditTaskId: string | null = null;
  private enginePiView: PiView | null = null;
  private enginePiMountedKey: string | null = null;

  private loadPendingReviews() {
    this.pendingReviews = this.storage.get<string[]>(`pending_reviews:${this.pipelineId}`, []) || [];
  }

  private savePendingReviews() {
    this.storage.put(`pending_reviews:${this.pipelineId}`, this.pendingReviews);
  }

  private docbotState: DocbotState = {
    status: 'none',
    taskId: null,
  };

  private reviewbotState: ReviewbotState = {
    status: 'none',
    taskId: null,
  };

  private archbotState: { status: 'none' | 'inProgress', taskId: string | null } = {
    status: 'none',
    taskId: null,
  };

  private coderbotState: CoderbotState = {
    status: 'none',
    taskId: null,
  };

  private pullRequests: any[] = [];


  private columnMetadata: Record<string, { title: string, emptyMessage: string }> = {
    'inprogress': { title: 'In Progress', emptyMessage: 'No active work.' },
    'failed': { title: 'Failed', emptyMessage: '' },
    'scheduled': { title: 'Queue', emptyMessage: 'Nothing scheduled.' },
  };

  constructor(context: AppContext, params: Record<string, string>) {
    super();
    this.context = context;
    this.pipelineId = params.id;
    this.loadPendingReviews();
    this.registerActions();
    this.setupDataManagerSubscriptions();
    this.setupKeyboardShortcuts();
  }

  private getTaskColumnId(task: Task): string {
    switch (task.status) {
      case TaskStatus.PROPOSED: return 'proposed-list';
      case TaskStatus.CREATED: return 'backlog-list';
      case TaskStatus.INPROGRESS: return 'inprogress-list';
      case TaskStatus.FAILED: return 'failed-list';
      case TaskStatus.SCHEDULED: return 'scheduled-list';
      case TaskStatus.IMPLEMENTED:
      case TaskStatus.SUBMITTED:
      case TaskStatus.DISCARDED:
        return 'completed-task-list';
      default: return 'backlog-list';
    }
  }

  private updateColumnHeaderCount(columnId: string) {
    if (!this.container) return;
    const list = this.container.querySelector(`#${columnId}`);
    if (!list) return;

    const count = list.querySelectorAll('[data-view-id]').length;
    const section = list.closest('section');
    if (section) {
      const countEl = section.querySelector('h3 span:last-child');
      if (countEl) {
        countEl.textContent = `(${count})`;
      }
    }
  }

  private ensureEmptyMessage(columnId: string) {
    const list = this.container?.querySelector(`#${columnId}`);
    if (!list) return;
    if (list.children.length === 0) {
      const key = columnId.replace('-list', '');
      const meta = this.columnMetadata[key];
      if (meta && meta.emptyMessage) {
        list.innerHTML = `<p class="text-app-muted italic text-sm py-4 text-center border-2 border-dashed border-app-border/30 rounded-xl">${meta.emptyMessage}</p>`;
      }
    }
  }

  private removeEmptyMessage(columnId: string) {
    const list = this.container?.querySelector(`#${columnId}`);
    if (!list) return;
    const emptyMsg = list.querySelector('p.text-app-muted.italic');
    if (emptyMsg) {
      emptyMsg.remove();
    }
  }

  private setupKeyboardShortcuts() {
    this.keydownHandler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      // 'h' key for history dialog
      if (e.key === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        new HistoryDialog(this.allLoadedTasks).show();
      }

      // 's' key for stats dialog
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        new StatsDialog(this.allLoadedTasks, this.pipelineId, this.context.pipelineClient).show();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  private setupDataManagerSubscriptions() {
    const dm = this.context.dataManager;

    // Listen for pipeline metadata updates
    this.unsubs.push(dm.on(`pipeline:${this.pipelineId}`, (pipeline: Pipeline) => {
      this.pipeline = pipeline;
      this.updateHeader();
    }));

    // Listen for task updates (created, updated, moved, deleted)
    this.unsubs.push(dm.on(`pipeline:tasks:${this.pipelineId}`, (taskOrDeleted: any) => {
      if (!taskOrDeleted) return;

      if (taskOrDeleted.deleted) {
        this.removeTaskFromDOM(taskOrDeleted.id);
        this.allLoadedTasks = this.allLoadedTasks.filter(t => t.id !== taskOrDeleted.id);
        this.refreshBacklog();
        this.refreshSelectedTask();
        this.refreshExecutionEngine();
      } else {
        const task = taskOrDeleted as Task;
        this.updateSingleTask(task);
        if (task.status === TaskStatus.IMPLEMENTED) {
          this.scheduleRefreshGitStatus();
        }
      }
      this.updateHeader();
    }));

    // Listen for process and bot status updates via specific WS event queries
    const eventHandlers: Record<string, (payload: any) => void> = {
      'DOCBOT_STARTED': (p) => { this.docbotState = { status: 'inProgress', taskId: p.task_id }; },
      'DOCBOT_COMPLETED': (p) => {
        const result = p.result;
        if (result?.status === 'no_update_needed') {
          this.docbotState = { status: 'noUpdate', taskId: p.task_id, reason: result.reason };
        } else if (result?.status === 'update_needed') {
          if (this.docbotState.status !== 'ready') {
            this.fetchDocBotPreview(p.task_id);
          }
        } else if (this.docbotState.status !== 'ready') {
          this.docbotState = { status: 'none', taskId: null };
        }
      },
      'DOCBOT_PREVIEW_READY': (p) => { this.fetchDocBotPreview(p.task_id); },
      'REVIEWBOT_STARTED': (p) => { this.reviewbotState = { status: 'inProgress', taskId: p.task_id }; },
      'REVIEWBOT_COMPLETED': () => { this.reviewbotState = { status: 'none', taskId: null }; },
      'REVIEWBOT_REVIEW_READY': (p) => {
        this.reviewbotState = { status: 'none', taskId: null };
        const taskId = p.id || p._id || p.task_id;
        if (taskId && !this.pendingReviews.includes(taskId)) {
          this.pendingReviews.push(taskId);
          this.savePendingReviews();
        }
      },

      'ARCHBOT_STARTED': (p) => { this.archbotState = { status: 'inProgress', taskId: p.task_id }; },
      'ARCHBOT_COMPLETED': () => { this.archbotState = { status: 'none', taskId: null }; },
      'CODERBOT_STARTED': (p) => { this.coderbotState = { status: 'inProgress', taskId: p.task_id }; },
      'CODERBOT_COMPLETED': (p) => { this.coderbotState = { status: 'completed', taskId: p.task_id }; },
      // Insert a newly created PR precisely into its container instead of
      // re-running the full task refresh (which re-renders the whole prep column
      // and re-publishes every task, cascading UI re-renders page-wide).
      'PULL_REQUEST_CREATED': (p) => {
        this.refreshPullRequests();
        // The CoderBot also transitions the task IN_PROGRESS ->
        // PULL_REQUEST_AVAILABLE, but only broadcasts the PR event (no task-status
        // update). Detect it here and remove the task from the engine's In Progress
        // list in place so the sidebar stays accurate without a full re-render.
        this.removeTaskFromInProgressOnPullRequest(p?.task_id);
      },
    };

    Object.entries(eventHandlers).forEach(([event, handler]) => {
      this.unsubs.push(dm.on(`ws:${event}:${this.pipelineId}`, (payload) => {
        handler(payload);
        this.updateHeader();
      }));
    });
  }

  private docbotPreviewData: any = null;

  private async fetchPullRequests() {
    try {
      this.pullRequests = await this.context.pullRequestClient.getPullRequestsByPipeline(this.pipelineId);
      this.refreshTasks(); // PRs are rendered in the preparation column
    } catch (error) {
      console.error('Failed to fetch pull requests:', error);
    }
  }

  /**
   * Fetches the pull requests and refreshes only the dedicated pull-request
   * container in the preparation column. This avoids re-rendering the whole
   * prep column and, crucially, avoids re-publishing every task through the
   * DataManager (which would fire updateSingleTask per task and cascade into
   * full backlog/selection/engine re-renders). Used for the intrusive
   * PULL_REQUEST_CREATED websocket insert.
   */
  private async refreshPullRequests() {
    try {
      const prs = await this.context.pullRequestClient.getPullRequestsByPipeline(this.pipelineId);
      this.pullRequests = prs;
      const sectionEl = this.container?.querySelector('#pull-request-section');
      if (sectionEl) {
        sectionEl.innerHTML = PullRequestSection.render(this.pullRequests);
      }
    } catch (error) {
      console.error('Failed to fetch pull requests:', error);
    }
  }

  /**
   * When a CoderBot creates a pull request it also transitions the task
   * IN_PROGRESS -> PULL_REQUEST_AVAILABLE, but that status change is only
   * broadcast as a PULL_REQUEST_CREATED event (no task-status update flows
   * through the DataManager). Reflect it in the local cache and remove the task
   * from the ExecutionEngineView's In Progress list via a targeted, in-place DOM
   * removal so the rest of the sidebar (PiView mount, queue, history) is not
   * disturbed.
   */
  private removeTaskFromInProgressOnPullRequest(taskId?: string) {
    if (!taskId) return;
    const task = this.allLoadedTasks.find(t => t.id === taskId);
    if (!task) return;
    // Only act when the transition actually comes from IN_PROGRESS.
    if (task.status !== TaskStatus.INPROGRESS) return;

    task.status = TaskStatus.PULL_REQUEST_AVAILABLE;

    const engine = this.container?.querySelector('#execution-engine-view');
    if (engine) {
      ExecutionEngineView.removeInProgressItem(engine as HTMLElement, taskId);
    }
  }

  private async fetchDocBotPreview(taskId: string) {
    try {
      const response = await fetch(`/api/pipelines/${this.pipelineId}/docbot/preview/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${this.context.authService.getAccessToken()}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        this.docbotPreviewData = data;
        this.docbotState = {
          status: 'ready',
          taskId: data.task_id,
        };
        this.updateHeader();
      }
    } catch (error) {
      console.error('Failed to fetch DocBot preview:', error);
    }
  }

  private openDocBotDialog() {
    const dialogContainer = this.container?.querySelector('#docbot-dialog-container') as HTMLElement;
    if (!dialogContainer || !this.docbotState.taskId || !this.docbotPreviewData) return;

    const props: DocBotDialogProps = {
      taskId: this.docbotState.taskId,
      pipelineId: this.pipelineId,
      diff: this.docbotPreviewData.diff,
      commitMsg: this.docbotPreviewData.commit_msg,
      filename: this.docbotPreviewData.filename,
      context: this.context,
      onClose: () => {
        dialogContainer.innerHTML = '';
      },
      onSuccess: () => {
        this.docbotState = {
          status: 'none',
          taskId: null,
        };
        this.docbotPreviewData = null;
        this.updateHeader();
      }
    };

    new DocBotDialog(dialogContainer, props);
  }

  private openCoderBotDialog() {
    new CoderBotDialog(this.context.coderBotService).show();
  }

  private registerActions() {
    this.context.actionRegistry.register('edit_pipeline', async () => {
      if (!this.pipeline) return;
      const dialog = new PipelineEditDialog({
        mode: 'edit',
        pipeline: this.pipeline,
        pipelineId: this.pipelineId,
        context: this.context
      });
      await dialog.show();
      // After dialog closes, we might want to refresh the header if it was updated
      // The dialog itself calls update on the client, and we'll get a websocket update 
      // or we can refresh manually if needed.
    });

    this.context.actionRegistry.register('trigger_reviewbot', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;

      try {
        await this.context.reviewBotClient.trigger(this.pipelineId, taskId);

        this.reviewbotState = { status: 'inProgress', taskId };
        this.updateHeader();
      } catch (error) {
        console.error('Trigger ReviewBot error:', error);
        alert('Failed to trigger ReviewBot');
      }
    });

    this.context.actionRegistry.register('trigger_archbot', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;

      try {
        await this.context.archBotClient.trigger(this.pipelineId, taskId);
        this.archbotState = { status: 'inProgress', taskId };
        this.updateHeader();
      } catch (error) {
        console.error('Trigger ArchBot error:', error);
        alert('Failed to trigger ArchitectureBot');
      }
    });

    this.context.actionRegistry.register('update_design', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;

      const dialog = new UpdateDesignDialog();
      const comments = await dialog.show();
      if (!comments) return;

      try {
        await this.context.archBotClient.iterate(this.pipelineId, taskId, comments);
        this.archbotState = { status: 'inProgress', taskId };
        this.updateHeader();
      } catch (error) {
        console.error('Update Design error:', error);
        alert('Failed to update design document');
      }
    });

    this.context.actionRegistry.register('trigger_coderbot', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;

      try {
        await this.context.coderBotClient.triggerCoderBot(taskId);
        this.coderbotState = { status: 'inProgress', taskId };
        // Optimistically reflect the INPROGRESS status so the card moves to the
        // In Progress column immediately, even if the broadcast is delayed.
        const task = this.allLoadedTasks.find(t => t.id === taskId);
        if (task && task.status !== TaskStatus.INPROGRESS) {
          task.status = TaskStatus.INPROGRESS;
          this.context.dataManager.updateTask(task); // -> pipeline:tasks notify -> updateSingleTask
        }
        this.updateHeader();
        this.updateEnginePiSlot();
      } catch (error) {
        console.error('Trigger CoderBot error:', error);
        alert('Failed to trigger CoderBot');
      }
    });

    this.context.actionRegistry.register('open_review_dialog', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      if (!taskId) return;

      this.pendingReviews = this.pendingReviews.filter(id => id !== taskId);
      this.savePendingReviews();
      this.updateHeader();

      const task = this.allLoadedTasks.find(t => t.id === taskId);
      if (!task) return;

      const dialog = new ReviewDialog({
        task,
        pipelineId: this.pipelineId,
        context: this.context,
        onDelete: () => {
          // Task will be updated via websocket
        }
      });
      await dialog.show();
    });

    this.context.actionRegistry.register('open_pr_dialog', async (_e, el) => {
      const taskId = el.getAttribute('data-task-id');
      const prId = el.getAttribute('data-pr-id');
      if (!taskId) return;

      const dialog = new PullRequestDialog({
        taskId,
        prId: prId || undefined,
        pipelineId: this.pipelineId,
        context: this.context,
        onAccept: () => {
          this.fetchPullRequests();
        },
        onReject: () => {
          this.fetchPullRequests();
        }
      });
      await dialog.show();
    });

    this.context.actionRegistry.register('accept_pr', async (_e, el) => {
      const prId = el.getAttribute('data-pr-id');
      if (!prId) return;

      const confirmed = await new ConfirmationDialog(
        'Accept Pull Request',
        'This pull request will be applied and committed to the pipeline workspace. Continue?',
        'Accept & Apply'
      ).show();
      if (!confirmed) return;

      const btn = el as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Applying...';
      try {
        await this.context.pullRequestClient.acceptPullRequest(prId);
        this.fetchPullRequests();
      } catch (error: any) {
        console.error('Accept PR error:', error);
        alert(`Failed to accept Pull Request: ${error.message}`);
        btn.disabled = false;
        btn.textContent = 'Accept';
      }
    });

    this.context.actionRegistry.register('copy_pipeline_id', async (_e, el) => {
      try {
        await navigator.clipboard.writeText(this.pipelineId);
        const originalHtml = el.innerHTML;
        el.innerHTML = `<svg class="w-3 h-3 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
        setTimeout(() => {
          el.innerHTML = originalHtml;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy pipeline ID:', err);
      }
    });

    this.context.actionRegistry.register('copy_task_id', async (_e, el) => {
      const taskId = el.closest('[data-task-id]')?.getAttribute('data-task-id');
      if (!taskId) return;
      try {
        await navigator.clipboard.writeText(taskId);
        const originalHtml = el.innerHTML;
        el.innerHTML = `<svg class="w-3 h-3 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
        setTimeout(() => {
          el.innerHTML = originalHtml;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy task ID:', err);
      }
    });

    this.context.actionRegistry.register('open_coderbot_dialog', (e) => {
      e.preventDefault();
      this.openCoderBotDialog();
    });

    this.context.actionRegistry.register('dismiss_coderbot_banner', () => {
      this.coderbotState = { status: 'none', taskId: null };
      this.updateHeader();
    });

    this.context.actionRegistry.register('open_stats', () => {
      new StatsDialog(this.allLoadedTasks, this.pipelineId, this.context.pipelineClient).show();
    });

    this.context.actionRegistry.register('open_history', () => {
      new HistoryDialog(this.allLoadedTasks).show();
    });

    this.context.actionRegistry.register('create_task', async (_e, el) => {
      const form = el as HTMLFormElement;
      const titleInput = form.querySelector('input[name="task_title"]') as HTMLInputElement;
      const title = titleInput.value.trim();
      if (!title) return;

      try {
        const created = await this.context.taskClient.create(this.pipelineId, title);
        titleInput.value = '';

        // Make the newly created task the selected task so it is shown in the main
        // content area immediately. Add it to the local cache so the detail view can
        // render it even before the WebSocket TASK_CREATED notification arrives.
        this.selectedTask = created;
        const existingIndex = this.allLoadedTasks.findIndex(t => t.id === created.id);
        if (existingIndex === -1) {
          this.allLoadedTasks.push(created);
        } else {
          this.allLoadedTasks[existingIndex] = created;
        }
        this.pendingSpecEditTaskId = created.id ?? null;
        this.refreshBacklog();
        this.refreshSelectedTask();
      } catch (error) {
        alert('Failed to create task');
      }
    });

    this.context.actionRegistry.register('select_task', (_e, el) => {
      const taskId = (el.closest('[data-view-id]') as HTMLElement | null)?.getAttribute('data-view-id') || el.getAttribute('data-view-id') || el.getAttribute('data-task-id');
      if (!taskId) return;
      this.pendingSpecEditTaskId = null;
      this.selectedTask = this.allLoadedTasks.find(t => t.id === taskId) || null;
      this.refreshBacklog();
      this.refreshSelectedTask();
    });

    this.context.actionRegistry.register('prev_history_page', () => {
      this.setHistoryPage(this.historyPage - 1);
    });

    this.context.actionRegistry.register('next_history_page', () => {
      this.setHistoryPage(this.historyPage + 1);
    });

    this.context.actionRegistry.register('toggle_pr_summary', (_e, el) => {
      const body = el.closest('[data-pr-card]')?.querySelector('.pr-summary');
      const icon = el.querySelector('svg.transform');
      if (!body) return;
      const isHidden = body.classList.toggle('hidden');
      if (icon) icon.classList.toggle('rotate-90', !isHidden);
    });

    this.context.actionRegistry.register('toggle_task_collapse', (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      if (!taskId) return;

      const body = el.closest('[data-view-id]')?.querySelector('.task-body');
      const icon = el.querySelector('svg.transform');
      if (!body || !icon) return;

      const isHidden = body.classList.toggle('hidden');
      icon.classList.toggle('rotate-90', !isHidden);

      if (isHidden) this.collapsedTasks.add(taskId);
      else this.collapsedTasks.delete(taskId);
    });

    this.context.actionRegistry.register('edit_title', async (_e, el) => {
      const container = el.closest('.title-container') as HTMLElement;
      if (!container) return;
      container.querySelector('.title-view')?.classList.add('hidden');
      container.querySelector('.title-edit')?.classList.remove('hidden');
      const input = container.querySelector('input');
      input?.focus();
      input?.select();
    });

    this.context.actionRegistry.register('cancel_title_edit', async (_e, el) => {
      const container = el.closest('.title-container') as HTMLElement;
      if (!container) return;
      container.querySelector('.title-view')?.classList.remove('hidden');
      container.querySelector('.title-edit')?.classList.add('hidden');
    });

    this.context.actionRegistry.register('save_title', async (_e, el) => {
      const container = el.closest('.title-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      const version = parseInt(container.getAttribute('data-version') || '1');
      const input = container.querySelector('input');
      if (!taskId || !input) return;

      const newTitle = input.value.trim();
      if (!newTitle) return;

      // No-op when the title is unchanged: pressing Enter (or clicking Save)
      // without editing the text must not trigger an update. Saving anyway would
      // bump ``updated_at`` on the server, which surfaces as a task update where
      // ``prev.title === next.title`` and therefore falls through to a full
      // TaskItem re-render, discarding any unrelated unsaved edits (e.g. an
      // open Specification or Design Doc). Swallow the event so it does not
      // propagate further while still leaving no-op as intended.
      const currentTitle = container.querySelector<HTMLElement>('.title-view span.font-medium')?.textContent?.trim() ?? '';
      if (newTitle === currentTitle) {
        _e.preventDefault?.();
        _e.stopPropagation?.();
        return;
      }

      try {
        await this.context.taskClient.updateDetails(taskId, version, { title: newTitle });
        // After a successful save, leave title edit mode and move the cursor
        // into the Specification textarea so the user can keep describing the
        // task seamlessly.
        this.focusSpecAfterTitleSave(container);
        // WS will refresh
      } catch (error) {
        alert('Failed to save title');
      }
    });

    this.context.actionRegistry.register('edit_spec', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      container.querySelector('.spec-view')?.classList.add('hidden');
      container.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.add('hidden');
      container.querySelector('.spec-edit')?.classList.remove('hidden');
      const textarea = container.querySelector('textarea');
      textarea?.focus();
    });

    this.context.actionRegistry.register('cancel_spec_edit', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (taskId && this.pendingSpecEditTaskId === taskId) this.pendingSpecEditTaskId = null;
      container.querySelector('.spec-view')?.classList.remove('hidden');
      container.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.remove('hidden');
      container.querySelector('.spec-edit')?.classList.add('hidden');
    });

    this.context.actionRegistry.register('save_spec', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (taskId && this.pendingSpecEditTaskId === taskId) this.pendingSpecEditTaskId = null;
      const version = parseInt(container.getAttribute('data-version') || '1');
      const textarea = container.querySelector('textarea');
      const wantDesignCheck = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (!taskId || !textarea) return;

      const newSpec = textarea.value.trim();
      const wantDesignDoc = wantDesignCheck.checked;

      try {
        await this.context.taskClient.updateDetails(taskId, version, { spec: newSpec, want_design_doc: wantDesignDoc });
        // Keep the spec expanded after saving the changes.
        this.collapsedSpecs.delete(taskId);
        // WS will refresh
      } catch (error) {
        alert('Failed to save specification');
      }
    });

    this.context.actionRegistry.register('toggle_spec_expand', async (_e, el) => {
      const container = el.closest('.spec-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (!taskId) return;

      const display = container.querySelector('.spec-display');
      if (!display) return;

      const isExpanded = display.classList.toggle('expanded');
      el.textContent = isExpanded ? 'Show Less' : 'Show More';

      if (isExpanded) {
        this.collapsedSpecs.delete(taskId);
      } else {
        this.collapsedSpecs.add(taskId);
      }
    });

    this.context.actionRegistry.register('view_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (!taskId) return;
      const task = this.allLoadedTasks.find(t => t.id === taskId);
      if (task && task.design_doc) {
        new DesignDocDialog('Design Document', task.design_doc).show();
      }
    });

    this.context.actionRegistry.register('view_design_doc_history', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (!taskId) return;
      const task = this.allLoadedTasks.find(t => t.id === taskId);
      if (task) {
        new DesignDocDiffDialog(this.context, task).show();
      }
    });

    this.context.actionRegistry.register('edit_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;

      const taskId = container.getAttribute('data-task-id');
      const textarea = container.querySelector('textarea');
      if (!taskId || !textarea) return;

      container.querySelector('.design-doc-view')?.classList.add('hidden');
      container.querySelector('.design-doc-actions')?.classList.add('hidden');
      container.querySelector('.design-doc-edit')?.classList.remove('hidden');

      // Initialize EasyMDE
      const editor = new EasyMDE({
        element: textarea,
        spellChecker: false,
        status: false,
        minHeight: "150px",
        toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "code", "table", "|", "preview", "side-by-side", "fullscreen"],
        onFullScreen: (full: boolean) => {
          if (full) {
            container.classList.add('z-[100]');
            // Add a temporary backdrop
            const backdrop = document.createElement('div');
            backdrop.id = 'editor-backdrop';
            backdrop.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[90]';
            document.body.appendChild(backdrop);
          } else {
            container.classList.remove('z-[100]');
            document.getElementById('editor-backdrop')?.remove();
          }
        }
      } as any);

      this.activeEditors.set(taskId, editor);
      editor.codemirror.focus();
    });

    this.context.actionRegistry.register('toggle_edit_design_doc_expand', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;

      const cm = container.querySelector('.CodeMirror');
      if (!cm) return;

      const isExpanded = cm.classList.toggle('expanded-editor');
      el.textContent = isExpanded ? 'Show Less' : 'Show More';
    });

    this.context.actionRegistry.register('toggle_design_doc_expand', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;

      const display = container.querySelector('.design-doc-display');
      if (!display) return;

      const isExpanded = display.classList.toggle('expanded');
      el.textContent = isExpanded ? 'Show Less' : 'Show More';
    });

    this.context.actionRegistry.register('copy_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;
      const taskId = container.getAttribute('data-task-id');
      if (!taskId) return;
      const task = this.allLoadedTasks.find(t => t.id === taskId);
      if (task && task.design_doc) {
        try {
          await navigator.clipboard.writeText(task.design_doc);
          const originalText = el.innerHTML;
          el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
          setTimeout(() => {
            el.innerHTML = originalText;
          }, 2000);
        } catch (err) {
          console.error('Failed to copy text: ', err);
        }
      }
    });

    this.context.actionRegistry.register('cancel_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;

      const taskId = container.getAttribute('data-task-id');
      if (taskId) {
        const editor = this.activeEditors.get(taskId);
        if (editor) {
          editor.toTextArea();
          this.activeEditors.delete(taskId);
        }
      }

      container.querySelector('.design-doc-view')?.classList.remove('hidden');
      container.querySelector('.design-doc-actions')?.classList.remove('hidden');
      const editToggle = container.querySelector('[data-action-click="toggle_edit_design_doc_expand"]');
      if (editToggle) {
        editToggle.classList.remove('hidden');
        editToggle.textContent = 'Show More';
      }
      container.querySelector('.design-doc-edit')?.classList.add('hidden');
    });

    this.context.actionRegistry.register('save_design_doc', async (_e, el) => {
      const container = el.closest('.design-doc-container') as HTMLElement;
      if (!container) return;

      const taskId = container.getAttribute('data-task-id');
      const version = parseInt(container.getAttribute('data-version') || '1');
      if (!taskId) return;

      const editor = this.activeEditors.get(taskId);
      if (!editor) return;

      const designDoc = editor.value().trim();

      try {
        await this.context.taskClient.updateDetails(taskId, version, { design_doc: designDoc });
        // After success, destroy editor
        editor.toTextArea();
        this.activeEditors.delete(taskId);
        // UI refresh will be triggered by WebSocket message TASK_UPDATED
      } catch (error) {
        alert('Failed to save design doc. Please try again.');
      }
    });

    this.context.actionRegistry.register('accept_design', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      try {
        await this.context.taskClient.acceptDesign(taskId, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to accept design');
      }
    });

    this.context.actionRegistry.register('reject_design', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      const confirmed = await new ConfirmationDialog(
        'Reject Design',
        'Are you sure you want to reject this design? This task will be marked as DISCARDED.',
        'Reject'
      ).show();

      if (!confirmed) return;

      try {
        await this.context.taskClient.rejectDesign(taskId, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to reject design');
      }
    });

    this.context.actionRegistry.register('schedule_task', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateStatus(taskId, TaskStatus.SCHEDULED, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to schedule task');
      }
    });

    this.context.actionRegistry.register('unschedule_task', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateStatus(taskId, TaskStatus.CREATED, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to unschedule task');
      }
    });

    this.context.actionRegistry.register('cancel_progress', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateStatus(taskId, TaskStatus.SCHEDULED, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to cancel progress');
      }
    });

    this.context.actionRegistry.register('move_task_up', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      const currentOrder = parseInt(el.getAttribute('data-order') || '0');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateDetails(taskId, version, { order: currentOrder - 1 });
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to move task');
      }
    });

    this.context.actionRegistry.register('move_task_down', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      const currentOrder = parseInt(el.getAttribute('data-order') || '0');
      if (!taskId) return;

      try {
        await this.context.taskClient.updateDetails(taskId, version, { order: currentOrder + 1 });
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to move task');
      }
    });

    this.context.actionRegistry.register('update_task_order', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id') || el.getAttribute('data-task-id');
      const version = parseInt(el.getAttribute('data-version') || el.closest('[data-view-id]')?.getAttribute('data-version') || '1');
      const input = el as HTMLInputElement;
      const newOrder = parseInt(input.value, 10);
      if (!taskId || Number.isNaN(newOrder)) return;

      try {
        await this.context.taskClient.updateDetails(taskId, version, { order: newOrder });
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to update order');
      }
    });

    this.context.actionRegistry.register('fail_task', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      const version = parseInt(el.getAttribute('data-version') || '1');
      if (!taskId) return;

      const confirmed = await new ConfirmationDialog(
        'Mark Task as Failed',
        'Are you sure you want to mark this task as FAILED? This may trigger an automated fix sequence.',
        'Mark Failed'
      ).show();

      if (!confirmed) return;

      try {
        await this.context.taskClient.updateStatus(taskId, TaskStatus.FAILED, version);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to update task');
      }
    });

    this.context.actionRegistry.register('delete_task', async (_e, el) => {
      const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      if (!taskId) return;

      const confirmed = await new ConfirmationDialog(
        'Delete Task',
        'Are you sure you want to delete this task? This action cannot be undone.',
        'Delete'
      ).show();

      if (!confirmed) return;

      try {
        await this.context.taskClient.delete(taskId);
        // Refresh handled by WS
      } catch (error) {
        alert('Failed to delete task');
      }
    });

    this.context.actionRegistry.register('trigger_docbot', async (_e, el) => {
      const taskId = el.dataset.taskId;
      if (!taskId) return;

      const btn = el as HTMLElement;
      btn.classList.add('animate-pulse', 'text-green-500');

      try {
        await this.context.docBotClient.triggerDocBot(this.pipelineId, taskId);
        // Remove pulse after a short delay
        setTimeout(() => btn.classList.remove('animate-pulse', 'text-green-500'), 1000);
      } catch (err) {
        console.error('Failed to trigger DocBot:', err);
        btn.classList.remove('animate-pulse', 'text-green-500');
        btn.classList.add('text-red-500');
        setTimeout(() => btn.classList.remove('text-red-500'), 2000);
      }
    });

    this.context.actionRegistry.register('open_quickfix', async (_e, el) => {
      const taskId = el.dataset.taskId;
      if (!taskId) return;

      const btn = el as HTMLElement;
      btn.classList.add('animate-pulse', 'text-app-accent-2');

      try {
        await this.context.editorClient.quickfix(taskId);
        setTimeout(() => btn.classList.remove('animate-pulse', 'text-app-accent-2'), 1000);
      } catch (err) {
        console.error('Failed to open quickfix:', err);
        btn.classList.remove('animate-pulse', 'text-app-accent-2');
        btn.classList.add('text-red-500');
        setTimeout(() => btn.classList.remove('text-red-500'), 2000);
      }
    });

    this.context.actionRegistry.register('open_diff_view', async (_e, el) => {
      const commitHash = el.dataset.commitHash;
      if (!commitHash) return;

      const btn = el as HTMLElement;
      btn.classList.add('animate-pulse', 'text-app-accent-2');

      try {
        await this.context.editorClient.diffViewOpen(this.pipelineId, commitHash);
        setTimeout(() => btn.classList.remove('animate-pulse', 'text-app-accent-2'), 1000);
      } catch (err) {
        console.error('Failed to open diff view:', err);
        btn.classList.remove('animate-pulse', 'text-app-accent-2');
        btn.classList.add('text-red-500');
        setTimeout(() => btn.classList.remove('text-red-500'), 2000);
      }
    });
    this.context.actionRegistry.register('open_docbot_dialog', () => {
      this.openDocBotDialog();
    });

    this.context.actionRegistry.register('dismiss_docbot_banner', () => {
      this.docbotState = { status: 'none', taskId: null };
      this.docbotPreviewData = null;
      this.updateHeader();
    });

    this.context.actionRegistry.register('refresh_git_status', async (_e, el) => {
      const btn = el as HTMLElement;
      btn.classList.add('animate-pulse', 'border-app-accent-2');
      try {
        this.scheduleRefreshGitStatus();
      } finally {
        setTimeout(() => btn.classList.remove('animate-pulse', 'border-app-accent-2'), 500);
      }
    });
  }

  async loadPipeline() {
    try {
      this.pipeline = await this.context.pipelineClient.get(this.pipelineId);
      if (this.pipeline) {
        this.context.dataManager.updatePipeline(this.pipeline);
      }
      this.fetchPullRequests();
      this.scheduleRefreshGitStatus();
      this.updateHeader();
    } catch (error) {
      console.error('Error loading pipeline:', error);
    }
  }

  private scheduleRefreshGitStatus() {
    if (this.gitStatusRefreshInProgress) {
      this.gitStatusRefreshPending = true;
      return;
    }
    if (this.gitStatusRefreshTimer) {
      return; // Already scheduled
    }
    this.gitStatusRefreshTimer = setTimeout(() => {
      this.gitStatusRefreshTimer = null;
      this.refreshGitStatusInternal();
    }, 500);
  }

  private async refreshGitStatusInternal() {
    this.gitStatusRefreshInProgress = true;
    try {
      this.gitStatus = await this.context.systemClient.getGitStatus(this.pipelineId);
      this.updateHeader();
    } catch (error) {
      console.error('Failed to refresh git status:', error);
    } finally {
      this.gitStatusRefreshInProgress = false;
      if (this.gitStatusRefreshPending) {
        this.gitStatusRefreshPending = false;
        this.scheduleRefreshGitStatus();
      }
    }
  }

  async refreshTasks() {
    if (!this.container) return;
    const prepContainer = this.container.querySelector('#col-prep');
    const completedCountEl = this.container.querySelector('#completed-count');

    if (!prepContainer) return;

    try {
      this.allLoadedTasks = await this.context.taskClient.listByPipeline(this.pipelineId, true);

      // Update DataManager cache
      this.allLoadedTasks.forEach(task => this.context.dataManager.updateTask(task));

      this.updateHeader();
      const allTasks = this.allLoadedTasks;

      // Handle default task collapsing on first load
      if (this.isFirstLoad && allTasks.length > 0) {
        allTasks.forEach(t => {
          if (t.status !== TaskStatus.INPROGRESS && t.status !== TaskStatus.PROPOSED) {
            this.collapsedTasks.add(t.id!);
          }
        });
        this.isFirstLoad = false;
      }

      const completedTasks = allTasks.filter(t => !t.deleted && ([TaskStatus.IMPLEMENTED, TaskStatus.SUBMITTED, TaskStatus.DISCARDED] as any[]).includes(t.status));

      // 1. Render Preparation Column (the main area keeps the PullRequest section only).
      //    It is wrapped in a dedicated #pull-request-section container so a
      //    PULL_REQUEST_CREATED event can update this section in place without
      //    re-rendering any other part of the UI.
      prepContainer.innerHTML = `
        <div id="pull-request-section">
          ${PullRequestSection.render(this.pullRequests)}
        </div>
      `;

      // Completed count (retained only if the element exists).
      if (completedCountEl) {
        completedCountEl.textContent = `(${completedTasks.length})`;
      }

      this.refreshBacklog();
      this.refreshSelectedTask();
      this.refreshExecutionEngine();
    } catch (error) {
      prepContainer.innerHTML = '<p class="text-red-400">Error loading tasks.</p>';
      console.error('Error refreshing tasks:', error);
    }
  }

  private setHistoryPage(page: number) {
    if (!this.container) return;
    this.historyPage = page;

    // PipelineHistoryView moved into the right sidebar at the bottom; re-render
    // only its feed so the engine sections / CoderBot slot stay untouched.
    const feed = this.container.querySelector('#history-feed');
    if (!feed) return;

    const completedTasks = this.allLoadedTasks
      .filter(t => !t.deleted && ([TaskStatus.IMPLEMENTED, TaskStatus.SUBMITTED, TaskStatus.DISCARDED] as any[]).includes(t.status));
    // Sort completed tasks by completion time (updated_at)
    completedTasks.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

    feed.innerHTML = PipelineHistoryView.render(completedTasks, page);
  }

  private updateHeader() {
    if (!this.container) return;
    const headerContainer = this.container.querySelector('#pipeline-header-container');
    if (headerContainer) {
      headerContainer.innerHTML = this.renderHeader();
    }
  }

  private renderHeader(): string {
    if (!this.pipeline) {
      return `
        <header class="flex justify-between items-center bg-app-surface px-4 py-2 border-b border-app-border shrink-0">
          <div class="flex gap-4 items-center">
            <button onclick="window.location.hash = '#'" class="p-2 hover:bg-app-bg rounded-xl transition-all text-app-muted hover:text-app-accent-1 border border-transparent hover:border-app-border group cursor-pointer" title="Back to Dashboard">
              <svg class="w-5 h-5 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
              </svg>
            </button>
            <div class="min-w-[400px]">
              <h2 class="text-2xl font-black text-app-accent-1 tracking-tight">Loading...</h2>
            </div>
          </div>
        </header>
      `;
    }
    return PipelineHeaderView.render({
      pipeline: this.pipeline,
      pipelineId: this.pipelineId,
      docbotState: this.docbotState,
      reviewbotState: this.reviewbotState,
      archbotState: this.archbotState,
      coderbotState: this.coderbotState,
      user: this.context.authService.getUser(),
      allTasks: this.allLoadedTasks,
      gitStatus: this.gitStatus,
      pendingReviews: this.pendingReviews
    });


  }

  private renderPrepColumn(): string {
    return `
      <div class="flex flex-col gap-8 min-w-0 lg:min-w-[350px]">
        <div class="bg-app-surface/30 p-6 rounded-3xl border border-app-border/30 flex flex-col">
          ${TaskForm.render()}
          <div id="selected-task-view" class="mt-6">
            <p class="text-app-muted/60 text-xs italic text-center border border-dashed border-app-border/40 rounded-xl py-6 px-3">Select a task from the backlog to open it here.</p>
          </div>
          <div id="col-prep" class="space-y-10 mt-6">
            <p class="text-app-muted animate-pulse text-center py-10">Loading backlog...</p>
          </div>
        </div>
      </div>
    `;
  }



  render() {
    return `
      <div class="h-screen flex flex-col overflow-hidden bg-app-bg">
        <div id="pipeline-header-container" class="flex-none shrink-0 border-b border-app-border/60">
          ${this.renderHeader()}
        </div>

        <div class="flex flex-1 min-h-0">
          <!-- Left Sidebar: BacklogView -->
          <aside class="w-96 flex-none shrink-0 border-r border-app-border/60 bg-app-surface/30 overflow-y-auto">
            <div id="backlog-view" class="min-h-full">
              <p class="text-app-muted/40 text-[10px] uppercase font-bold tracking-widest text-center py-6">Loading backlog...</p>
            </div>
          </aside>

          <!-- Main Content Area (Preparation / PullRequests only; history moved to sidebar) -->
          <main class="flex-[2] min-w-0 overflow-y-auto">
            <div class="w-full p-4">
              ${this.renderPrepColumn()}
            </div>
          </main>

          <!-- Right Sidebar: ExecutionEngineView + PipelineHistoryView (bottom) -->
          <aside class="flex-1 min-w-0 shrink-0 border-l border-app-border/60 bg-app-surface/30 flex flex-col overflow-hidden">
            <div id="execution-engine-view" class="flex-1 min-h-0 flex flex-col overflow-hidden">
              <p class="text-app-muted/40 text-[10px] uppercase font-bold tracking-widest text-center py-6">Loading execution engine...</p>
            </div>
          </aside>
        </div>
      </div>
      <div id="docbot-dialog-container"></div>
    `;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.loadPipeline();
    this.refreshTasks();
    this.checkOllama();

    // React to app-wide CoderBot session changes so the engine Pi slot stays
    // correct (mount for this pipeline, notice for another pipeline).
    const cb = () => this.updateEnginePiSlot();
    const unsub = this.context.coderBotService?.onSessionChange?.(cb);
    if (unsub) this.unsubs.push(unsub);

    // Reconnect a running CoderBot session to this view (e.g. after a reload).
    this.refreshEnginePiSlot();
  }

  private async checkOllama() {
    if (!this.container) return;
    const isAvailable = await this.context.systemClient.isOllamaAvailable();
    if (!isAvailable) {
      this.container.querySelector('[data-action-click="toggle_assistant"]')?.classList.add('hidden');
    }
  }

  unmount() {
    this.activeEditors.forEach(editor => editor.toTextArea());
    this.activeEditors.clear();
    if (this.enginePiView) {
      this.enginePiView.destroy();
      this.enginePiView = null;
    }
    this.unsubs.forEach(unsub => unsub());
    this.unsubs = [];
    this.pendingSpecEditTaskId = null;
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private insertTaskIntoDOM(task: Task) {
    if (!this.container) return;
    const columnId = this.getTaskColumnId(task);
    const list = this.container.querySelector(`#${columnId}`);
    if (!list) return;

    this.removeEmptyMessage(columnId);

    const isHistoryColumn = columnId === 'completed-task-list';
    const taskHtml = isHistoryColumn
      ? HistoryItemView.render(task)
      : TaskItem.render(
          task,
          columnId === 'backlog-list' || columnId === 'scheduled-list',
          false,
          this.collapsedTasks.has(task.id!),
          false,
          !this.collapsedSpecs.has(task.id!)
        );
    const temp = document.createElement('div');
    temp.innerHTML = taskHtml;
    const taskEl = temp.firstElementChild as HTMLElement;

    // Don't insert a duplicate if the task is already in this list (defensive
    // against a WebSocket update arriving more than once). Replace in place.
    const existing = list.querySelector(`[data-view-id="${task.id}"]`);
    if (existing) {
      existing.replaceWith(taskEl);
    } else {
      list.prepend(taskEl);
    }
    this.updateColumnHeaderCount(columnId);
  }

  private removeTaskFromDOM(taskId: string) {
    const el = this.container?.querySelector(`[data-view-id="${taskId}"]`);
    if (el) {
      const columnId = el.parentElement?.id;
      el.remove();
      if (columnId) {
        this.updateColumnHeaderCount(columnId);
        this.ensureEmptyMessage(columnId);
      }
    }
  }

  private findTaskElementInColumns(taskId: string): { columnId: string; el: HTMLElement } | null {
    const columnIds = ['inprogress-list', 'failed-list', 'scheduled-list', 'backlog-list', 'proposed-list', 'completed-task-list'];
    for (const columnId of columnIds) {
      const list = this.container?.querySelector(`#${columnId}`);
      const el = list?.querySelector(`[data-view-id="${taskId}"]`) as HTMLElement | null;
      if (el) return { columnId, el };
    }
    return null;
  }

  private removeTaskFromColumns(taskId: string) {
    const columnIds = ['inprogress-list', 'failed-list', 'scheduled-list', 'backlog-list', 'proposed-list', 'completed-task-list'];
    for (const columnId of columnIds) {
      const list = this.container?.querySelector(`#${columnId}`);
      const el = list?.querySelector(`[data-view-id="${taskId}"]`) as HTMLElement | null;
      if (el) {
        el.remove();
        this.updateColumnHeaderCount(columnId);
        this.ensureEmptyMessage(columnId);
      }
    }
  }

  /**
   * Returns whether an incoming task update is a pure title change (i.e. every
   * field other than title / version / updated_at is unchanged), so callers can
   * avoid re-rendering the whole view and preserve unrelated unsaved edits.
   */
  private isTitleOnlyChange(prev: Task, next: Task): boolean {
    if (prev.title === next.title) {
      return false;
    }
    const comparable = (t: Task) => {
      const { title, version, updated_at, ...rest } = t as any;
      return rest;
    };
    const onlyTitle = JSON.stringify(comparable(prev)) === JSON.stringify(comparable(next));
    return onlyTitle;
  }

  /**
   * Updates only the title-related DOM for a task in place across every
   * rendered instance (TaskItem, backlog / engine sidebar rows, history feed),
   * skipping the heavy full-view refreshes that would discard unrelated edits.
   */
  private updateTitleOnly(task: Task) {
    const taskId = task.id ?? '';
    if (!taskId || !this.container) return;

    if (this.selectedTask?.id === taskId) {
      this.selectedTask = task;
    }

    // Full TaskItem cards (e.g. the selected task view): switch the edit form
    // back to the rendered title and refresh the version, without a re-render.
    this.container
      .querySelectorAll<HTMLElement>(`[data-view-id="${taskId}"]`)
      .forEach((el) => TaskItem.updateTitleInPlace(el, task));

    // Compact sidebar/history rows (BacklogTaskView, ExecutionEngineItemView,
    // HistoryItemView): refresh the rendered title text and optimistic-concurrency
    // version in place so later saves use the current version.
    const version = task.version ?? 1;
    this.container
      .querySelectorAll<HTMLElement>(`[data-task-id="${taskId}"]`)
      .forEach((el) => {
        const titleEl = el.querySelector<HTMLElement>('span.font-bold.text-app-text, span.font-medium.text-app-text');
        if (titleEl) titleEl.textContent = task.title;
        el.querySelectorAll<HTMLElement>('[data-version]').forEach(v => {
          v.setAttribute('data-version', String(version));
        });
      });
  }

  private updateSingleTask(task: Task) {
    const taskId = task.id ?? '';
    if (!taskId) return;

    // Update local cache, capturing the previous state so we can detect a
    // title-only change (which must not trigger a full re-render).
    const index = this.allLoadedTasks.findIndex(t => t.id === taskId);
    const prev = index !== -1 ? this.allLoadedTasks[index] : null;
    if (index !== -1) {
      this.allLoadedTasks[index] = task;
    } else {
      this.allLoadedTasks.push(task);
    }
    this.updateHeader();

    // A title-only update must not re-render the TaskItem / views, otherwise
    // unrelated unsaved text edits (e.g. an open Specification editor) get
    // wiped. Update just the title DOM in place instead.
    if (prev) {
      const onlyTitle = this.isTitleOnlyChange(prev, task);
      if (onlyTitle) {
        this.updateTitleOnly(task);
        return;
      }
    }

    const targetColumnId = this.getTaskColumnId(task);
    const loc = this.findTaskElementInColumns(taskId);

    const isHistoryColumn = targetColumnId === 'completed-task-list';

    if (loc && loc.columnId === targetColumnId) {
      // Same column: replace the content in place (keeps DOM position, avoids flicker)
      const taskHtml = isHistoryColumn
        ? HistoryItemView.render(task)
        : TaskItem.render(
            task,
            targetColumnId === 'backlog-list' || targetColumnId === 'scheduled-list',
            false,
            this.collapsedTasks.has(taskId),
            false,
            !this.collapsedSpecs.has(taskId)
          );
      const temp = document.createElement('div');
      temp.innerHTML = taskHtml;
      loc.el.replaceWith(temp.firstElementChild as HTMLElement);
    } else {
      // Column changed (or the task is not in a column yet): remove any copies from
      // the columns, then insert the task into the correct one. Removing from all
      // columns (rather than a single best-effort match) prevents stale rows when
      // the same data-view-id also appears in the sidebar or the selected TaskView.
      this.removeTaskFromColumns(taskId);
      this.insertTaskIntoDOM(task);
    }

    this.refreshBacklog();
    this.refreshSelectedTask();
    this.refreshExecutionEngine();
  }

  private refreshSelectedTask() {
    if (!this.container) return;
    const viewEl = this.container.querySelector('#selected-task-view');
    if (!viewEl) return;

    const hint = `<p class="text-app-muted/60 text-xs italic text-center border border-dashed border-app-border/40 rounded-xl py-6 px-3">Select a task from the backlog to open it here.</p>`;

    if (!this.selectedTask) {
      viewEl.innerHTML = hint;
      return;
    }

    // Re-derive from the freshest cache so status edits are reflected immediately.
    const fresh = this.allLoadedTasks.find(t => t.id === this.selectedTask!.id);
    if (!fresh || fresh.deleted) {
      this.selectedTask = null;
      viewEl.innerHTML = hint;
      return;
    }

    this.selectedTask = fresh;
    viewEl.innerHTML = TaskItem.render(fresh, false, false, false, false, !this.collapsedSpecs.has(fresh.id!));

    // Keep the Specification in edit mode for a newly created task even if a
    // WebSocket re-render happens right after creation.
    if (this.pendingSpecEditTaskId && fresh.id === this.pendingSpecEditTaskId) {
      this.enterSpecEditMode();
    }
  }

  /**
   * Transitions the just-saved title from edit mode back to view mode and then
   * focuses the task's Specification textarea (opening it for editing) so the
   * user can continue seamlessly by specifying the task, without the previous
   * collapse/expand action interfering.
   */
  private focusSpecAfterTitleSave(titleContainer: HTMLElement) {
    if (!this.container) return;

    // 1) Switch the title edit form back to the rendered title view.
    titleContainer.querySelector('.title-edit')?.classList.add('hidden');
    titleContainer.querySelector('.title-view')?.classList.remove('hidden');

    // 2) Locate the task card owning this title and open its Specification.
    const taskId = titleContainer.closest('[data-view-id]')?.getAttribute('data-view-id');
    if (!taskId) return;
    const taskEl = this.container.querySelector(`[data-view-id="${taskId}"]`) as HTMLElement | null;
    if (!taskEl) return;
    const specContainer = taskEl.querySelector('.spec-container') as HTMLElement | null;
    if (!specContainer) return;

    specContainer.querySelector('.spec-view')?.classList.add('hidden');
    specContainer.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.add('hidden');
    specContainer.querySelector('.spec-edit')?.classList.remove('hidden');
    const textarea = specContainer.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) textarea.focus();
  }

  /**
   * Switches the selected task's Specification section into edit mode and moves
   * the cursor into the textarea so the user can keep writing the spec in one flow.
   */
  private enterSpecEditMode() {
    if (!this.container) return;
    const viewEl = this.container.querySelector('#selected-task-view');
    if (!viewEl) return;
    const specContainer = viewEl.querySelector('.spec-container') as HTMLElement | null;
    if (!specContainer) return;
    specContainer.querySelector('.spec-view')?.classList.add('hidden');
    specContainer.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.add('hidden');
    specContainer.querySelector('.spec-edit')?.classList.remove('hidden');
    const textarea = specContainer.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) textarea.focus();
  }

  private refreshExecutionEngine() {
    if (!this.container) return;
    const el = this.container.querySelector('#execution-engine-view');
    if (!el) return;
    const historyTasks = this.allLoadedTasks
      .filter(t => !t.deleted && ([TaskStatus.IMPLEMENTED, TaskStatus.SUBMITTED, TaskStatus.DISCARDED] as any[]).includes(t.status))
      .sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
    el.innerHTML = ExecutionEngineView.render({
      tasks: this.allLoadedTasks,
      historyTasks,
      historyPage: this.historyPage,
    });
    // Re-render the engine Pi slot based on the current CoderBot session.
    this.updateEnginePiSlot();
  }

  /** Render the engine Pi slot based on the running session vs this pipeline. */
  private updateEnginePiSlot() {
    if (!this.container) return;
    const mount = this.container.querySelector('#engine-piview-mount') as HTMLElement | null;
    if (!mount) return;

    const placeholder = `<p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">Start a CoderBot to see its output here.</p>`;
    const session = this.context.coderBotService?.getCurrentSession?.() ?? null;

    if (!session || !session.taskId) {
      this.teardownEnginePiView();
      mount.innerHTML = placeholder;
      return;
    }

    if (session.pipelineId === this.pipelineId) {
      // Session belongs to this pipeline: connect/resume the PiView. Re-mount
      // when the mounted session changed OR the PiView DOM was wiped by an
      // ExecutionEngineView re-render; otherwise reuse it and just reconnect.
      const key = `${session.pipelineId}:${session.taskId}`;
      const logRendered = !!mount.querySelector('#log-content-container');
      if (!this.enginePiView || this.enginePiMountedKey !== key || !logRendered) {
        this.mountCoderBotPiView(mount);
        this.enginePiMountedKey = key;
      } else {
        this.context.coderBotService?.reconnect?.();
      }
      return;
    }

    this.teardownEnginePiView();
    this.enginePiMountedKey = null;
    if (session.active) {
      mount.innerHTML = `
        <p class="text-[10px] italic text-app-muted/70 text-center border border-dashed border-app-border/40 rounded-lg py-3">CoderBot is running for another pipeline.</p>
        <a href="#/pipeline/${session.pipelineId}" class="block text-center text-[10px] font-bold uppercase tracking-widest text-app-accent-2 hover:underline cursor-pointer mt-1">Open pipeline</a>`;
    } else {
      mount.innerHTML = placeholder;
    }
  }

  private teardownEnginePiView() {
    if (this.enginePiView) {
      this.enginePiView.destroy();
      this.enginePiView = null;
    }
    this.enginePiMountedKey = null;
  }

  private mountCoderBotPiView(mount: HTMLElement) {
    this.teardownEnginePiView();
    mount.innerHTML = '';
    // Defer the initial (potentially large, already-loaded) session history so
    // the rest of the pipeline detail view paints first; the log then fills in on
    // the next animation frame for a snappy page render.
    this.enginePiView = new PiView(this.context.coderBotService, mount, {
      logHeightClass: 'h-[38vh]',
      deferInitialRender: true,
      // Pop this compact sidebar log back out into the full CoderBot dialog.
      onOpenDialog: () => this.openCoderBotDialog(),
    });
    this.enginePiView.render();
    this.context.coderBotService?.reconnect?.();
  }

  private async refreshEnginePiSlot() {
    await this.context.coderBotService?.refreshSession?.();
    this.updateEnginePiSlot();
  }

  private refreshBacklog() {
    if (!this.container) return;
    const backlogEl = this.container.querySelector('#backlog-view');
    if (!backlogEl) return;
    const backlogTasks = this.allLoadedTasks.filter(t => !t.deleted && (t.status === TaskStatus.PROPOSED || t.status === TaskStatus.CREATED));
    const selectedTaskId =
      this.selectedTask && this.selectedTask.status === TaskStatus.CREATED
        ? this.selectedTask.id
        : undefined;

    backlogEl.innerHTML = BacklogView.render({ tasks: backlogTasks, selectedTaskId });
  }
}
