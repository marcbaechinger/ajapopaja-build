import { Task, TaskStatus } from '../domain.ts';

export class TaskClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async listByPipeline(pipelineId: string): Promise<Task[]> {
    const response = await fetch(`${this.baseUrl}/pipelines/${pipelineId}/tasks/`);
    if (!response.ok) throw new Error('Failed to fetch tasks');
    return await response.json();
  }

  async get(id: string): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/tasks/${id}/`);
    if (response.status === 404) throw new Error(`Task ${id} not found`);
    if (!response.ok) throw new Error('Failed to fetch task');
    return await response.json();
  }

  async create(pipelineId: string, title: string): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/pipelines/${pipelineId}/tasks/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, pipeline_id: pipelineId })
    });
    if (!response.ok) throw new Error('Failed to create task');
    return await response.json();
  }

  async updateStatus(id: string, status: TaskStatus, version: number): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/tasks/${id}/status/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, version })
    });

    if (response.status === 409) {
      throw new Error('OCC_CONFLICT');
    }
    
    if (!response.ok) throw new Error('Failed to update task status');
    return await response.json();
  }

  async updateDetails(id: string, version: number, details: Partial<{title: string, description: string}>): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/tasks/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, ...details })
    });

    if (response.status === 409) {
      throw new Error('OCC_CONFLICT');
    }
    
    if (!response.ok) throw new Error('Failed to update task details');
    return await response.json();
  }

  async complete(id: string, version: number, commit_hash: string, completion_info: string): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/tasks/${id}/complete/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, commit_hash, completion_info })
    });

    if (response.status === 409) {
      throw new Error('OCC_CONFLICT');
    }
    
    if (!response.ok) throw new Error('Failed to complete task');
    return await response.json();
  }

  async getNextTask(pipelineId: string): Promise<Task | null> {
    const response = await fetch(`${this.baseUrl}/pipelines/${pipelineId}/tasks/next/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error('Failed to get next task');
    return await response.json();
  }
}
