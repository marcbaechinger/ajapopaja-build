import './style.css'

console.log('Ajapopaja Build SPA Initialized');

const API_BASE = 'http://localhost:8000';
const form = document.getElementById('create-pipeline') as HTMLFormElement;
const list = document.getElementById('pipeline-list') as HTMLDivElement;
const themeToggle = document.getElementById('theme-toggle');

// Theme Toggling logic
themeToggle?.addEventListener('click', () => {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
});

// Helper to render a pipeline item
const renderPipeline = (name: string) => {
  if (list.querySelector('p')) {
    list.innerHTML = '';
  }

  const item = document.createElement('div');
  item.className = 'bg-app-bg p-3 rounded-lg border border-app-border flex justify-between items-center transition-all hover:border-app-accent-1 cursor-pointer';
  item.innerHTML = `
    <span class="font-medium text-app-text">${name}</span>
    <span class="text-xs bg-app-surface px-2 py-1 rounded text-app-muted border border-app-border capitalize">active</span>
  `;
  list.appendChild(item);
};

// Fetch and display pipelines from the API
const fetchPipelines = async () => {
  try {
    const response = await fetch(`${API_BASE}/pipelines`);
    if (!response.ok) throw new Error('Failed to fetch pipelines');
    const pipelines = await response.json();
    
    if (pipelines.length > 0) {
      list.innerHTML = '';
      pipelines.forEach((p: any) => renderPipeline(p.name));
    }
  } catch (error) {
    console.error('Error fetching pipelines:', error);
  }
};

// Create a new pipeline via the API
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = form.querySelector('input') as HTMLInputElement;
  const name = input.value;
  if (!name) return;

  try {
    const response = await fetch(`${API_BASE}/pipelines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    if (!response.ok) throw new Error('Failed to create pipeline');
    
    const newPipeline = await response.json();
    renderPipeline(newPipeline.name);
    input.value = '';
  } catch (error) {
    console.error('Error creating pipeline:', error);
    alert('Failed to create pipeline in the database.');
  }
});

// Initialize on page load
fetchPipelines();
