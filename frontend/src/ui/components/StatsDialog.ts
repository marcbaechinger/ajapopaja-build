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

import { Task } from '../../core/domain.ts';
import { BaseDialog } from './dialog_common.ts';
import { PipelineStatsView } from './PipelineStatsView.ts';
import type { PipelineClient } from '../../core/clients/PipelineClient.ts';
import { Icon } from './Icon.ts';

export class StatsDialog extends BaseDialog {
  private tasks: Task[];
  private pipelineId: string;
  private pipelineClient: PipelineClient;
  private dailyStats: any[] = [];

  constructor(tasks: Task[], pipelineId: string, pipelineClient: PipelineClient) {
    super({
      title: 'Pipeline Statistics',
      maxWidth: 'max-w-5xl',
      maxHeight: 'max-h-[90vh]',
      iconSvg: Icon.render('stats', { size: 24, className: 'text-app-accent-1' })
    });
    this.tasks = tasks;

    this.pipelineId = pipelineId;
    this.pipelineClient = pipelineClient;
    
    this.refreshBody();
  }

  private refreshBody() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    if (bodyContainer) {
      bodyContainer.innerHTML = this.renderBody();
      bodyContainer.classList.add('p-6', 'bg-app-surface');
      PipelineStatsView.animateBars(this.dialog);
    }
  }

  protected renderBody(): string {
    if (!this.tasks) return '';
    return PipelineStatsView.render(this.tasks, this.dailyStats);
  }

  public async show(): Promise<void> {
    const showPromise = super.show();
    
    // Fetch daily stats
    try {
      this.dailyStats = await this.pipelineClient.getDailyStats(this.pipelineId);
      this.refreshBody();
    } catch (e) {
      console.error('Failed to fetch daily stats', e);
    }
    
    await showPromise;
  }
}
