// frontend/src/ui/components/DocBotDialog.ts
import { AppContext } from '../../core/AppContext';

export interface DocBotDialogProps {
  taskId: string;
  pipelineId: string;
  diff: string;
  commitMsg: string;
  filename: string;
  onClose: () => void;
  onSuccess: () => void;
  context: AppContext;
}

export class DocBotDialog {
  private container: HTMLElement;
  private props: DocBotDialogProps;

  constructor(container: HTMLElement, props: DocBotDialogProps) {
    this.container = container;
    this.props = props;
    this.render();
  }

  private async handleCommit() {
    const input = this.container.querySelector('#commit-msg-input') as HTMLTextAreaElement;
    const msg = input.value.trim();
    if (!msg) return;

    const commitBtn = this.container.querySelector('#docbot-commit-btn') as HTMLButtonElement;
    commitBtn.disabled = true;
    commitBtn.textContent = 'Committing...';

    try {
      await this.props.context.docBotClient.commitChanges(
        this.props.pipelineId,
        this.props.taskId,
        msg
      );

      this.props.onSuccess();
      this.props.onClose();
    } catch (error) {
      console.error('Error committing DocBot changes:', error);
      alert('Failed to commit changes. Please check the console.');
      commitBtn.disabled = false;
      commitBtn.textContent = 'Commit Changes';
    }
  }

  private async handleRevert() {
    if (!confirm('Are you sure you want to revert these changes? This action cannot be undone.')) {
      return;
    }

    const revertBtn = this.container.querySelector('#docbot-revert-btn') as HTMLButtonElement;
    revertBtn.disabled = true;
    revertBtn.textContent = 'Reverting...';

    try {
      await this.props.context.docBotClient.revertChanges(
        this.props.pipelineId,
        this.props.taskId
      );

      this.props.onSuccess();
      this.props.onClose();
    } catch (error) {
      console.error('Error reverting DocBot changes:', error);
      alert('Failed to revert changes. Please check the console.');
      revertBtn.disabled = false;
      revertBtn.textContent = 'Revert Changes';
    }
  }

  private async handleCancel() {
     try {
      // Notify backend we are cancelling
      await this.props.context.docBotClient.cancelReview(
        this.props.pipelineId,
        this.props.taskId
      );
      this.props.onClose();
    } catch (error) {
       console.error('Error cancelling DocBot review:', error);
       this.props.onClose();
    }
  }

  public render() {
    this.container.innerHTML = `
      <div class="fixed inset-0 bg-black/50 bg-opacity-50 flex items-center justify-center z-50 p-4 text-gray-900">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
          <div class="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
            <h2 class="text-xl font-bold text-gray-800">DocBot Review: ${this.props.filename}</h2>
            <button id="docbot-close-btn" class="text-gray-500 hover:text-gray-700">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          
          <div class="p-4 flex-1 overflow-auto flex flex-col gap-4">
            <div>
              <h3 class="text-sm font-semibold text-gray-700 mb-2">Proposed Changes</h3>
              <div class="bg-gray-50 border rounded-md p-4 overflow-x-auto font-mono text-sm whitespace-pre">
                ${this.formatDiff(this.props.diff)}
              </div>
            </div>
            
            <div class="mt-4">
              <label for="commit-msg-input" class="block text-sm font-semibold text-gray-700 mb-2">Commit Message</label>
              <textarea 
                id="commit-msg-input" 
                class="w-full border rounded-md p-2 font-mono text-sm h-24 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >${this.props.commitMsg}</textarea>
            </div>
          </div>
          
          <div class="p-4 border-t bg-gray-50 rounded-b-lg flex justify-between items-center">
            <button id="docbot-revert-btn" class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium">
              Revert Changes
            </button>
            <div class="flex gap-2">
              <button id="docbot-cancel-btn" class="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500 font-medium">
                Cancel
              </button>
              <button id="docbot-commit-btn" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 font-medium">
                Commit Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.container.querySelector('#docbot-close-btn')?.addEventListener('click', () => this.handleCancel());
    this.container.querySelector('#docbot-cancel-btn')?.addEventListener('click', () => this.handleCancel());
    this.container.querySelector('#docbot-commit-btn')?.addEventListener('click', () => this.handleCommit());
    this.container.querySelector('#docbot-revert-btn')?.addEventListener('click', () => this.handleRevert());
  }

  private formatDiff(diff: string): string {
    // Simple diff formatting for rendering
    if (!diff) return 'No changes found.';
    
    return diff.split('\n').map(line => {
      const escaped = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (line.startsWith('+')) {
        return `<span class="text-green-700 bg-green-50 w-full block">${escaped}</span>`;
      } else if (line.startsWith('-')) {
        return `<span class="text-red-700 bg-red-50 w-full block">${escaped}</span>`;
      } else if (line.startsWith('@@')) {
        return `<span class="text-blue-600 bg-blue-50 w-full block">${escaped}</span>`;
      }
      return `<span class="text-gray-800 w-full block">${escaped}</span>`;
    }).join('');
  }
}
