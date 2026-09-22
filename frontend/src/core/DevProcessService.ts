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

import { WebSocketClient } from './WebSocketClient.ts';
import type { WSMessage } from './domain.ts';

/**
 * A single event delivered on a dev process's log stream.
 *
 * The backend multiplexes the stream over the shared WebSocket connection and
 * tags every message with ``pipeline_id``/``run_id`` so several processes can be
 * streamed at once without cross-talk.
 */
export interface DevProcessEvent {
  type: 'status' | 'chunk' | 'exit';
  pipeline_id?: string;
  run_id?: string | null;
  seq?: number;
  stream?: 'stdout' | 'stderr';
  text?: string;
  pid?: number | null;
  user?: string;
  port?: number;
  status?: string;
  started_at?: number;
  commands?: string[][];
  exit_code?: number | null;
}

/**
 * Thin frontend bridge that turns the low-level ``dev_process_*`` WebSocket
 * messages into a typed, per-process subscription.
 *
 * It deliberately reuses {@link WebSocketClient} (and therefore the existing
 * token-auth handshake and reconnect/backoff) instead of a bespoke SSE reader.
 */
export class DevProcessService {
  private wsClient: WebSocketClient;

  constructor(wsClient: WebSocketClient) {
    this.wsClient = wsClient;
  }

  /**
   * Subscribes to one process's log stream.
   *
   * @param pipelineId The pipeline whose dev process to stream.
   * @param runId      Optional run guard. When set, events belonging to another
   *                   run are ignored.
   * @param onEvent    Callback invoked for every matching event.
   * @returns An unsubscribe function that also tells the server to stop
   *          pumping for this client.
   */
  subscribe(
    pipelineId: string,
    runId: string | null,
    onEvent: (event: DevProcessEvent) => void,
  ): () => void {
    this.wsClient.send('dev_process_logs_subscribe', {
      pipeline_id: pipelineId,
      run_id: runId,
    });

    const offStatus = this.wsClient.on('DEV_PROCESS_STATUS', (msg) =>
      this.dispatch(msg, pipelineId, runId, 'status', onEvent),
    );
    const offLog = this.wsClient.on('DEV_PROCESS_LOG', (msg) =>
      this.dispatch(msg, pipelineId, runId, 'chunk', onEvent),
    );
    const offEnd = this.wsClient.on('DEV_PROCESS_STREAM_END', (msg) =>
      this.dispatch(msg, pipelineId, runId, 'exit', onEvent),
    );

    return () => {
      offStatus();
      offLog();
      offEnd();
      this.wsClient.send('dev_process_logs_unsubscribe', {
        pipeline_id: pipelineId,
        run_id: runId,
      });
    };
  }

  /** Filters a raw WS message and dispatches it as a typed event. */
  private dispatch(
    message: WSMessage,
    pipelineId: string,
    runId: string | null,
    type: DevProcessEvent['type'],
    onEvent: (event: DevProcessEvent) => void,
  ): void {
    const payload = message.payload || {};
    // Ignore messages for co-tenant processes sharing the same socket.
    if (payload.pipeline_id && payload.pipeline_id !== pipelineId) return;
    if (runId && payload.run_id && payload.run_id !== runId) return;
    onEvent({ ...payload, type });
  }
}
