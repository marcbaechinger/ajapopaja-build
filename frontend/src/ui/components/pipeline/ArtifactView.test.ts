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

  it('renders the configured artifact path and a missing-build status', () => {
    const info = new BuildArtifactInfo({
      configured: true,
      path: 'dist/app.zip',
      label: 'App bundle',
      exists: false,
      build_commands_configured: true,
    });
    const html = ArtifactView.renderArtifactRow({ pipeline: pipeline(), artifact: info });

    expect(html).toContain('App bundle');
    expect(html).toContain('dist/app.zip');
    expect(html).toContain('Not built yet');
    expect(html).not.toContain('data-action-click="download_artifact"');
  });

  it('renders size, modified time, commit and a download action for an existing artifact', () => {
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

    expect(html).toContain('1.5 KB');
    expect(html).toContain('abcdef1');
    expect(html).toContain('2026');
    expect(html).toContain('data-action-click="download_artifact"');
    expect(html).toContain('Download');
  });

  it('renders nothing when no artifact is configured', () => {
    expect(ArtifactView.renderArtifactRow({ pipeline: pipeline({ build_artifact: null }) })).toBe('');
  });
});
