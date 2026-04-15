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

  constructor(json?: any) {
    if (json) {
      for (const key of Object.keys(json)) {
        if (key === '_id') {
          this.id = json[key];
        } else {
          (this as any)[key] = json[key];
        }
      }
    }
  }
}

export const PipelineStatus = {
  ACTIVE: "active",
  PAUSED: "paused",
  COMPLETED: "completed",
} as const;

export type PipelineStatus = typeof PipelineStatus[keyof typeof PipelineStatus];

export class Pipeline {
  id?: string;
  name: string = '';
  description?: string | null;
  status: PipelineStatus = PipelineStatus.ACTIVE;
  version: number = 1;
  created_at?: string;
  updated_at?: string;
  deleted: boolean = false;

  constructor(json?: any) {
    if (json) {
      for (const key of Object.keys(json)) {
        if (key === '_id') {
          this.id = json[key];
        } else {
          (this as any)[key] = json[key];
        }
      }
    }
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
