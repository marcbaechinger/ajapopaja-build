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

import type { BuildArtifactInfo, Pipeline } from '../../../core/domain.ts';
import { escapeHtml } from '../utils/html.ts';
import { formatFileSize, formatTimestamp } from '../utils/fileBrowser.ts';

export interface ArtifactViewProps {
  pipeline?: Pipeline | null;
  pipelineId?: string;
  artifact?: BuildArtifactInfo | null;
  artifactInfo?: BuildArtifactInfo | null;
  /** True while a REST-initiated build is running. */
  buildInProgress?: boolean;
  isBuilding?: boolean;
  building?: boolean;
  /** Optional direct build-command declaration when no pipeline is passed. */
  buildCommands?: string[][] | null;
}

function resolveArtifact(props: ArtifactViewProps): BuildArtifactInfo | null {
  return props.artifactInfo ?? props.artifact ?? null;
}

function resolveBuildInProgress(props: ArtifactViewProps): boolean {
  return props.buildInProgress ?? props.isBuilding ?? props.building ?? false;
}

/** Render the build/artifact controls embedded in the pipeline header. */
export class ArtifactView {
  /** Whether the pipeline has at least one configured build command. */
  static hasBuildCommands(pipeline?: Pipeline | null): boolean {
    const commands = pipeline?.build_commands;
    return Array.isArray(commands) && commands.length > 0;
  }

  /**
   * Render the "Build" action. It is intentionally absent when the pipeline
   * has no build commands and is disabled (rather than replaced) while a build
   * is running so the button width stays stable.
   */
  static renderBuildButton(props: ArtifactViewProps): string {
    const hasCommands = ArtifactView.hasBuildCommands(props.pipeline) ||
      (Array.isArray(props.buildCommands) && props.buildCommands.length > 0);
    if (!hasCommands) return '';
    const building = resolveBuildInProgress(props);
    const disabled = building ? ' disabled aria-disabled="true"' : '';
    const label = building ? 'Building...' : 'Build';
    const title = building
      ? 'Build in progress'
      : 'Run the configured build commands';

    return `
      <button
        type="button"
        data-action-click="run_build"
        data-build-button="true"
        class="inline-flex items-center gap-1.5 rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-bold text-app-text hover:border-app-accent-1 hover:text-app-accent-1 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-app-border disabled:hover:text-app-text"
        title="${escapeHtml(title)}"
        ${disabled}
      >${building ? '<span class="relative flex h-2 w-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-app-accent-1 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-app-accent-1"></span></span>' : ''}${label}</button>
    `;
  }

  /**
   * Render the compact artifact status row. The configured path and label are
   * always shown once an artifact is declared; file metadata and the download
   * action only appear when the file currently exists in the workspace.
   */
  static renderArtifactRow(props: ArtifactViewProps): string {
    const pipeline = props.pipeline;
    const info = resolveArtifact(props);
    const spec = pipeline?.build_artifact;
    const path = info?.path || spec?.path || '';
    const configured = info?.configured === true || Boolean(path);
    if (!configured) return '';

    const label = info?.label || spec?.label || '';
    const exists = info?.exists === true;
    const size = info?.size;
    const modifiedAt = info?.modifiedAt ?? (info as any)?.modified_at;
    const version = info?.version || '';
    const shortVersion = version ? version.slice(0, 7) : '';
    const mediaType = info?.media_type || spec?.media_type || '';
    const description = info?.description || spec?.description || '';

    const labelHtml = label
      ? `<span class="font-bold text-app-text">${escapeHtml(label)}</span>`
      : `<span class="font-bold text-app-text">Build artifact</span>`;
    const pathHtml = path
      ? `<span class="font-mono text-[10px] text-app-muted truncate max-w-[28rem]" title="${escapeHtml(path)}">${escapeHtml(path)}</span>`
      : '';
    const descriptionHtml = description
      ? `<span class="text-[10px] text-app-muted truncate max-w-[24rem]" title="${escapeHtml(description)}">${escapeHtml(description)}</span>`
      : '';

    let statusHtml = '';
    if (exists) {
      const sizeHtml = `<span title="Size">${escapeHtml(formatFileSize(size))}</span>`;
      const modifiedHtml = modifiedAt
        ? `<span title="Modified">${escapeHtml(formatTimestamp(String(modifiedAt)))}</span>`
        : '';
      const versionHtml = shortVersion
        ? `<span title="Workspace commit ${escapeHtml(version)}" class="font-mono">${escapeHtml(shortVersion)}</span>`
        : '';
      const mediaHtml = mediaType
        ? `<span class="font-mono" title="Media type">${escapeHtml(mediaType)}</span>`
        : '';
      statusHtml = `
        <span class="text-app-muted/60">·</span>
        ${sizeHtml}
        ${modifiedHtml ? `<span class="text-app-muted/60">·</span>${modifiedHtml}` : ''}
        ${versionHtml ? `<span class="text-app-muted/60">·</span>${versionHtml}` : ''}
        ${mediaHtml ? `<span class="text-app-muted/60">·</span>${mediaHtml}` : ''}
      `;
    } else {
      statusHtml = '<span class="text-amber-500/90">Not built yet</span>';
    }

    const downloadHtml = exists
      ? `<button type="button" data-action-click="download_artifact" class="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-bg px-2.5 py-1 text-[10px] font-bold text-app-text hover:border-app-accent-1 hover:text-app-accent-1 transition-colors cursor-pointer">Download</button>`
      : '';

    return `
      <div class="flex items-center gap-2 min-w-0 rounded-lg border border-app-border bg-app-bg/70 px-2.5 py-1.5" data-build-artifact-row="true">
        <div class="flex flex-col min-w-0 gap-0.5">
          <div class="flex items-center gap-2 min-w-0">
            ${labelHtml}
            ${pathHtml}
          </div>
          ${descriptionHtml}
        </div>
        <div class="flex items-center gap-1.5 text-[10px] text-app-muted whitespace-nowrap ml-1">
          ${statusHtml}
        </div>
        ${downloadHtml}
      </div>
    `;
  }

  /** Combined render helper for callers that want one self-contained block. */
  static render(props: ArtifactViewProps): string {
    const buildButton = ArtifactView.renderBuildButton(props);
    const artifactRow = ArtifactView.renderArtifactRow(props);
    if (!buildButton && !artifactRow) return '';
    return `
      <div class="flex flex-wrap items-center gap-3">
        ${buildButton}
        ${artifactRow}
      </div>
    `;
  }
}
