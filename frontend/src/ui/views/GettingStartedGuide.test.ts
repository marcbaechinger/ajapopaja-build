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

import { describe, it, expect } from 'vitest';
import {
  renderPipelineGettingStartedGuide,
  PipelineGettingStartedDialog,
} from './GettingStartedGuide.ts';

describe('renderPipelineGettingStartedGuide', () => {
  it('starts with the jump-start project blueprints from the dashboard guide', () => {
    const html = renderPipelineGettingStartedGuide();
    expect(html).toContain('Jump-start a new project');
    expect(html).toContain('React single-page app');
    expect(html).toContain('React + Python API');
    expect(html).toContain('Python CLI with Rich UI');
  });

  it('explains the SpecBot → ArchBot → CoderBot → ReviewBot workflow', () => {
    const html = renderPipelineGettingStartedGuide();
    expect(html).toContain('Sharpen the spec with SpecBot');
    expect(html).toContain('Design with ArchBot');
    expect(html).toContain('Implement with CoderBot');
    expect(html).toContain('Review with ReviewBot');
    // Design docs are versioned and can be rolled back.
    expect(html).toContain('versioned');
    expect(html).toContain('roll back');
    // CoderBot work is queued and serialized.
    expect(html).toContain('queued and executed sequentially');
    // Models are chosen in the pipeline properties dialog.
    expect(html).toContain('pipeline properties');
  });

  it('describes the task lifecycle and every workbench tab', () => {
    const html = renderPipelineGettingStartedGuide();
    for (const stage of ['Backlog', 'Proposed design', 'Scheduled', 'In progress', 'Submitted']) {
      expect(html).toContain(stage);
    }
    expect(html).toContain('Task editor');
    expect(html).toContain('Coding Agent');
    expect(html).toContain('File Browser');
    expect(html).toContain('Commits');
    expect(html).toContain('DiffView');
    expect(html).toContain('filename search');
  });

  it('keeps every lifecycle badge legend on a single line', () => {
    const html = renderPipelineGettingStartedGuide();
    // Legends must never wrap or the badges fall out of vertical alignment.
    expect(html).toContain('text-[10px] text-app-muted leading-tight whitespace-nowrap');
    // Optional stages are marked with a footnote instead of inline wording.
    expect(html).not.toContain('optionally');
    expect(html).not.toContain('Optional design doc');
    expect(html).toContain('* Optional step');
  });

  it('covers creating tasks and the MCP integration', () => {
    const html = renderPipelineGettingStartedGuide();
    expect(html).toContain('Create tasks in seconds');
    expect(html).toContain('Ask the Assistant');
    expect(html).toContain('ajapopaja MCP');
    expect(html).toContain('External coding agents');
    expect(html).toContain('Model Context Protocol');
  });

  it('exposes the create-task CTA and copy-prompt action hooks', () => {
    const html = renderPipelineGettingStartedGuide();
    expect(html).toContain('data-action-click="focus_new_task"');
    expect(html).toContain('data-action-click="copy_project_prompt"');
    expect(html).toContain('data-action-click="toggle_assistant"');
  });

  it('namespaces the blueprint prompt ids per variant to avoid DOM collisions', () => {
    expect(renderPipelineGettingStartedGuide('inline')).toContain('id="pipeline-prompt-react-spa"');
    expect(renderPipelineGettingStartedGuide('dialog')).toContain(
      'id="pipeline-dialog-prompt-react-spa"'
    );
  });
});

describe('PipelineGettingStartedDialog', () => {
  it('renders the pipeline guide body at a readable width', () => {
    const dialog = new PipelineGettingStartedDialog();
    const el = (dialog as any).dialog as HTMLDialogElement;
    expect(el.querySelector('#dialog-body-container')?.innerHTML).toContain(
      'Jump-start a new project'
    );
    expect(el.querySelector('.dialog-content')?.className).toContain('max-w-3xl');
  });
});
