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

import { describe, it, expect, beforeEach } from 'vitest';
import { Navigator, View } from './Navigator';

class MockView implements View {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
  render() {
    const el = document.createElement('div');
    el.id = `view-${this.id}`;
    el.textContent = `Content ${this.id}`;
    return el;
  }
}

describe('Navigator', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    container = document.getElementById('app')!;
    window.location.hash = '';
  });

  it('should register and navigate to a route', async () => {
    const navigator = new Navigator('app');
    navigator.register('/', () => new MockView('home'));
    
    navigator.start();
    
    expect(container.querySelector('#view-home')).toBeTruthy();
    expect(container.textContent).toBe('Content home');
  });

  it('should match parameterized routes', async () => {
    const navigator = new Navigator('app');
    let capturedId = '';
    
    navigator.register('/pipeline/:id', (params) => {
      capturedId = params.id;
      return new MockView(params.id);
    });

    window.location.hash = '#/pipeline/123';
    navigator.start();

    expect(capturedId).toBe('123');
    expect(container.querySelector('#view-123')).toBeTruthy();
  });
});

class UpdateView implements View {
  renders = 0;
  mounts = 0;
  unmounts = 0;
  updates: Array<Record<string, string>> = [];
  readonly id: string;
  private result: boolean;

  constructor(id: string, result: boolean) {
    this.id = id;
    this.result = result;
  }

  render() {
    this.renders++;
    const el = document.createElement('div');
    el.id = `update-view-${this.id}`;
    return el;
  }

  mount() {
    this.mounts++;
  }

  unmount() {
    this.unmounts++;
  }

  update(params: Record<string, string>): boolean {
    this.updates.push(params);
    return this.result;
  }
}

describe('Navigator trailing splat', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    container = document.getElementById('app')!;
    window.location.hash = '';
  });

  it('captures zero, one and many remaining segments into params.rest', () => {
    const navigator = new Navigator('app');
    const seen: Array<Record<string, string>> = [];
    navigator.register('/pipeline/:id/*', (params) => {
      seen.push(params);
      return new MockView(params.id);
    });

    window.location.hash = '#/pipeline/p1';
    navigator.start();
    window.location.hash = '#/pipeline/p1/tab';
    navigator.start();
    window.location.hash = '#/pipeline/p1/tab/fb/a/b';
    navigator.start();

    expect(seen[0]).toEqual({ id: 'p1', rest: '' });
    expect(seen[1]).toEqual({ id: 'p1', rest: 'tab' });
    expect(seen[2]).toEqual({ id: 'p1', rest: 'tab/fb/a/b' });
  });

  it('still matches the bare route with a splat pattern', () => {
    const navigator = new Navigator('app');
    navigator.register('/pipeline/:id/*', (params) => new MockView(params.id));

    window.location.hash = '#/pipeline/42';
    navigator.start();

    expect(container.querySelector('#view-42')).toBeTruthy();
  });

  it('reuses the same view in place when update() returns true', () => {
    const view = new UpdateView('p1', true);
    const navigator = new Navigator('app');
    navigator.register('/pipeline/:id/*', () => view);

    window.location.hash = '#/pipeline/p1/tab/task';
    navigator.start();
    expect(view.renders).toBe(1);
    expect(view.mounts).toBe(1);
    expect(view.unmounts).toBe(0);

    window.location.hash = '#/pipeline/p1/tab/fb';
    navigator.start();

    expect(view.updates).toEqual([{ id: 'p1', rest: 'tab/fb' }]);
    expect(view.renders).toBe(1);
    expect(view.mounts).toBe(1);
    expect(view.unmounts).toBe(0);
  });

  it('re-creates the view when update() returns false', () => {
    const view = new UpdateView('p1', false);
    const navigator = new Navigator('app');
    navigator.register('/pipeline/:id/*', () => view);

    window.location.hash = '#/pipeline/p1/tab/task';
    navigator.start();
    window.location.hash = '#/pipeline/p1/tab/fb';
    navigator.start();

    expect(view.updates.length).toBe(1);
    expect(view.renders).toBe(2);
    expect(view.mounts).toBe(2);
    expect(view.unmounts).toBe(1);
  });

  it('re-creates the view when a different pattern matches', () => {
    const view = new UpdateView('p1', true);
    const navigator = new Navigator('app');
    navigator.register('/pipeline/:id/*', () => view);
    navigator.register('/other/:id', (params) => new MockView(`other-${params.id}`));

    window.location.hash = '#/pipeline/p1/tab/task';
    navigator.start();
    window.location.hash = '#/other/p1';
    navigator.start();

    expect(view.updates.length).toBe(0);
    expect(view.unmounts).toBe(1);
    expect(container.querySelector('#view-other-p1')).toBeTruthy();
  });
});
