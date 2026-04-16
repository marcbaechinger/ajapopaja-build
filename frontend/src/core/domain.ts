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
  DISCARDED: "discarded",
  FAILED: "failed",
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export function isTaskStatus(value: any): value is TaskStatus {
  return Object.values(TaskStatus).includes(value);
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
    if (json.version !== undefined) this.version = Number(json.version);
    if (json.created_at !== undefined) this.created_at = String(json.created_at);
    if (json.updated_at !== undefined) this.updated_at = String(json.updated_at);
    if (json.deleted !== undefined) this.deleted = Boolean(json.deleted);
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

export interface WSMessage {
  type: string;
  id?: string;
  payload: any;
}
