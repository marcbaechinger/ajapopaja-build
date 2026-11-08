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
import { ArtifactView } from './ArtifactView.ts';
import { BuildArtifactInfo, Pipeline } from '../../../core/domain.ts';

function pipeline(overrides: Record<string, any> = {}): Pipeline {
  return new Pipeline({
    id: 'p1',
    name: 'Test',
    build_commands: [['make', 'build']],
    build_artifact: { path: 'dist/app.zip', label: 'App bundle' },
    ...overrides,
  });
}

describe('ArtifactView', () => {
  it('renders no build button when build_commands are absent or empty', () => {
    expect(ArtifactView.renderBuildButton({ pipeline: pipeline({ build_commands: null }) })).toBe('');
    expect(ArtifactView.renderBuildButton({ pipeline: pipeline({ build_commands: [] }) })).toBe('');
  });

  it('renders an enabled build button and disables it while building', () => {
    const ready = ArtifactView.renderBuildButton({ pipeline: pipeline() });
    expect(ready).toContain('data-action-click="run_build"');
    expect(ready).toContain('>Build</button>');
    expect(ready).not.toContain(' disabled aria-disabled="true"');

    const building = ArtifactView.renderBuildButton({
      pipeline: pipeline(),
      buildInProgress: true,
    });
    expect(building).toContain('Building...');
    expect(building).toContain('disabled');
  });

  it('shows only the label and a missing-build status by default', () => {
    const info = new BuildArtifactInfo({
      configured: true,
      path: 'dist/app.zip',
      label: 'App bundle',
      exists: false,
      build_commands_configured: true,
    });
    const html = ArtifactView.renderArtifactRow({ pipeline: pipeline(), artifact: info });

    expect(html).toContain('App bundle');
    expect(html).toContain('Not built yet');
    expect(html).toContain('data-action-click="toggle_artifact_details"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-artifact-details="true"');
    expect(html).toContain('shadow-xl hidden"');
    expect(html).not.toContain('data-action-click="download_artifact"');
  });

  it('shows the label, build date and download action by default', () => {
    const info = new BuildArtifactInfo({
      configured: true,
      path: 'dist/app.zip',
      label: 'App bundle',
      exists: true,
      size: 1536,
      modified_at: '2026-01-02T03:04:05Z',
      version: 'abcdef1234567890',
    });
    const html = ArtifactView.renderArtifactRow({ pipeline: pipeline(), artifact: info });

    expect(html).toContain('App bundle');
    expect(html).toContain('2026');
    expect(html).toContain('data-action-click="download_artifact"');
    expect(html).toContain('Download');
    expect(html).toContain('shadow-xl hidden"');
  });

  it('reveals metadata in an overlay when expanded', () => {
    const info = new BuildArtifactInfo({
      configured: true,
      path: 'dist/app.zip',
      label: 'App bundle',
      description: 'Production bundle',
      exists: true,
      size: 1536,
      modified_at: '2026-01-02T03:04:05Z',
      version: 'abcdef1234567890',
    });
    const html = ArtifactView.renderArtifactRow({
      pipeline: pipeline(),
      artifact: info,
      expanded: true,
    });

    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('shadow-xl hidden"');
    expect(html).toContain('dist/app.zip');
    expect(html).toContain('1.5 KB');
    expect(html).toContain('abcdef1234567890');
    expect(html).toContain('Production bundle');
  });

  it('renders nothing when no artifact is configured', () => {
    expect(ArtifactView.renderArtifactRow({ pipeline: pipeline({ build_artifact: null }) })).toBe('');
  });

  it('renders the build button and artifact row together', () => {
    const info = new BuildArtifactInfo({
      configured: true,
      path: 'dist/app.zip',
      label: 'App bundle',
      exists: true,
      size: 2048,
    });

    const html = ArtifactView.render({ pipeline: pipeline(), artifact: info });

    expect(html).toContain('data-action-click="run_build"');
    expect(html).toContain('data-build-artifact-row="true"');
    expect(html).toContain('data-action-click="download_artifact"');
  });

  it('renders only the build button when no artifact is declared', () => {
    const html = ArtifactView.render({
      pipeline: pipeline({ build_artifact: null }),
    });

    expect(html).toContain('data-action-click="run_build"');
    expect(html).not.toContain('data-build-artifact-row="true"');
  });

  it('supports a direct buildCommands declaration and escapes display text', () => {
    const info = new BuildArtifactInfo({
      configured: true,
      path: 'dist/<app>.zip',
      label: '<script>alert(1)</script>',
      exists: false,
    });

    const button = ArtifactView.renderBuildButton({
      buildCommands: [['make', 'build']],
    });
    expect(button).toContain('data-action-click="run_build"');

    const html = ArtifactView.renderArtifactRow({ artifact: info, expanded: true });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('dist/&lt;app&gt;.zip');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
