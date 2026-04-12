import { Pipeline } from '../domain.ts';

export class PipelineClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async list(): Promise<Pipeline[]> {
    const response = await fetch(`${this.baseUrl}/pipelines/`);
    if (!response.ok) throw new Error('Failed to fetch pipelines');
    return await response.json();
  }

  async get(id: string): Promise<Pipeline> {
    const response = await fetch(`${this.baseUrl}/pipelines/${id}`);
    if (response.status === 404) throw new Error(`Pipeline ${id} not found`);
    if (!response.ok) throw new Error('Failed to fetch pipeline');
    return await response.json();
  }

  async create(name: string): Promise<Pipeline> {
    const response = await fetch(`${this.baseUrl}/pipelines/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!response.ok) throw new Error('Failed to create pipeline');
    return await response.json();
  }

  async update(id: string, name: string, version: number): Promise<Pipeline> {
    const response = await fetch(`${this.baseUrl}/pipelines/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, version })
    });

    if (response.status === 409) {
      throw new Error('OCC_CONFLICT');
    }
    
    if (!response.ok) throw new Error('Failed to update pipeline');
    return await response.json();
  }
}
