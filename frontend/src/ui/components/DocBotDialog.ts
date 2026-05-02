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
      <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 text-app-text">
        <div class="bg-app-bg border border-app-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
          <div class="p-4 border-b border-app-border flex justify-between items-center bg-app-surface">
            <h2 class="text-xl font-bold text-app-text">DocBot Review: ${this.props.filename}</h2>
            <button id="docbot-close-btn" class="text-app-muted hover:text-app-text transition-colors p-1 hover:bg-app-bg rounded-lg">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
          
          <div class="p-6 flex-1 overflow-auto flex flex-col gap-6 bg-app-bg">
            <div>
              <h3 class="text-xs font-bold text-app-muted uppercase tracking-widest mb-3">Proposed Changes</h3>
              <div class="bg-black/20 border border-app-border rounded-xl p-4 overflow-x-auto font-mono text-sm whitespace-pre shadow-inner">
                ${this.formatDiff(this.props.diff)}
              </div>
            </div>
            
            <div>
              <label for="commit-msg-input" class="block text-xs font-bold text-app-muted uppercase tracking-widest mb-3">Commit Message</label>
              <textarea 
                id="commit-msg-input" 
                class="w-full bg-app-surface border border-app-border rounded-xl p-3 font-mono text-sm h-32 focus:ring-1 focus:ring-app-accent-1 focus:border-app-accent-1 outline-none transition-all placeholder:text-app-muted/50"
                placeholder="Enter commit message..."
              >${this.props.commitMsg}</textarea>
            </div>
          </div>
          
          <div class="p-4 border-t border-app-border bg-app-surface flex justify-between items-center">
            <button id="docbot-revert-btn" class="px-5 py-2.5 bg-red-600/90 hover:bg-red-600 text-white rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-red-500/50 font-bold text-sm shadow-lg shadow-red-900/20">
              Revert Changes
            </button>
            <div class="flex gap-3">
              <button id="docbot-cancel-btn" class="px-5 py-2.5 bg-app-bg border border-app-border text-app-text rounded-lg hover:bg-app-surface transition-all focus:outline-none focus:ring-2 focus:ring-app-border font-bold text-sm">
                Cancel
              </button>
              <button id="docbot-commit-btn" class="px-6 py-2.5 bg-app-accent-1 hover:brightness-110 text-white rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-app-accent-1/50 font-bold text-sm shadow-lg shadow-app-accent-1/20">
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
    if (!diff) return '<span class="italic text-app-muted">No changes found.</span>';
    
    return diff.split('\n').map(line => {
      const escaped = line.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (line.startsWith('+')) {
        return `<span class="text-green-400 bg-green-400/10 w-full block px-2 -mx-2">${escaped}</span>`;
      } else if (line.startsWith('-')) {
        return `<span class="text-red-400 bg-red-400/10 w-full block px-2 -mx-2">${escaped}</span>`;
      } else if (line.startsWith('@@')) {
        return `<span class="text-app-accent-2 bg-app-accent-2/10 w-full block px-2 -mx-2 opacity-80">${escaped}</span>`;
      }
      return `<span class="text-app-text/90 w-full block px-2 -mx-2">${escaped}</span>`;
    }).join('');
  }
}
