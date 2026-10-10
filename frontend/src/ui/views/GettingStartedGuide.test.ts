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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  renderGettingStartedGuide,
  renderPipelineGettingStartedGuide,
  resetGettingStartedGuideCache,
  PipelineGettingStartedDialog,
} from './GettingStartedGuide.ts';
import {
  installGettingStartedFetchMock,
  flushPromises,
} from './gettingStartedTestFixtures.ts';

describe('renderPipelineGettingStartedGuide', () => {
  let fetchMock: ReturnType<typeof installGettingStartedFetchMock>;

  beforeEach(() => {
    resetGettingStartedGuideCache();
    fetchMock = installGettingStartedFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with the jump-start project blueprints from the dashboard guide', async () => {
    const html = await renderPipelineGettingStartedGuide();
    expect(html).toContain('Jump-start a new project');
    expect(html).toContain('React single-page app');
    expect(html).toContain('React + Python API');
    expect(html).toContain('Python CLI with Rich UI');
  });

  it('explains the SpecBot → ArchBot → CoderBot → ReviewBot workflow', async () => {
    const html = await renderPipelineGettingStartedGuide();
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

  it('describes the task lifecycle and every workbench tab', async () => {
    const html = await renderPipelineGettingStartedGuide();
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

  it('keeps every lifecycle badge legend on a single line', async () => {
    const html = await renderPipelineGettingStartedGuide();
    // Legends must never wrap or the badges fall out of vertical alignment.
    expect(html).toContain('text-[10px] text-app-muted leading-tight whitespace-nowrap');
    // Optional stages are marked with a footnote instead of inline wording.
    expect(html).not.toContain('optionally');
    expect(html).not.toContain('Optional design doc');
    expect(html).toContain('* Optional step');
  });

  it('covers creating tasks and the MCP integration', async () => {
    const html = await renderPipelineGettingStartedGuide();
    expect(html).toContain('Create tasks in seconds');
    expect(html).toContain('Ask the Assistant');
    expect(html).toContain('ajapopaja MCP');
    expect(html).toContain('External coding agents');
    expect(html).toContain('Model Context Protocol');
  });

  it('exposes the create-task CTA and copy-prompt action hooks', async () => {
    const html = await renderPipelineGettingStartedGuide();
    expect(html).toContain('data-action-click="focus_new_task"');
    expect(html).toContain('data-action-click="copy_project_prompt"');
    expect(html).toContain('data-action-click="toggle_assistant"');
  });

  it('namespaces the blueprint prompt ids per variant to avoid DOM collisions', async () => {
    expect(await renderPipelineGettingStartedGuide('inline')).toContain(
      'id="pipeline-prompt-react-spa"'
    );
    expect(await renderPipelineGettingStartedGuide('dialog')).toContain(
      'id="pipeline-dialog-prompt-react-spa"'
    );
  });

  it('loads each static guide from the server only once', async () => {
    await renderPipelineGettingStartedGuide();
    await renderPipelineGettingStartedGuide('dialog');
    await renderGettingStartedGuide();
    await renderGettingStartedGuide('dialog');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/getting-started/dashboard.html');
    expect(fetchMock).toHaveBeenCalledWith('/getting-started/pipeline.html');
  });

  it('routes the dashboard hero through the variant-specific create action', async () => {
    expect(await renderGettingStartedGuide('inline')).toContain(
      'data-action-click="create_pipeline"'
    );
    expect(await renderGettingStartedGuide('dialog')).toContain(
      'data-action-click="create_pipeline_from_guide"'
    );
  });
});

describe('PipelineGettingStartedDialog', () => {
  beforeEach(() => {
    resetGettingStartedGuideCache();
    installGettingStartedFetchMock();
    // JSDOM does not implement the native dialog methods.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the pipeline guide body at a readable width', async () => {
    const dialog = new PipelineGettingStartedDialog();
    void dialog.show();
    await flushPromises();

    const el = (dialog as any).dialog as HTMLDialogElement;
    expect(el.querySelector('#dialog-body-container')?.innerHTML).toContain(
      'Jump-start a new project'
    );
    expect(el.querySelector('.dialog-content')?.className).toContain('max-w-3xl');

    (el.querySelector('#dialog-close-btn') as HTMLElement).click();
  });
});
