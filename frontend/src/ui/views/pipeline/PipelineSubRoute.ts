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

import { PipelineRoute, type ContentTab, type PipelineRouteState } from '../../../core/PipelineRoute.ts';

/** How a hash mutation should be applied to the browser history. */
export type HashWriteMode = 'push' | 'replace' | 'none';

/**
 * Pure hash sub-route layer for the pipeline detail view.
 *
 * Parsing/building is delegated to the existing pure `PipelineRoute` value
 * object; this class only owns the hash I/O (`push` vs. `replaceState`) and the
 * equality/idempotency guards. It holds no DOM references and no view state, so
 * the `PipelineDetailView` shell keeps ownership of tab switching, mounts and
 * selection.
 *
 * `Location`/`History` are injectable (defaulting to the globals) to keep the
 * class unit-testable; jsdom supplies both in the browser tests.
 */
export class PipelineSubRoute {
  private readonly pipelineId: string;
  private readonly loc: Location;
  private readonly hist: History;

  constructor(
    pipelineId: string,
    loc: Location = window.location,
    hist: History = window.history,
  ) {
    this.pipelineId = pipelineId;
    this.loc = loc;
    this.hist = hist;
  }

  /** Pure parse; delegates to the existing `PipelineRoute` parser. */
  parse(rest: string | undefined | null): PipelineRouteState {
    return PipelineRoute.parse(rest);
  }

  /** Pure build; delegates to the existing `PipelineRoute` builder. */
  build(tab: ContentTab, fbPath: string | null, taskId: string | null): string {
    return PipelineRoute.build(this.pipelineId, tab, fbPath, taskId);
  }

  /**
   * Pushes (user nav) or replaces (canonicalisation) the pipeline sub-route.
   * `replaceState` never fires `hashchange`, and the equality guard makes the
   * `push` re-entry a no-op, so the route stays idempotent.
   */
  write(mode: HashWriteMode, hash: string): void {
    if (mode === 'none') return;
    if (this.loc.hash === hash) return;
    if (mode === 'push') {
      this.loc.hash = hash;
    } else {
      this.hist.replaceState(null, '', hash);
    }
  }

  /**
   * Canonicalises the current hash once after first mount; never throws.
   * `replaceState` keeps Back pointing at the previous page.
   */
  canonicalise(hash: string): void {
    if (this.loc.hash === hash) return;
    try {
      this.hist.replaceState(null, '', hash);
    } catch {
      /* a hash-only URL must never break the view */
    }
  }
}
