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

/**
 * Value object for the sub-route of a pipeline detail view.
 *
 * The navigator registers the stable pattern `/pipeline/:id/*`; everything
 * after `:id` is handed over as `params.rest` and parsed here. Keeping all
 * hash string-munging in one pure, unit-testable place means the large
 * `PipelineDetailView` never has to split or encode URLs itself.
 *
 * Grammar (see `design/dd_spa_architecture.md` §6):
 *
 *   #/pipeline/<id>                       -> task editor (default)
 *   #/pipeline/<id>/tab/task              -> task editor
 *   #/pipeline/<id>/tab/agent             -> coding agent
 *   #/pipeline/<id>/tab/fb                -> file browser, persisted last path
 *   #/pipeline/<id>/tab/fb/               -> file browser, repository root
 *   #/pipeline/<id>/tab/fb/path/to/folder -> file browser, that directory
 *   #/pipeline/<id>/tab/fb/path/file.html -> file browser, that file
 *
 * The trailing file-browser path is a repo-relative POSIX path, encoded per
 * segment. It is opaque to the router: whether the last segment names a file
 * or a directory is resolved at apply time with a single `getMeta()` call.
 */

export type ContentTab = 'task-editor' | 'coding-agent' | 'file-browser';

export const TAB_SLUG_TO_TAB: Record<string, ContentTab> = {
  task: 'task-editor',
  agent: 'coding-agent',
  fb: 'file-browser',
};

export const TAB_TO_SLUG: Record<ContentTab, string> = {
  'task-editor': 'task',
  'coding-agent': 'agent',
  'file-browser': 'fb',
};

export interface PipelineRouteState {
  /** Active content tab; unknown/missing segments fall back to `task-editor`. */
  tab: ContentTab;
  /**
   * Explicit repo-relative file-browser path. `null` means "no explicit path"
   * (fall back to the persisted last path), `''` means the repository root.
   */
  fbPath: string | null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // A malformed %-escape must never throw; keep the raw segment.
    return segment;
  }
}

export class PipelineRoute {
  /**
   * Parses the `rest` captured by the `/pipeline/:id/*` splat into the tab and
   * (optional) file-browser path. Never throws.
   */
  static parse(rest: string | undefined | null): PipelineRouteState {
    const state: PipelineRouteState = { tab: 'task-editor', fbPath: null };
    if (!rest) return state;

    const hadTrailingSlash = /\/+$/.test(rest);
    const parts = rest.split('/').filter((p) => p !== '');
    if (parts.length === 0 || parts[0] !== 'tab') return state;

    const slug = parts[1];
    const tab = slug ? TAB_SLUG_TO_TAB[slug] : undefined;
    if (tab) state.tab = tab;

    if (parts.length > 2) {
      state.fbPath = parts.slice(2).map(decodeSegment).join('/');
    } else if (hadTrailingSlash && parts[1] === 'fb') {
      // `tab/fb/` is the canonical encoding of the explicit repository root,
      // distinct from `tab/fb` ("no explicit path").
      state.fbPath = '';
    }

    return state;
  }

  /**
   * Builds a canonical, shortest hash for the given pipeline sub-state.
   * `null`/omitted `fbPath` emits `#/pipeline/<id>/tab/<slug>` (no trailing
   * slash); `''` emits the explicit-root form `#/pipeline/<id>/tab/fb/`.
   */
  static build(pipelineId: string, tab: ContentTab, fbPath?: string | null): string {
    const slug = TAB_TO_SLUG[tab] ?? TAB_TO_SLUG['task-editor'];
    let hash = `#/pipeline/${pipelineId}/tab/${slug}`;
    if (tab === 'file-browser' && fbPath !== null && fbPath !== undefined) {
      if (fbPath === '') {
        hash += '/';
      } else {
        const encoded = fbPath
          .split('/')
          .filter((segment) => segment !== '')
          .map((segment) => encodeURIComponent(segment))
          .join('/');
        hash += `/${encoded}`;
      }
    }
    return hash;
  }
}
