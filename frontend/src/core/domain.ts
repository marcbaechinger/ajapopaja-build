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

export const TaskStatus = {
  CREATED: "created",
  SCHEDULED: "scheduled",
  PROPOSED: "proposed",
  INPROGRESS: "inprogress",
  IMPLEMENTED: "implemented",
  PULL_REQUEST_AVAILABLE: "pull_request_available",
  SUBMITTED: "submitted",
  DISCARDED: "discarded",
  FAILED: "failed",
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export function isTaskStatus(value: any): value is TaskStatus {
  return Object.values(TaskStatus).includes(value);
}

/**
 * States reached after the task's (last) implementation interval has ended.
 *
 * A *processed* task has finished its INPROGRESS work interval, so an
 * implementation duration is computable. This is intentionally broader than
 * the History Feed membership (IMPLEMENTED / SUBMITTED / DISCARDED): the latter
 * is a narrower UI concern and must not be changed implicitly.
 */
export const PROCESSED_STATUSES: readonly TaskStatus[] = [
  TaskStatus.IMPLEMENTED,
  TaskStatus.PULL_REQUEST_AVAILABLE,
  TaskStatus.SUBMITTED,
  TaskStatus.DISCARDED, // includes design rejected / task cancelled
  TaskStatus.FAILED,
];

export function isProcessedStatus(status: TaskStatus): boolean {
  return PROCESSED_STATUSES.includes(status);
}

export interface VerificationCommandResult {
  cmd: string;
  exit_code: number | null;
  output_tail?: string;
  /** Command category, e.g. "build" | "lint" | "test". */
  kind?: string;
  /** Wall-clock time the command took, in milliseconds. */
  duration_ms?: number;
}

export interface VerificationResult {
  commands: VerificationCommandResult[];
  passed: boolean;
  /** Total wall-clock time of the whole verification run, in milliseconds. */
  duration_ms?: number;
  /** Per-category wall-clock time (e.g. ``{ build: 1234, test: 5678 }``). */
  durations?: Record<string, number>;
}

export interface StateTransition {
  from_status?: TaskStatus | null;
  to_status: TaskStatus;
  timestamp: string;
  by: string; // "user", "mcp", "system"
}

export class Task {
  id?: string;
  title: string = '';
  description?: string | null;
  status: TaskStatus = TaskStatus.CREATED;
  type: string = "manual"; // manual, system
  spec?: string | null;
  want_design_doc: boolean = false;
  order: number = 100;
  version: number = 1;
  commit_hash?: string | null;
  completion_info?: string | null;
  verification?: VerificationResult | null;
  design_doc?: string | null;
  parent_task_id?: string | null;
  pipeline_id: string = '';
  created_at?: string;
  updated_at?: string;
  scheduled_at?: string;
  deleted: boolean = false;
  history: StateTransition[] = [];
  review_md?: string | null;
  suggested_model?: string | null;

  constructor(json: any) {
    if (!json) return;

    if (json._id) this.id = json._id;
    if (json.id) this.id = json.id;
    if (json.title !== undefined) this.title = String(json.title);
    if (json.description !== undefined) this.description = json.description;
    if (json.status !== undefined && isTaskStatus(json.status)) this.status = json.status;
    if (json.type !== undefined) this.type = String(json.type);
    if (json.spec !== undefined) this.spec = json.spec;
    if (json.want_design_doc !== undefined) this.want_design_doc = Boolean(json.want_design_doc);
    if (json.order !== undefined) this.order = Number(json.order);
    if (json.version !== undefined) this.version = Number(json.version);
    if (json.commit_hash !== undefined) this.commit_hash = json.commit_hash;
    if (json.completion_info !== undefined) this.completion_info = json.completion_info;
    if (json.verification !== undefined) this.verification = json.verification;
    if (json.design_doc !== undefined) this.design_doc = json.design_doc;
    if (json.parent_task_id !== undefined) this.parent_task_id = json.parent_task_id;
    if (json.pipeline_id !== undefined) this.pipeline_id = String(json.pipeline_id);
    if (json.created_at !== undefined) this.created_at = String(json.created_at);
    if (json.updated_at !== undefined) this.updated_at = String(json.updated_at);
    if (json.scheduled_at !== undefined) this.scheduled_at = String(json.scheduled_at);
    if (json.deleted !== undefined) this.deleted = Boolean(json.deleted);
    if (json.review_md !== undefined) this.review_md = json.review_md;
    if (json.suggested_model !== undefined) this.suggested_model = json.suggested_model;
    
    if (Array.isArray(json.history)) {
      this.history = json.history.map((t: any) => ({
        from_status: t.from_status && isTaskStatus(t.from_status) ? t.from_status : undefined,
        to_status: isTaskStatus(t.to_status) ? t.to_status : TaskStatus.CREATED,
        timestamp: String(t.timestamp || ''),
        by: String(t.by || 'system')
      }));
    }
  }
}

export class DesignDocHistory {
  id?: string;
  task_id: string = '';
  version: number = 0;
  design_doc: string = '';
  timestamp: string = '';

  constructor(json: any) {
    if (!json) return;
    if (json._id) this.id = json._id;
    if (json.id) this.id = json.id;
    if (json.task_id !== undefined) this.task_id = String(json.task_id);
    if (json.version !== undefined) this.version = Number(json.version);
    if (json.design_doc !== undefined) this.design_doc = String(json.design_doc);
    if (json.timestamp !== undefined) this.timestamp = String(json.timestamp);
  }
}

export const PipelineStatus = {
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
} as const;

export type PipelineStatus = typeof PipelineStatus[keyof typeof PipelineStatus];

export function isPipelineStatus(value: any): value is PipelineStatus {
  return Object.values(PipelineStatus).includes(value);
}

export class Pipeline {
  id?: string;
  name: string = '';
  description?: string | null;
  status: PipelineStatus = PipelineStatus.ACTIVE;
  workspace_path?: string | null;
  repo_uri?: string | null;
  repo_username?: string | null;
  repo_token?: string | null;
  has_repo_token?: boolean;
  doc_root: string = 'design';
  test_commands?: string[][] | null;
  lint_commands?: string[][] | null;
  serve_commands?: string[][] | null;
  build_commands?: string[][] | null;
  ollama_model?: string | null;
  one_prompt_model?: string | null;
  assistant_model?: string | null;
  archbot_model?: string | null;
  reviewbot_model?: string | null;
  docbot_model?: string | null;
  specagent_model?: string | null;
  coderbot_model?: string | null;
  version: number = 1;
  created_at?: string;
  updated_at?: string;
  deleted: boolean = false;

  constructor(json: any) {
    if (!json) return;

    if (json._id) this.id = json._id;
    if (json.id) this.id = json.id;
    if (json.name !== undefined) this.name = String(json.name);
    if (json.description !== undefined) this.description = json.description;
    if (json.status !== undefined && isPipelineStatus(json.status)) this.status = json.status;
    if (json.workspace_path !== undefined) this.workspace_path = json.workspace_path;
    if (json.repo_uri !== undefined) this.repo_uri = json.repo_uri;
    if (json.repo_username !== undefined) this.repo_username = json.repo_username;
    if (json.repo_token !== undefined) this.repo_token = json.repo_token;
    if (json.has_repo_token !== undefined) this.has_repo_token = Boolean(json.has_repo_token);
    if (json.doc_root !== undefined) this.doc_root = String(json.doc_root);
    if (json.test_commands !== undefined) this.test_commands = Array.isArray(json.test_commands) ? json.test_commands : null;
    if (json.lint_commands !== undefined) this.lint_commands = Array.isArray(json.lint_commands) ? json.lint_commands : null;
    if (json.serve_commands !== undefined) this.serve_commands = Array.isArray(json.serve_commands) ? json.serve_commands : null;
    if (json.build_commands !== undefined) this.build_commands = Array.isArray(json.build_commands) ? json.build_commands : null;
    if (json.ollama_model !== undefined) this.ollama_model = json.ollama_model;
    if (json.one_prompt_model !== undefined) this.one_prompt_model = json.one_prompt_model;
    if (json.assistant_model !== undefined) this.assistant_model = json.assistant_model;
    if (json.archbot_model !== undefined) this.archbot_model = json.archbot_model;
    if (json.reviewbot_model !== undefined) this.reviewbot_model = json.reviewbot_model;
    if (json.docbot_model !== undefined) this.docbot_model = json.docbot_model;
    if (json.specagent_model !== undefined) this.specagent_model = json.specagent_model;
    if (json.coderbot_model !== undefined) this.coderbot_model = json.coderbot_model;
    if (json.version !== undefined) this.version = Number(json.version);
    if (json.created_at !== undefined) this.created_at = String(json.created_at);
    if (json.updated_at !== undefined) this.updated_at = String(json.updated_at);
    if (json.deleted !== undefined) this.deleted = Boolean(json.deleted);
  }
}

export const PullRequestStatus = {
  OPEN: "open",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  SUBMITTED: "submitted",
} as const;

export type PullRequestStatus = typeof PullRequestStatus[keyof typeof PullRequestStatus];

export const PullRequestKind = {
  IMPLEMENTATION: "implementation",
  DOCUMENTATION: "documentation",
} as const;

export type PullRequestKind = typeof PullRequestKind[keyof typeof PullRequestKind];

export class PullRequest {
  id?: string;
  pipeline_id: string = '';
  task_id: string = '';
  summary: string = '';
  subject: string = '';
  author?: string;
  branch_name: string = '';
  kind: PullRequestKind = PullRequestKind.IMPLEMENTATION;
  commit_hash?: string | null;
  patch: string = '';
  status: PullRequestStatus = PullRequestStatus.OPEN;
  remote_pr_url?: string;
  // How accepting this PR applies the change (resolved by the backend):
  // "merge"  -> applied directly in the local workspace/repo
  // "push"   -> committed to the cloned repo and pushed to the remote
  // "submit" -> committed to the cloned repo and sent as a pull request
  apply_mode?: string;
  created_at?: string;
  updated_at?: string;

  constructor(json: any) {
    if (!json) return;
    if (json._id) this.id = json._id;
    if (json.id) this.id = json.id;
    if (json.pipeline_id !== undefined) this.pipeline_id = String(json.pipeline_id);
    if (json.task_id !== undefined) this.task_id = String(json.task_id);
    if (json.summary !== undefined) this.summary = String(json.summary);
    if (json.subject !== undefined) this.subject = String(json.subject);
    if (json.author !== undefined) this.author = String(json.author);
    if (json.branch_name !== undefined) this.branch_name = String(json.branch_name);
    if (json.kind !== undefined) this.kind = json.kind as PullRequestKind;
    if (json.commit_hash !== undefined) this.commit_hash = json.commit_hash;
    // A completed PR may have its patch cleaned up by the backend (null).
    // Keep patch a string on the model, but never turn null into "null".
    this.patch = json.patch != null ? String(json.patch) : '';
    if (json.status !== undefined) this.status = json.status as PullRequestStatus;
    this.remote_pr_url =
      json.remote_pr_url != null ? String(json.remote_pr_url) : undefined;
    if (json.apply_mode !== undefined) this.apply_mode = String(json.apply_mode);
    if (json.created_at !== undefined) this.created_at = String(json.created_at);
    if (json.updated_at !== undefined) this.updated_at = String(json.updated_at);
  }
}

// Human-friendly label for the action of accepting a pull request, depending on
// how the change will be applied (merge / push / submit).
export function pullRequestAcceptLabel(pr: PullRequest): string {
  switch (pr.apply_mode) {
    case 'push': return 'Push';
    case 'submit': return 'Submit';
    case 'merge': return 'Merge';
    default: return 'Merge';
  }
}

export class CommitDiff {
  commit_hash: string = '';
  patch: string = '';
  subject?: string | null;
  message?: string | null;
  author?: string | null;
  created_at?: string | null;

  constructor(json: any) {
    if (!json) return;
    if (json.commit_hash !== undefined) this.commit_hash = String(json.commit_hash);
    this.patch = json.patch != null ? String(json.patch) : '';
    if (json.subject !== undefined) this.subject = json.subject;
    if (json.message !== undefined) this.message = json.message;
    if (json.author !== undefined) this.author = json.author;
    if (json.created_at !== undefined) this.created_at = json.created_at;
  }
}


export interface User {
  id?: string;
  username: string;
  email?: string | null;
  full_name?: string | null;
  disabled: boolean;
  created_at?: string;
}

export interface GitStatus {
  staged: number;
  unstaged: number;
  untracked: number;
}

/**
 * Extended repository status returned by the Pipeline git-status endpoint:
 * working-tree counts plus remote-origin sync information.
 */
export interface GitStatusDetails extends GitStatus {
  has_origin: boolean;
  branch?: string | null;
  /** True when neither ahead nor behind origin; null when not applicable/unknown. */
  in_sync?: boolean | null;
  ahead: number;
  behind: number;
  error?: string | null;
}

/** A single compact commit entry in the pipeline git log. */
export interface GitLogEntry {
  hash: string;
  short_hash: string;
  author?: string | null;
  email?: string | null;
  date?: string | null;
  subject?: string | null;
}

/** Response wrapper for the Pipeline git-log endpoint. */
export interface GitLogResponse {
  commits: GitLogEntry[];
  /** Total number of commits on the branch, across all pages. */
  total: number;
  error?: string | null;
}

/** Git status of a single file or directory in the pipeline repository. */
export const FileGitStatus = {
  CLEAN: 'clean',
  MODIFIED: 'modified',
  ADDED: 'added',
  DELETED: 'deleted',
  UNTRACKED: 'untracked',
  IGNORED: 'ignored',
  CONFLICTED: 'conflicted',
} as const;

export type FileGitStatus = typeof FileGitStatus[keyof typeof FileGitStatus];

export function isFileGitStatus(value: any): value is FileGitStatus {
  return Object.values(FileGitStatus).includes(value);
}

/** A single file or directory entry in a directory listing. */
export class FileEntry {
  name: string = '';
  path: string = '';
  isDir: boolean = false;
  size?: number | null;
  createdAt?: string | null;
  modifiedAt?: string | null;
  gitStatus?: FileGitStatus | null;
  hasChildren?: boolean | null;

  constructor(json: any) {
    if (!json) return;
    if (json.name !== undefined) this.name = String(json.name);
    if (json.path !== undefined) this.path = String(json.path);
    if (json.is_dir !== undefined) this.isDir = Boolean(json.is_dir);
    if (json.size !== undefined) this.size = json.size === null ? null : Number(json.size);
    if (json.created_at !== undefined) this.createdAt = json.created_at === null ? null : String(json.created_at);
    if (json.modified_at !== undefined) this.modifiedAt = json.modified_at === null ? null : String(json.modified_at);
    if (json.git_status !== undefined) {
      this.gitStatus = isFileGitStatus(json.git_status) ? json.git_status : null;
    }
    if (json.has_children !== undefined) this.hasChildren = json.has_children === null ? null : Boolean(json.has_children);
  }
}

/** Contents of a single directory in the pipeline repository. */
export class DirectoryListing {
  path: string = '';
  parent?: string | null;
  entries: FileEntry[] = [];

  constructor(json: any) {
    if (!json) return;
    if (json.path !== undefined) this.path = String(json.path);
    if (json.parent !== undefined) this.parent = json.parent === null ? null : String(json.parent);
    if (Array.isArray(json.entries)) {
      this.entries = json.entries.map((e: any) => new FileEntry(e));
    }
  }
}

/** Read-only content and metadata of a single file. */
export class FileContent {
  path: string = '';
  name: string = '';
  size: number = 0;
  createdAt?: string | null;
  modifiedAt?: string | null;
  gitStatus?: FileGitStatus | null;
  isBinary: boolean = false;
  truncated: boolean = false;
  encoding?: string | null;
  content?: string | null;

  constructor(json: any) {
    if (!json) return;
    if (json.path !== undefined) this.path = String(json.path);
    if (json.name !== undefined) this.name = String(json.name);
    if (json.size !== undefined) this.size = Number(json.size);
    if (json.created_at !== undefined) this.createdAt = json.created_at === null ? null : String(json.created_at);
    if (json.modified_at !== undefined) this.modifiedAt = json.modified_at === null ? null : String(json.modified_at);
    if (json.git_status !== undefined) {
      this.gitStatus = isFileGitStatus(json.git_status) ? json.git_status : null;
    }
    if (json.is_binary !== undefined) this.isBinary = Boolean(json.is_binary);
    if (json.truncated !== undefined) this.truncated = Boolean(json.truncated);
    if (json.encoding !== undefined) this.encoding = json.encoding === null ? null : String(json.encoding);
    if (json.content !== undefined) this.content = json.content === null ? null : String(json.content);
  }
}

/** A single hit of a repository path search (repo-relative POSIX path). */
export class FileSearchResult {
  path: string = '';
  name: string = '';
  isDir: boolean = false;

  constructor(json: any) {
    if (!json) return;
    if (json.path !== undefined) this.path = String(json.path);
    if (json.name !== undefined) this.name = String(json.name);
    if (json.is_dir !== undefined) this.isDir = Boolean(json.is_dir);
  }
}

/** Result of searching a pipeline repository for filenames/paths. */
export class FileSearchResponse {
  query: string = '';
  results: FileSearchResult[] = [];
  truncated: boolean = false;
  indexReady: boolean = true;

  constructor(json: any) {
    if (!json) return;
    if (json.query !== undefined) this.query = String(json.query);
    if (Array.isArray(json.results)) {
      this.results = json.results.map((entry: any) => new FileSearchResult(entry));
    }
    if (json.truncated !== undefined) this.truncated = Boolean(json.truncated);
    if (json.index_ready !== undefined) this.indexReady = Boolean(json.index_ready);
  }
}

export const NotificationType = {
  MESSAGE: "message",
  CONFIRMATION: "confirmation",
  ACTIONS: "actions",
} as const;

export type NotificationType = typeof NotificationType[keyof typeof NotificationType];

export function isNotificationType(value: any): value is NotificationType {
  return Object.values(NotificationType).includes(value);
}

export const NotificationSeverity = {
  NORMAL: "normal",
  WARNING: "warning",
  ERROR: "error",
} as const;

export type NotificationSeverity = typeof NotificationSeverity[keyof typeof NotificationSeverity];

export function isNotificationSeverity(value: any): value is NotificationSeverity {
  return Object.values(NotificationSeverity).includes(value);
}

/** An action the user can trigger from a notification. */
export class NotificationAction {
  name: string = '';
  label: string = '';
  data: Record<string, any> = {};
  style: string = 'default'; // default | primary | danger

  constructor(json: any) {
    if (!json) return;
    if (json.name !== undefined) this.name = String(json.name);
    if (json.label !== undefined) this.label = String(json.label);
    if (json.data !== undefined && json.data !== null && typeof json.data === 'object') {
      this.data = json.data;
    }
    if (json.style !== undefined) this.style = String(json.style);
  }
}

/**
 * A user-facing notification delivered by the backend. Mirrors the backend
 * `Notification` model and normalizes raw payloads defensively.
 */
export class AppNotification {
  id: string = '';
  type: NotificationType = NotificationType.MESSAGE;
  severity: NotificationSeverity = NotificationSeverity.NORMAL;
  title: string = '';
  message: string = '';
  actions: NotificationAction[] = [];
  dismissible: boolean = true;
  created_at?: string;

  constructor(json: any) {
    if (!json) return;
    if (json.id !== undefined) this.id = String(json.id);
    if (json.type !== undefined && isNotificationType(json.type)) this.type = json.type;
    if (json.severity !== undefined && isNotificationSeverity(json.severity)) this.severity = json.severity;
    if (json.title !== undefined) this.title = String(json.title);
    if (json.message !== undefined) this.message = String(json.message);
    if (json.dismissible !== undefined) this.dismissible = Boolean(json.dismissible);
    if (json.created_at !== undefined) this.created_at = String(json.created_at);
    if (Array.isArray(json.actions)) {
      this.actions = json.actions.map((a: any) => new NotificationAction(a));
    }
  }
}

export interface WSMessage {
  type: string;
  id?: string;
  payload: any;
}
