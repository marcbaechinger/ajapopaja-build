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

import { formatMs } from '../ui/components/utils/duration.ts';

export type BlockKind =
  | 'user'
  | 'text'
  | 'thinking'
  | 'tool'
  | 'bash'
  | 'notice'
  | 'error'
  | 'divider'
  | 'verification';

/**
 * A single structured, rendered line/block in a Pi activity log.
 */
export interface RenderBlock {
  id: string;
  kind: BlockKind;
  /** Accumulated content for text/thinking/bash blocks. */
  text?: string;
  /** Headline (e.g. "→ Calling write"). */
  header?: string;
  /** Extra detail lines (tool args, queue items, retry info). */
  sub?: string[];
  /** Marks error blocks for red tinting. */
  error?: boolean;
  /**
   * The original command/argument captured when a tool started (e.g. the bash
   * command or the file a read/write tool operated on). Preserving it keeps
   * "what was executed" visible after the tool completes and its header becomes
   * "✓ bash finished"; the view prepends it before the result/output.
   */
  command?: string;
  /**
   * True once the reducer closed the streaming buffer for this block, i.e. the
   * response element is complete and no further deltas will be appended. Used
   * by the view to auto-render the assistant Markdown exactly once, on
   * completion, instead of on every streamed token.
   */
  complete?: boolean;
}

type BlockListener = (blocks: RenderBlock[]) => void;

/**
 * Extracts the human-readable text of a Pi user message.
 *
 * Pi's `UserMessage.content` is either a plain string or an array of text/image
 * content blocks. Text blocks are joined with a newline (matching the backend's
 * session-title extractor) and images only contribute a short placeholder so
 * base64 payloads never reach the DOM. Unknown blocks are ignored rather than
 * throwing, keeping the log robust to Pi protocol shape drift.
 */
function extractUserText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const raw of content) {
    if (typeof raw === 'string') {
      parts.push(raw);
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const block = raw as { type?: unknown; text?: unknown; mimeType?: unknown };
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'image') {
      const mimeType =
        typeof block.mimeType === 'string' && block.mimeType
          ? block.mimeType
          : 'image';
      parts.push(`[Image: ${mimeType}]`);
    }
  }
  return parts.join('\n').trim();
}

interface OpenBlock {
  block: RenderBlock;
  buffer: string;
  /** The original command/argument captured at tool start (see RenderBlock.command). */
  command?: string;
}

/**
 * Pure reducer that turns a stream of raw Pi RPC events into a stable list of
 * {@link RenderBlock}s.
 *
 * It is shared by the batch `CoderBotService` and the interactive
 * `InteractiveCodingService` so both activity logs render identically. The
 * reducer owns no transport: callers feed it events and subscribe to block
 * snapshots.
 */
export class PiLogReducer {
  private blocks: RenderBlock[] = [];
  /** Live blocks still receiving streaming deltas, keyed by a logical key. */
  private openBlocks: Map<string, OpenBlock> = new Map();
  /** Stable user-message key -> block id, for start/end dedupe. */
  private userBlockIds: Map<string, string> = new Map();
  /** Key opened by message_start while waiting for its message_end. */
  private pendingUserKey: string | null = null;
  private nextBlockId: number = 1;
  private blockListeners: Set<BlockListener> = new Set();
  /**
   * Depth counter for notification suspension. While > 0, {@link emitBlocks}
   * only records that an update is pending instead of notifying listeners.
   * Used to batch the (potentially enormous) history replay into a single
   * snapshot: replaying a long session otherwise fires one full block-list
   * notification per persisted RPC event, which makes listeners reconcile the
   * growing log once per event (O(n²)) and freezes the page for seconds.
   */
  private emitSuspensionDepth: number = 0;
  /** Whether an emit was requested while notifications were suspended. */
  private emitPending: boolean = false;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns the structured activity log blocks. */
  public getBlocks(): RenderBlock[] {
    return this.blocks.slice();
  }

  /** Subscribe to structured activity-log changes. Receives the full block list. */
  public onBlocks(listener: BlockListener): () => void {
    this.blockListeners.add(listener);
    return () => this.blockListeners.delete(listener);
  }

  /** Resets the log (and notifies listeners with the empty snapshot). */
  public clear() {
    this.blocks = [];
    this.openBlocks.clear();
    this.userBlockIds.clear();
    this.pendingUserKey = null;
    this.nextBlockId = 1;
    this.emitBlocks();
  }

  /** Forces a notification with the current block snapshot. */
  public emit() {
    this.emitBlocks();
  }

  /** Reduces one raw Pi RPC event into the block list. */
  public handleEvent(event: any) {
    const type = event?.type;
    if (!type) return;

    switch (type) {
      case 'message_update':
        this.handleMessageUpdate(event.assistantMessageEvent);
        break;
      case 'message_start':
      case 'message_end': {
        const message = event?.message;
        if (message?.role === 'user') {
          this.upsertUserMessage(message, type === 'message_end');
        }
        // Close any streaming text/thinking blocks so each message's content stays
        // in its own block (contentIndex restarts at 0 per message).
        this.closeStreamingBlocks(['text', 'thinking']);
        break;
      }
      case 'agent_start':
        this.addBlock({ kind: 'notice', text: '● Agent started' });
        break;
      case 'agent_end':
        this.addBlock({
          kind: 'notice',
          text: `● Agent run completed${event.willRetry ? ' — will auto-retry' : ''}`,
        });
        break;
      case 'agent_settled':
        this.addBlock({ kind: 'notice', text: '● Agent settled (no pending work)' });
        break;
      case 'bash_execution_update':
        this.handleBashUpdate(event);
        break;
      case 'tool_execution_start':
        this.handleToolStart(event);
        break;
      case 'tool_execution_update':
        this.handleToolUpdate(event);
        break;
      case 'tool_execution_end':
        this.finishTool(event, event.isError);
        break;
      case 'queue_update':
        this.handleQueueUpdate(event);
        break;
      case 'compaction_start':
        this.addBlock({
          kind: 'notice',
          text: `● Compacting… (${event.reason || 'threshold'})`,
        });
        break;
      case 'compaction_end':
        this.handleCompactionEnd(event);
        break;
      case 'auto_retry_start':
        this.addBlock({
          kind: 'notice',
          text: `● Auto-retry (${event.attempt}/${event.maxAttempts})…`,
        });
        break;
      case 'auto_retry_end':
        this.addBlock({
          kind: 'notice',
          text: event.success
            ? `● Auto-retry succeeded (attempt ${event.attempt})`
            : `● Auto-retry failed: ${event.finalError || 'unknown error'}`,
          error: !event.success,
        });
        break;
      case 'summarization_retry_scheduled':
        this.addBlock({
          kind: 'notice',
          text: `● Summarization retry scheduled (${event.attempt}/${event.maxAttempts})…`,
        });
        break;
      case 'summarization_retry_attempt_start':
        this.addBlock({
          kind: 'notice',
          text: `● Retrying summarization…`,
        });
        break;
      case 'summarization_retry_finished':
        this.addBlock({ kind: 'notice', text: '● Summarization retry finished' });
        break;
      case 'extension_error':
        this.addBlock({
          kind: 'error',
          text: `Extension error (${event.extensionPath || ''}): ${event.error || event.event || ''}`,
          error: true,
        });
        break;
      default:
        // Unknown/ignored event types are logged on the backend; nothing to render.
        break;
    }
  }

  /**
   * Reducer for a `CODERBOT_VERIFICATION`/interactive verification broadcast.
   * Builds a single `verification`-kind block summarizing the command suite.
   *
   * Commands are grouped by their category (`kind`) in the order the backend
   * executed them (build -> lint -> test). The wall-clock duration reported for
   * each command/category (``duration_ms``) is rendered alongside its exit code
   * and in the group header, and the overall run duration is shown in the
   * headline so PiView surfaces how long the build, lint and test runs took.
   */
  public addVerificationBlock(result: any) {
    const passed = !!result?.passed;
    const commands: any[] = Array.isArray(result?.commands)
      ? result.commands
      : [];

    // Group by category, preserving the backend's execution order.
    const order: string[] = [];
    const groups = new Map<string, any[]>();
    for (const entry of commands) {
      const kind = entry?.kind;
      let group = groups.get(kind);
      if (!group) {
        group = [];
        groups.set(kind, group);
        order.push(kind);
      }
      group.push(entry);
    }

    // Per-command durations are authoritative; fall back to the aggregate the
    // backend reports per category for entries without their own duration.
    const categoryDurations: Record<string, number> = result?.durations ?? {};
    const commandDuration = (entry: any): number =>
      typeof entry?.duration_ms === 'number' ? entry.duration_ms : 0;

    const sub: string[] = [];
    let totalDuration = 0;
    for (const kind of order) {
      const entries = groups.get(kind)!;
      const commandTotal = entries.reduce(
        (sum, entry) => sum + commandDuration(entry),
        0
      );
      const groupDuration =
        commandTotal || (typeof categoryDurations[kind] === 'number' ? categoryDurations[kind] : 0);
      totalDuration += groupDuration;

      const suffix = groupDuration > 0 ? ` (${formatMs(groupDuration)})` : '';
      sub.push(`${kind} verification${suffix}:`);
      for (const entry of entries) {
        const cmd = entry?.cmd ?? '';
        const exitCode = entry?.exit_code;
        const duration = commandDuration(entry);
        const durationSuffix = duration > 0 ? ` (${formatMs(duration)})` : '';
        sub.push(`- ${cmd}  → exit code ${exitCode}${durationSuffix}`);
        // Append the (truncated) output tail only for failed commands, matching
        // the backend's PR summary annotation.
        if (!passed && exitCode !== 0 && entry?.output_tail) {
          sub.push(entry.output_tail.slice(0, 500));
        }
      }
    }

    // Prefer the backend's explicit total; otherwise use the sum of the groups.
    if (typeof result?.duration_ms === 'number') {
      totalDuration = result.duration_ms;
    }
    const totalSuffix =
      totalDuration > 0 ? ` (${formatMs(totalDuration)})` : '';

    this.addBlock({
      kind: 'verification',
      text: `${passed ? '● Verification: PASSED' : '● Verification: FAILED'}${totalSuffix}`,
      sub,
      error: !passed,
    });
  }

  /**
   * Suspends block notifications until the returned release function is called.
   * Calls are nestable. When the outermost release runs and an update was
   * requested while suspended, a single consolidated snapshot is emitted.
   */
  public suspendEmits(): () => void {
    this.emitSuspensionDepth++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.emitSuspensionDepth = Math.max(0, this.emitSuspensionDepth - 1);
      if (this.emitSuspensionDepth === 0 && this.emitPending) {
        this.emitPending = false;
        this.emitBlocks();
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Event helpers
  // ---------------------------------------------------------------------------

  /**
   * Adds or finalizes a `user` block for a Pi `message_start`/`message_end`
   * user message. The start event renders immediately, while the end event
   * updates the same block (authoritative content) instead of duplicating it.
   */
  private upsertUserMessage(message: any, final: boolean) {
    const timestamp = message?.timestamp;
    const hasTimestamp = timestamp !== undefined && timestamp !== null;
    const timestampKey = hasTimestamp ? `timestamp:${String(timestamp)}` : null;

    // A start opens a pending key. Its matching end always finalizes that key,
    // even if the end's timestamp differs or is missing, so a pair that Pi
    // labels inconsistently still renders as one block. Standalone/duplicate
    // events fall back to the timestamp or a fresh anonymous key.
    const key =
      (!final && timestampKey) ||
      this.pendingUserKey ||
      timestampKey ||
      `anon:${this.nextBlockId}`;

    const text = extractUserText(message?.content);
    if (!text) {
      if (!final) {
        this.pendingUserKey = key;
      } else if (this.pendingUserKey === key) {
        this.pendingUserKey = null;
      }
      return;
    }

    const existingId = this.userBlockIds.get(key);
    if (existingId) {
      this.updateBlock(existingId, { text, complete: final });
    } else {
      const id = this.addBlock({
        kind: 'user',
        header: 'You',
        text,
        complete: final,
      });
      this.userBlockIds.set(key, id);
    }

    if (!final) {
      this.pendingUserKey = key;
    } else if (this.pendingUserKey === key) {
      this.pendingUserKey = null;
    }
  }

  private handleMessageUpdate(delta: any) {
    const deltaType = delta?.type;
    if (deltaType === 'text_delta' && delta.delta) {
      this.appendStreaming('text', `text:${delta.contentIndex ?? 0}`, delta.delta);
    } else if (deltaType === 'thinking_delta' && delta.delta) {
      this.appendStreaming('thinking', `thinking:${delta.contentIndex ?? 0}`, delta.delta);
    } else if (deltaType === 'toolcall_start') {
      this.openToolCall(delta.id, delta.toolName ?? 'tool');
    } else if (deltaType === 'toolcall_delta') {
      const open = this.openBlocks.get(`tool:${delta.id}`);
      if (open) {
        open.buffer += delta.delta ?? '';
        this.updateBlock(open.block.id, { text: open.buffer });
      }
    } else if (deltaType === 'toolcall_end') {
      const open = this.openBlocks.get(`tool:${delta.id}`);
      if (open) {
        this.updateBlock(open.block.id, {
          header: `✓ ${delta.toolCall?.name ?? 'tool'}`,
        });
      }
    }
  }

  private openToolCall(id: unknown, name: string) {
    if (id === undefined || id === null) {
      id = `gen_${this.nextBlockId}`;
    }
    const key = `tool:${id}`;
    if (this.openBlocks.has(key)) {
      return;
    }
    const block: RenderBlock = {
      id: this.nextId(),
      kind: 'tool',
      header: `→ Calling ${name}…`,
      text: '',
    };
    this.openBlocks.set(key, { block, buffer: '' });
    this.blocks.push(block);
    this.emitBlocks();
  }

  private handleBashUpdate(event: any) {
    const key = `bash:${event.id ?? '_no_id'}`;
    this.appendStreaming('bash', key, event.delta ?? '');
  }

  private handleToolStart(event: any) {
    const key = `tool:${event.toolCallId}`;
    let open = this.openBlocks.get(key);
    if (!open) {
      const block: RenderBlock = {
        id: this.nextId(),
        kind: 'tool',
        header: `→ Running ${event.toolName ?? 'tool'}…`,
        text: '',
      };
      open = { block, buffer: '' };
      this.openBlocks.set(key, open);
      this.blocks.push(block);
    } else {
      this.updateBlock(open.block.id, {
        header: `→ Running ${event.toolName ?? 'tool'}…`,
      });
    }
    const args = event.args?.command ?? this.previewArgs(event.args);
    if (args) {
      const command = String(args);
      open.buffer = command;
      open.command = command;
      this.updateBlock(open.block.id, { text: open.buffer, command });
    }
  }

  private handleToolUpdate(event: any) {
    const open = this.openBlocks.get(`tool:${event.toolCallId}`);
    if (!open) return;
    const partial = event.partialResult?.content;
    let text = '';
    if (Array.isArray(partial)) {
      text = partial.map((p: any) => p?.text ?? '').join('');
    } else if (typeof partial === 'string') {
      text = partial;
    }
    if (text) {
      open.buffer = text;
      this.updateBlock(open.block.id, { text });
    }
  }

  private finishTool(event: any, isError: boolean) {
    const open = this.openBlocks.get(`tool:${event.toolCallId}`);
    if (!open) return;
    const result = event.result?.content;
    let text = open.buffer;
    if (Array.isArray(result)) {
      const joined = result.map((p: any) => p?.text ?? '').join('');
      if (joined) text = joined;
    } else if (typeof result === 'string' && result) {
      text = result;
    }
    this.updateBlock(open.block.id, {
      header: isError ? `✕ ${event.toolName ?? 'tool'} failed` : `✓ ${event.toolName ?? 'tool'} finished`,
      text,
      error: isError,
      // Keep the executed command/file so it stays visible after completion.
      command: open.command,
    });
    this.openBlocks.delete(`tool:${event.toolCallId}`);
  }

  private handleQueueUpdate(event: any) {
    const parts: string[] = [];
    const steering = event.steering ?? [];
    const followUp = event.followUp ?? [];
    if (steering.length) parts.push(`steering: ${steering.join(' · ')}`);
    if (followUp.length) parts.push(`follow-up: ${followUp.join(' · ')}`);
    this.addBlock({ kind: 'notice', text: parts.length ? `● Queue — ${parts.join(' | ')}` : '● Queue empty' });
  }

  private handleCompactionEnd(event: any) {
    const result = event.result;
    if (event.aborted) {
      this.addBlock({ kind: 'notice', text: '● Compaction aborted', error: true });
      return;
    }
    if (!result || event.errorMessage) {
      this.addBlock({
        kind: 'notice',
        text: `● Compaction failed: ${event.errorMessage || 'unknown error'}`,
        error: true,
      });
      return;
    }
    const tokensBefore = result.tokensBefore ?? '?';
    const tokensAfter = event.estimatedTokensAfter ?? result.estimatedTokensAfter ?? '?';
    this.addBlock({
      kind: 'notice',
      text: `● Compacted ${tokensBefore} → ${tokensAfter} tokens (will retry: ${event.willRetry ? 'yes' : 'no'})`,
    });
  }

  private previewArgs(args: any): string {
    if (!args) return '';
    try {
      return JSON.stringify(args);
    } catch {
      return String(args);
    }
  }

  // ---------------------------------------------------------------------------
  // Block helpers
  // ---------------------------------------------------------------------------

  private nextId(): string {
    return `blk_${this.nextBlockId++}`;
  }

  public addBlock(opts: Omit<RenderBlock, 'id'>) {
    const block: RenderBlock = { id: this.nextId(), ...opts };
    this.blocks.push(block);
    this.emitBlocks();
    return block.id;
  }

  private appendStreaming(kind: BlockKind, key: string, delta: string) {
    let open = this.openBlocks.get(key);
    if (!open) {
      const block: RenderBlock = { id: this.nextId(), kind, text: '' };
      open = { block, buffer: '' };
      this.openBlocks.set(key, open);
      this.blocks.push(block);
    }
    open.buffer += delta;
    open.block.text = open.buffer;
    this.emitBlocks();
  }

  private closeStreamingBlocks(kinds: BlockKind[]) {
    let changed = false;
    for (const [key, open] of this.openBlocks) {
      const kind = open.block.kind;
      if (kinds.includes(kind)) {
        if (!open.block.complete) {
          open.block.complete = true;
          changed = true;
        }
        this.openBlocks.delete(key);
      }
    }
    // Emit once per close transition (not once per message_start/end event) so
    // listeners can react to the "response element completed" boundary. The
    // emit goes through emitBlocks() and therefore respects suspendEmits().
    if (changed) this.emitBlocks();
  }

  private updateBlock(id: string, patch: Partial<RenderBlock>) {
    const block = this.blocks.find((b) => b.id === id);
    if (!block) return;
    Object.assign(block, patch);
    this.emitBlocks();
  }

  private emitBlocks() {
    if (this.emitSuspensionDepth > 0) {
      this.emitPending = true;
      return;
    }
    const snapshot = this.blocks.slice();
    this.blockListeners.forEach((l) => l(snapshot));
  }
}
