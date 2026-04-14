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
import { PipelineStatsView } from './PipelineStatsView.ts';
import { BaseDialog } from './dialog_common.ts';

export class StatsDialog extends BaseDialog {
  private tasks: Task[];

  constructor(tasks: Task[]) {
    super({
      title: 'Pipeline Statistics',
      maxWidth: 'max-w-2xl',
      maxHeight: 'max-h-[90vh]',
      iconSvg: `<svg class="w-6 h-6 text-app-accent-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>`
    });
    this.tasks = tasks;
    
    // Refresh body with stats
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody() as string;
    bodyContainer.classList.add('p-6', 'bg-app-surface');
  }

  protected renderBody(): string {
    if (!this.tasks) return '';
    return PipelineStatsView.render(this.tasks);
  }

  public async show(): Promise<void> {
    const showPromise = super.show();
    PipelineStatsView.animateBars(this.dialog);
    await showPromise;
  }
}
