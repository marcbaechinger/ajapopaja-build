export enum TaskStatus {
  CREATED = "created",
  SCHEDULED = "scheduled",
  INPROGRESS = "inprogress",
  IMPLEMENTED = "implemented",
  DISCARDED = "discarded",
  FAILED = "failed",
}

export class Task {
  _id?: string;
  title: string = '';
  description?: string | null;
  status: TaskStatus = TaskStatus.CREATED;
  order: number = 0;
  version: number = 1;
  pipeline_id: string = '';
  created_at?: string;
  updated_at?: string;
}

export class Pipeline {
  _id?: string;
  name: string = '';
  description?: string | null;
  version: number = 1;
  created_at?: string;
  updated_at?: string;
}

export interface WSMessage {
  type: string;
  id?: string;
  payload: any;
}
