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

import { BaseDialog } from '../components/dialogs/dialog_common.ts';
import { Icon } from '../components/common/Icon.ts';

/**
 * Onboarding guides for the two entry points of the app.
 *
 * - {@link renderGettingStartedGuide} is the empty-state “readme” of the
 *   dashboard. It is rendered inline while no pipeline exists and can be
 *   reopened as an overlay (via the *Guide* button in the pipeline header) once
 *   pipelines are present.
 * - {@link renderPipelineGettingStartedGuide} is the pipeline workbench guide.
 *   It is the landing tab while the pipeline has no tasks (or no task is
 *   selected) and can also be reopened as a wide-but-readable overlay.
 *
 * Both guides are served as **static HTML files** (`/getting-started/*.html`)
 * and fetched on demand the first time they are shown. The fetch is cached, so
 * switching tabs or reopening the overlay never reloads the markup. Only the
 * rendered DOM contract is public: the same `data-action-click` hooks, blueprint
 * prompt ids and Tailwind classes as before. The static files carry two
 * placeholders that are substituted per variant:
 *
 * - `{{CREATE_ACTION}}` – the dashboard hero button (`create_pipeline` inline,
 *   `create_pipeline_from_guide` inside the overlay).
 * - `{{PROMPT_ID_PREFIX}}` – namespaces the blueprint prompt ids so the inline
 *   pipeline tab and the overlay never collide in the DOM.
 *
 * The owning views register the action handlers and delegate clicks through the
 * shared action registry (`create_pipeline`, `create_pipeline_from_guide`,
 * `open_getting_started`, `focus_new_task`, `copy_project_prompt`,
 * `toggle_assistant`).
 */

/** Which of the two getting-started pages to load. */
export type GettingStartedGuideKind = 'dashboard' | 'pipeline';

/** `inline` renders inside a view; `dialog` renders inside the overlay. */
export type GettingStartedVariant = 'inline' | 'dialog';

const GUIDE_URLS: Record<GettingStartedGuideKind, string> = {
  dashboard: '/getting-started/dashboard.html',
  pipeline: '/getting-started/pipeline.html',
};

/**
 * Raw, placeholder-bearing markup per guide. The first request is cached as a
 * promise so concurrent callers share a single fetch and later callers reuse
 * the already loaded content.
 */
const guideCache = new Map<GettingStartedGuideKind, Promise<string>>();

/** Loads a guide's static HTML from the server, fetching it at most once. */
function loadGuide(kind: GettingStartedGuideKind): Promise<string> {
  const cached = guideCache.get(kind);
  if (cached) return cached;

  const request = fetch(GUIDE_URLS[kind]).then((response) => {
    if (!response.ok) {
      throw new Error(
        `Failed to load the ${kind} getting started guide (HTTP ${response.status})`
      );
    }
    return response.text();
  });
  // Failures are not cached so a later call can retry.
  request.catch(() => guideCache.delete(kind));
  guideCache.set(kind, request);
  return request;
}

/** Drops the cached guide markup. Exposed for tests and hot reloads. */
export function resetGettingStartedGuideCache(): void {
  guideCache.clear();
}

/** Small spinner shown while a guide is being fetched. */
export function renderGettingStartedLoading(): string {
  return `
    <div class="flex items-center justify-center p-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-app-accent-1"></div>
    </div>
  `;
}

/**
 * Returns the dashboard onboarding page markup.
 *
 * @param variant `inline` renders the empty-state page inside the dashboard;
 * `dialog` renders the same content inside an overlay and routes the primary
 * button through the dashboard so the guide is dismissed before the creation
 * dialog opens.
 */
export async function renderGettingStartedGuide(
  variant: GettingStartedVariant = 'inline'
): Promise<string> {
  const html = await loadGuide('dashboard');
  const createAction = variant === 'dialog' ? 'create_pipeline_from_guide' : 'create_pipeline';
  return html.replaceAll('{{CREATE_ACTION}}', createAction);
}

/**
 * Returns the pipeline onboarding page markup.
 *
 * @param variant `inline` renders the page as the Getting Started tab inside
 * the PipelineDetailView; `dialog` renders the same content in the manual
 * overlay. The blueprint prompt ids are namespaced per variant so the inline
 * tab and the overlay never collide in the DOM.
 */
export async function renderPipelineGettingStartedGuide(
  variant: GettingStartedVariant = 'inline'
): Promise<string> {
  const html = await loadGuide('pipeline');
  const idPrefix = variant === 'dialog' ? 'pipeline-dialog-prompt' : 'pipeline-prompt';
  return html.replaceAll('{{PROMPT_ID_PREFIX}}', idPrefix);
}

/**
 * Shared overlay wrapper for both guides. The body starts as a loading spinner
 * and is replaced with the cached static markup once the fetch resolves, so the
 * overlay can open immediately without blocking on the network.
 */
abstract class GettingStartedDialogBase extends BaseDialog<void> {
  protected abstract readonly guideKind: GettingStartedGuideKind;

  constructor(options: { title: string; maxWidth: string }) {
    super({
      title: options.title,
      maxWidth: options.maxWidth,
      maxHeight: 'max-h-[85vh]',
      iconSvg: Icon.render('documentation', { size: 20 }),
    });
  }

  protected renderBody(): string {
    return renderGettingStartedLoading();
  }

  public show(): Promise<void | null> {
    void this.loadBody();
    return super.show();
  }

  private async loadBody(): Promise<void> {
    const body = this.dialog.querySelector('#dialog-body-container');
    if (!body) return;
    try {
      const html =
        this.guideKind === 'dashboard'
          ? await renderGettingStartedGuide('dialog')
          : await renderPipelineGettingStartedGuide('dialog');
      body.innerHTML = `<div class="p-6">${html}</div>`;
    } catch (error) {
      console.error('Failed to load the getting started guide:', error);
      body.innerHTML = `<p class="p-6 text-red-400">Failed to load the getting started guide.</p>`;
    }
  }
}

/**
 * Overlay wrapper around {@link renderGettingStartedGuide}. Used once pipelines
 * already exist so the reference remains available without occupying the
 * dashboard.
 */
export class GettingStartedDialog extends GettingStartedDialogBase {
  protected readonly guideKind = 'dashboard' as const;

  constructor() {
    super({ title: 'Getting Started', maxWidth: 'max-w-4xl' });
  }

  /** Closes the overlay. Public so the dashboard can dismiss it before opening the create dialog. */
  public dismiss(): void {
    this.close();
  }
}

/**
 * Overlay wrapper around {@link renderPipelineGettingStartedGuide}. Keeps the
 * onboarding reference available after the first tasks exist without occupying
 * a tab.
 *
 * The width is deliberately capped at `max-w-3xl`: wide enough for the two-up
 * card grids, but narrow enough to stay comfortable to read.
 */
export class PipelineGettingStartedDialog extends GettingStartedDialogBase {
  protected readonly guideKind = 'pipeline' as const;

  constructor() {
    super({ title: 'Pipeline Getting Started', maxWidth: 'max-w-3xl' });
  }
}
