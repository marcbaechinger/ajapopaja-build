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

import type { AppContext } from '../../../core/AppContext.ts';
import type { Pipeline, Task, GitStatusDetails, BuildArtifactInfo } from '../../../core/domain.ts';
import type { ContentTab } from '../../../core/PipelineRoute.ts';
import type EasyMDE from 'easymde';
import type { SpecProposal } from '../../../core/clients/SpecBotClient.ts';
import type {
  DocbotState,
  ReviewbotState,
  ArchbotState,
  SpecAgentState,
} from '../../components/pipeline/PipelineHeaderView.ts';

export interface DevProcessState {
  running: boolean;
  pid: number | null;
  port: number | null;
  target?: string | null;
}

/**
 * Stable DOM mount-point contract for the `PipelineDetailView` controllers.
 *
 * These ids are the seams through which the extracted controllers render and
 * repaint their fragment in place. They must never be renamed or removed while
 * the corresponding controller is extracted; the shell keeps filling them until
 * then. Ownership:
 *
 * - `#pipeline-header-container`      header wrapper            (P2 layout, shell fills it)
 * - `#backlog-sidebar`                collapse target           (P2)
 * - `#backlog-view`                   BacklogView host          (shell / backlog refresh)
 * - `#content-tablist`                5 tab buttons             (P8)
 * - `#selected-task-view`             Task editor panel         (P7)
 * - `#interactive-coding-view-mount`  Coding Agent panel        (P8)
 * - `#file-browser-view-mount`        File Browser panel        (P8)
 * - `#history-view-mount`             Commits panel             (P8)
 * - `#getting-started-view-mount`     Getting Started panel     (P8)
 * - `#execution-engine-view`          right sidebar             (P3)
 * - `#engine-piview-mount`            CoderBot PiView slot      (P3, inner id)
 * - `#pipeline-session-list`          inline session rows       (P4)
 * - `#pull-request-section`           PR list container         (P6)
 *
 * Converting the existing string selectors to this map is out of scope for P0;
 * new code should prefer the constant so the contract has a single source.
 */
export const PIPELINE_DOM_IDS = {
  headerContainer: 'pipeline-header-container',
  backlogSidebar: 'backlog-sidebar',
  backlogView: 'backlog-view',
  contentTablist: 'content-tablist',
  selectedTaskView: 'selected-task-view',
  interactiveCodingViewMount: 'interactive-coding-view-mount',
  fileBrowserViewMount: 'file-browser-view-mount',
  historyViewMount: 'history-view-mount',
  gettingStartedViewMount: 'getting-started-view-mount',
  executionEngineView: 'execution-engine-view',
  enginePiViewMount: 'engine-piview-mount',
  pipelineSessionList: 'pipeline-session-list',
  pullRequestSection: 'pull-request-section',
} as const;

/**
 * All mutable data shared between the shell and the extracted controllers.
 * Fields are grouped by the task that will eventually own them.
 */
export interface PipelineDetailState {
  pipeline: Pipeline | null;

  // Shared task/selection state (P7).
  allLoadedTasks: Task[];
  selectedTask: Task | null;
  collapsedTasks: Set<string>;
  collapsedSpecs: Set<string>;
  /** Backlog sections (proposed/backlog/queue) hidden by the user. */
  collapsedBacklogSections: Set<string>;
  activeEditors: Map<string, EasyMDE>;
  pendingSpecEditTaskId: string | null;
  pendingScheduleFocusTaskId: string | null;
  historyPage: number;

  // Route / content-tab state (P8; hash bits are P1).
  contentTab: ContentTab;
  pendingFbPath: string | null;
  pendingTaskId: string | null;
  sidebarCollapsed: boolean;

  // Realtime / bot state (P6).
  docbotState: DocbotState;
  reviewbotState: ReviewbotState;
  archbotState: ArchbotState;
  specagentState: SpecAgentState;
  devProcessState: DevProcessState | undefined;
  /** Live metadata/fingerprint for the pipeline's build artifact. */
  artifactInfo: BuildArtifactInfo | null;
  /** Aliases kept in sync with artifactInfo for callers that use the shorter name. */
  artifact?: BuildArtifactInfo | null;
  /** True while a REST-initiated build is running. */
  buildInProgress: boolean;
  /** Whether the expandable artifact details panel is currently open. */
  artifactDetailsExpanded: boolean;
  /** Aliases kept in sync with buildInProgress. */
  isBuilding?: boolean;
  building?: boolean;
  pendingReviews: string[];
  pendingSpecProposals: SpecProposal[];
  pullRequests: any[];

  // Git status polling (kept on the shell until it gets its own owner).
  gitStatus: GitStatusDetails | undefined;
}

/** In-place repaint hooks owned by the shell. */
export interface PipelineDetailRefreshHooks {
  header(): void;            // updateHeader()
  backlog(): void;           // refreshBacklog()
  selectedTask(): void;      // refreshSelectedTask()
  executionEngine(): void;   // refreshExecutionEngine()
  sessionList(): void;       // refreshPipelineSessionList()
  specProposals(): void;     // renderPendingSpecProposals()
}

export interface PipelineDetailCtx {
  readonly context: AppContext;
  readonly pipelineId: string;
  readonly state: PipelineDetailState;
  readonly refresh: PipelineDetailRefreshHooks;
  /** Convenience read-only view of `state.pipeline`. */
  readonly pipeline: Pipeline | null;
}

/**
 * Returns the defaults currently declared by `PipelineDetailView`'s field
 * initialisers. This is the single source of truth for the initial state; do
 * not add defaults that the view did not previously have.
 */
export function createPipelineDetailState(): PipelineDetailState {
  const state: PipelineDetailState = {
    pipeline: null,

    allLoadedTasks: [],
    selectedTask: null,
    collapsedTasks: new Set<string>(),
    collapsedSpecs: new Set<string>(),
    collapsedBacklogSections: new Set<string>(),
    activeEditors: new Map<string, EasyMDE>(),
    pendingSpecEditTaskId: null,
    pendingScheduleFocusTaskId: null,
    historyPage: 0,

    contentTab: 'task-editor',
    pendingFbPath: null,
    pendingTaskId: null,
    sidebarCollapsed: false,

    docbotState: { status: 'none', taskId: null },
    reviewbotState: { status: 'none', taskId: null },
    archbotState: { status: 'none', taskId: null },
    specagentState: { status: 'none', taskId: null },
    devProcessState: undefined,
    artifactInfo: null,
    buildInProgress: false,
    artifactDetailsExpanded: false,
    pendingReviews: [],
    pendingSpecProposals: [],
    pullRequests: [],

    gitStatus: undefined,
  };

  // Keep the short-form aliases in sync without making them separate sources
  // of truth. Defining them non-enumerably keeps the state's public shape and
  // equality checks focused on the canonical fields above.
  Object.defineProperties(state, {
    artifact: {
      configurable: true,
      get: () => state.artifactInfo,
      set: (value: BuildArtifactInfo | null) => { state.artifactInfo = value; },
    },
    isBuilding: {
      configurable: true,
      get: () => state.buildInProgress,
      set: (value: boolean) => { state.buildInProgress = value; },
    },
    building: {
      configurable: true,
      get: () => state.buildInProgress,
      set: (value: boolean) => { state.buildInProgress = value; },
    },
  });

  return state;
}

export function createPipelineDetailCtx(args: {
  context: AppContext;
  pipelineId: string;
  state?: PipelineDetailState;
  refresh: PipelineDetailRefreshHooks;
}): PipelineDetailCtx {
  const state = args.state ?? createPipelineDetailState();
  return {
    context: args.context,
    pipelineId: args.pipelineId,
    state,
    refresh: args.refresh,
    get pipeline() {
      return state.pipeline;
    },
  };
}
