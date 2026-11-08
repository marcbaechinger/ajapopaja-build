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

import { AppNotification, NotificationSeverity } from '../../../../core/domain.ts';
import { NotificationToast } from '../../../components/common/NotificationToast.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';

function showError(title: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  NotificationToast.show(new AppNotification({
    id: `artifact-error:${Date.now()}`,
    severity: NotificationSeverity.ERROR,
    title,
    message,
  }));
}

/**
 * Registers the pipeline header's build and artifact-download actions.
 *
 * A successful build is reported asynchronously by the `BUILD_RUN_COMPLETED`
 * WebSocket event handled in `PipelineRealtimeController`; this action only
 * starts the run, provides immediate disabled-button feedback and reports
 * dispatch failures. Download tokens are minted on demand and the browser is
 * sent to the token-bearing artifact endpoint.
 */
export function registerArtifactActions(ctx: PipelineDetailCtx): void {
  const { actionRegistry } = ctx.context;

  actionRegistry.register('toggle_artifact_details', () => {
    ctx.state.artifactDetailsExpanded = !ctx.state.artifactDetailsExpanded;
    ctx.refresh.header();
  });

  actionRegistry.register('run_build', async (_e, el) => {
    if (ctx.state.buildInProgress) return;

    ctx.state.buildInProgress = true;
    el.setAttribute('disabled', '');
    el.setAttribute('aria-disabled', 'true');
    ctx.refresh.header();

    try {
      const result = await ctx.context.pipelineClient.runBuild(ctx.pipelineId);
      if (result?.status === 'no_commands') {
        ctx.state.buildInProgress = false;
        ctx.refresh.header();
      }
    } catch (error) {
      console.error('Failed to start build:', error);
      ctx.state.buildInProgress = false;
      ctx.refresh.header();
      showError('Build failed to start', error);
    }
  });

  actionRegistry.register('download_artifact', async (_e, el) => {
    const client = ctx.context.pipelineClient;
    el.setAttribute('disabled', '');
    el.classList.add('opacity-60', 'pointer-events-none');

    try {
      const { token } = await client.mintArtifactToken(ctx.pipelineId);
      if (!token) throw new Error('The server did not return a download token.');
      const url = typeof client.artifactDownloadUrl === 'function'
        ? client.artifactDownloadUrl(ctx.pipelineId, token)
        : `/api/pipelines/${ctx.pipelineId}/artifact/download?token=${encodeURIComponent(token)}`;
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      console.error('Failed to download build artifact:', error);
      showError('Artifact download failed', error);
    } finally {
      el.removeAttribute('disabled');
      el.classList.remove('opacity-60', 'pointer-events-none');
    }
  });
}
