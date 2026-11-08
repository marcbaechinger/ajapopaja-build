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
import { Icon } from '../common/Icon.ts';

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
  /** Whether the expandable artifact details panel is currently open. */
  expanded?: boolean;
}

function resolveArtifact(props: ArtifactViewProps): BuildArtifactInfo | null {
  return props.artifactInfo ?? props.artifact ?? null;
}

function resolveBuildInProgress(props: ArtifactViewProps): boolean {
  return props.buildInProgress ?? props.isBuilding ?? props.building ?? false;
}

/** Compact build date shown in the always-visible artifact summary. */
function formatBuildDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function renderDetailRow(label: string, value: string): string {
  return `
    <div class="flex items-start gap-2 min-w-0">
      <span class="shrink-0 w-16 pt-px text-[9px] font-black uppercase tracking-wider text-app-muted/60">${escapeHtml(label)}</span>
      <span class="min-w-0 text-app-text">${value}</span>
    </div>
  `;
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
   * Render the compact artifact control. The always-visible summary keeps the
   * header height stable by showing only the artifact label, its build date
   * (or a "not built" state) and the download action. The remaining metadata
   * (path, size, commit, media type and description) lives in a collapsible
   * panel that opens below the summary as an overlay, so expanding it never
   * changes the header's vertical height.
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
    const mediaType = info?.media_type || spec?.media_type || '';
    const description = info?.description || spec?.description || '';
    const expanded = props.expanded === true;

    const labelText = label || 'Build artifact';
    const buildDate = exists ? formatBuildDate(String(modifiedAt)) : '';
    const summaryStatus = exists ? buildDate : 'Not built yet';
    const chevron = Icon.render('chevronDown', {
      size: 12,
      className: expanded
        ? 'rotate-180 transition-transform shrink-0'
        : 'transition-transform shrink-0',
    });

    const labelHtml = `
      <button
        type="button"
        data-action-click="toggle_artifact_details"
        aria-expanded="${expanded ? 'true' : 'false'}"
        title="${expanded ? 'Hide artifact details' : 'Show artifact details'}"
        class="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold text-app-text hover:text-app-accent-1 transition-colors cursor-pointer"
      ><span class="truncate max-w-[12rem]">${escapeHtml(labelText)}</span>${chevron}</button>
    `;

    const downloadHtml = exists
      ? `<button type="button" data-action-click="download_artifact" class="inline-flex items-center rounded-md border border-app-border bg-app-bg px-2 py-0.5 text-[10px] font-bold text-app-text hover:border-app-accent-1 hover:text-app-accent-1 transition-colors cursor-pointer shrink-0">Download</button>`
      : '';

    let detailRows = '';
    if (path) {
      detailRows += renderDetailRow(
        'Path',
        `<span class="font-mono break-all">${escapeHtml(path)}</span>`,
      );
    }
    if (description) {
      detailRows += renderDetailRow(
        'Description',
        `<span class="break-all">${escapeHtml(description)}</span>`,
      );
    }
    if (exists) {
      if (size !== null && size !== undefined) {
        detailRows += renderDetailRow('Size', escapeHtml(formatFileSize(size)));
      }
      if (modifiedAt) {
        detailRows += renderDetailRow(
          'Built',
          escapeHtml(formatTimestamp(String(modifiedAt))),
        );
      }
      if (version) {
        detailRows += renderDetailRow(
          'Commit',
          `<span class="font-mono break-all">${escapeHtml(version)}</span>`,
        );
      }
      if (mediaType) {
        detailRows += renderDetailRow(
          'Type',
          `<span class="font-mono break-all">${escapeHtml(mediaType)}</span>`,
        );
      }
    } else {
      detailRows += '<div class="font-bold text-amber-500/90">Not built yet</div>';
    }

    const detailsHtml = `
      <div class="absolute left-0 top-full z-50 mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-app-border bg-app-surface p-3 shadow-xl ${expanded ? '' : 'hidden'}" data-artifact-details="true">
        <div class="flex flex-col gap-1.5 text-[10px] text-app-muted">
          ${detailRows}
        </div>
      </div>
    `;

    return `
      <div class="relative inline-flex items-center min-w-0" data-build-artifact-row="true">
        <div class="flex items-center gap-2 min-w-0 rounded-lg border border-app-border bg-app-bg/70 py-1 pl-1 pr-2">
          ${labelHtml}
          <span class="${exists ? 'text-app-muted' : 'text-amber-500/90'} text-[10px] whitespace-nowrap shrink-0">${escapeHtml(summaryStatus)}</span>
          ${downloadHtml}
        </div>
        ${detailsHtml}
      </div>
    `;
  }

  /** Combined render helper for callers that want one self-contained block. */
  static render(props: ArtifactViewProps): string {
    const buildButton = ArtifactView.renderBuildButton(props);
    const artifactRow = ArtifactView.renderArtifactRow(props);
    if (!buildButton && !artifactRow) return '';
    return `
      <div class="flex items-center gap-2 min-w-0">
        ${buildButton}
        ${artifactRow}
      </div>
    `;
  }
}
