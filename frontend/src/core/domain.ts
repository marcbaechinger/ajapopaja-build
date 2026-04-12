export const TaskStatus = {
  CREATED: "created",
  SCHEDULED: "scheduled",
  INPROGRESS: "inprogress",
  IMPLEMENTED: "implemented",
  DISCARDED: "discarded",
  FAILED: "failed",
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export class Task {
  _id?: string;
  title: string = '';
  description?: string | null;
  status: TaskStatus = TaskStatus.CREATED;
  type: string = "manual"; // manual, system
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
}

export interface WSMessage {
  type: string;
  id?: string;
  payload: any;
}
