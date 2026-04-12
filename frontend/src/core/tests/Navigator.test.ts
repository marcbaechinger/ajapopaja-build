import { describe, it, expect, beforeEach } from 'vitest';
import { Navigator, View } from '../Navigator';

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
