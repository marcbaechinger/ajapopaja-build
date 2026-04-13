import { Pipeline } from '../domain.ts';
import { BaseClient } from './BaseClient.ts';
import { AuthService } from '../AuthService.ts';

export class PipelineClient extends BaseClient {
  private baseUrl: string;

  constructor(baseUrl: string, authService: AuthService) {
    super(authService);
    this.baseUrl = baseUrl;
  }

  async list(includeDeleted: boolean = false): Promise<Pipeline[]> {
    const url = new URL(`${this.baseUrl}/pipelines/`);
    if (includeDeleted) url.searchParams.append('include_deleted', 'true');
    const response = await this.fetch(url.toString());
    return await response.json();
  }

  async get(id: string, includeDeleted: boolean = false): Promise<Pipeline> {
    const url = new URL(`${this.baseUrl}/pipelines/${id}`);
    if (includeDeleted) url.searchParams.append('include_deleted', 'true');
    const response = await this.fetch(url.toString());
    return await response.json();
  }

  async create(name: string): Promise<Pipeline> {
    const response = await this.fetch(`${this.baseUrl}/pipelines/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    return await response.json();
  }

  async update(id: string, name: string, version: number): Promise<Pipeline> {
    try {
      const response = await this.fetch(`${this.baseUrl}/pipelines/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, version })
      });
      return await response.json();
    } catch (e: any) {
      if (e.message?.includes('409') || e.message?.includes('OCC_CONFLICT')) {
        throw new Error('OCC_CONFLICT');
      }
      throw e;
    }
  }

  async delete(id: string): Promise<void> {
    await this.fetch(`${this.baseUrl}/pipelines/${id}`, {
      method: 'DELETE'
    });
  }
}
