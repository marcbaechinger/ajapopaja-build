export const TaskStatus = {
  CREATED: "created",
  SCHEDULED: "scheduled",
  PROPOSED: "proposed",
  INPROGRESS: "inprogress",
  IMPLEMENTED: "implemented",
  DISCARDED: "discarded",
  FAILED: "failed",
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export interface StateTransition {
  from_status?: TaskStatus | null;
  to_status: TaskStatus;
  timestamp: string;
  by: string; // "user", "mcp", "system"
}

export class Task {
  _id?: string;
  title: string = '';
  description?: string | null;
  status: TaskStatus = TaskStatus.CREATED;
  type: string = "manual"; // manual, system
  spec?: string | null;
  want_design_doc: boolean = false;
  order: number = 0;
  version: number = 1;
  commit_hash?: string | null;
  completion_info?: string | null;
  verification?: any | null;
  design_doc?: string | null;
  parent_task_id?: string | null;
  pipeline_id: string = '';
  created_at?: string;
  updated_at?: string;
  scheduled_at?: string;
  deleted: boolean = false;
  history: StateTransition[] = [];
}

export const PipelineStatus = {
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
} as const;

export type PipelineStatus = typeof PipelineStatus[keyof typeof PipelineStatus];

export class Pipeline {
  _id?: string;
  name: string = '';
  description?: string | null;
  status: PipelineStatus = PipelineStatus.ACTIVE;
  version: number = 1;
  created_at?: string;
  updated_at?: string;
  deleted: boolean = false;
}

export interface User {
  _id?: string;
  username: string;
  email?: string | null;
  full_name?: string | null;
  disabled: boolean;
  created_at?: string;
}

export interface WSMessage {
  type: string;
  id?: string;
  payload: any;
}
