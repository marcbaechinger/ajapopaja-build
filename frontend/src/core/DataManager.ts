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

import { Pipeline, Task, DesignDocHistory } from './domain.ts';
import { WebSocketClient } from './WebSocketClient.ts';

export type Listener = (data?: any) => void;

/**
 * DataManager is a centralized store and event bus for domain entities.
 * It caches entities and notifies listeners when they change.
 */
export class DataManager {
  private pipelines = new Map<string, Pipeline>();
  private tasks = new Map<string, Task>();
  private designDocs = new Map<string, DesignDocHistory>();

  private listeners = new Map<string, Set<Listener>>();
  private wsClient: WebSocketClient;

  constructor(wsClient: WebSocketClient) {
    this.wsClient = wsClient;
    this.initializeWebSocket();
  }

  /* ---------- Public API ---------- */

  /**
   * Retrieves a pipeline from the cache.
   */
  getPipeline(id: string): Pipeline | undefined {
    return this.pipelines.get(id);
  }

  /**
   * Retrieves a task from the cache.
   */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /**
   * Retrieves a design doc history from the cache.
   */
  getDesignDoc(id: string): DesignDocHistory | undefined {
    return this.designDocs.get(id);
  }

  /**
   * Returns all cached tasks for a specific pipeline.
   */
  getTasksByPipeline(pipelineId: string): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.pipeline_id === pipelineId);
  }

  /**
   * Manually updates a task in the cache and notifies listeners.
   * Useful for optimistic updates.
   */
  updateTask(task: Task | any): Task | undefined {
    const taskObj = task instanceof Task ? task : new Task(task);
    if (!taskObj.id) return undefined;
    
    this.tasks.set(taskObj.id, taskObj);
    this.notify(`task:${taskObj.id}`, taskObj);
    this.notify(`pipeline:tasks:${taskObj.pipeline_id}`, taskObj);
    
    if (taskObj.design_doc) this.notify(`task:design:${taskObj.id}`, taskObj.design_doc);
    if (taskObj.review_md) this.notify(`task:review:${taskObj.id}`, taskObj.review_md);
    
    return taskObj;
  }

  /**
   * Manually updates a pipeline in the cache and notifies listeners.
   */
  updatePipeline(pipeline: Pipeline | any): Pipeline | undefined {
    const pipelineObj = pipeline instanceof Pipeline ? pipeline : new Pipeline(pipeline);
    if (!pipelineObj.id) return undefined;
    
    this.pipelines.set(pipelineObj.id, pipelineObj);
    this.notify(`pipeline:${pipelineObj.id}`, pipelineObj);
    return pipelineObj;
  }

  /**
   * Removes a task from the cache.
   */
  removeTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.delete(taskId);
      this.notify(`task:${taskId}`);
      this.notify(`pipeline:tasks:${task.pipeline_id}`);
    }
  }

  /**
   * Register a listener for a specific data query.
   * Returns an unsubscription function.
   */
  on(query: string, callback: Listener): () => void {
    if (!this.listeners.has(query)) {
      this.listeners.set(query, new Set());
    }
    this.listeners.get(query)!.add(callback);
    return () => this.listeners.get(query)?.delete(callback);
  }

  /* ---------- Internals ---------- */

  private notify(query: string, data?: any) {
    this.listeners.get(query)?.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        console.error(`Error in DataManager listener for ${query}:`, e);
      }
    });
  }

  private initializeWebSocket() {
    this.wsClient.on('TASK_CREATED', msg => {
      const task = this.updateTask(msg.payload);
      if (task) this.notify(`pipeline:tasks:${task.pipeline_id}`, task);
    });
    this.wsClient.on('TASK_UPDATED', msg => {
      const task = this.updateTask(msg.payload);
      if (task) this.notify(`pipeline:tasks:${task.pipeline_id}`, task);
    });
    this.wsClient.on('TASK_STATUS_UPDATED', msg => {
      const task = this.updateTask(msg.payload);
      if (task) this.notify(`pipeline:tasks:${task.pipeline_id}`, task);
    });
    this.wsClient.on('TASK_COMPLETED', msg => {
      const task = this.updateTask(msg.payload);
      if (task) this.notify(`pipeline:tasks:${task.pipeline_id}`, task);
    });
    this.wsClient.on('TASK_DELETED', msg => {
      if (msg.payload?.task_id) {
        const taskId = msg.payload.task_id;
        const pipelineId = msg.payload.pipeline_id;
        this.removeTask(taskId);
        if (pipelineId) {
          this.notify(`pipeline:tasks:${pipelineId}`, { id: taskId, deleted: true });
        }
      }
    });

    this.wsClient.on('PIPELINE_UPDATED', msg => this.updatePipeline(msg.payload));
    
    // Process status updates
    const processEvents = [
      'GEMINI_PROCESS_STARTED', 'GEMINI_PROCESS_STOPPED',
      'VIBE_PROCESS_STARTED', 'VIBE_PROCESS_STOPPED',
      'DOCBOT_STARTED', 'DOCBOT_COMPLETED', 'DOCBOT_PREVIEW_READY',
      'REVIEWBOT_STARTED', 'REVIEWBOT_COMPLETED', 'REVIEWBOT_REVIEW_READY',
      'ARCHBOT_STARTED', 'ARCHBOT_COMPLETED'
    ];

    processEvents.forEach(type => {
      this.wsClient.on(type, msg => {
        if (msg.payload?.pipeline_id) {
          this.notify(`pipeline:status:${msg.payload.pipeline_id}`, { type, payload: msg.payload });
        }
        if (msg.payload?.task_id) {
          this.notify(`task:status:${msg.payload.task_id}`, { type, payload: msg.payload });
        }
        // Also notify the specific event type as a query
        this.notify(`ws:${type}:${msg.payload?.pipeline_id || 'global'}`, msg.payload);
      });
    });

    // Design doc specific updates
    this.wsClient.on('DESIGN_DOC_UPDATED', msg => {
       const doc = new DesignDocHistory(msg.payload);
       if (doc.id) {
         this.designDocs.set(doc.id, doc);
         this.notify(`design:${doc.id}`);
       }
       if (doc.task_id) {
         this.notify(`task:design_history:${doc.task_id}`);
       }
    });
    
    // Other bot related updates that should trigger task refresh
    this.wsClient.on('DOCBOT_REVIEW_READY', msg => {
      if (msg.payload?.task_id) this.notify(`task:docbot:${msg.payload.task_id}`);
    });
    
    this.wsClient.on('REVIEWBOT_REVIEW_READY', msg => {
      if (msg.payload?.task_id) this.notify(`task:review:${msg.payload.task_id}`);
    });

    this.wsClient.on('ARCHBOT_COMPLETED', msg => {
      // If payload is a full task object (has id and pipeline_id), update it.
      // This ensures the design_doc is updated in the cache.
      if (msg.payload?.id && msg.payload?.pipeline_id) {
        const task = this.updateTask(msg.payload);
        if (task) {
           this.notify(`pipeline:tasks:${task.pipeline_id}`, task);
        }
      } else if (msg.payload?.task_id) {
        this.notify(`task:design:${msg.payload.task_id}`);
      }
    });
  }
}
