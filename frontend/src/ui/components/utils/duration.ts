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

import { Task, TaskStatus } from '../../../core/domain.ts';

export function formatMs(durationMs: number): string | null {
  if (durationMs < 0) return null;

  const seconds = Math.floor((durationMs / 1000) % 60);
  const minutes = Math.floor((durationMs / (1000 * 60)) % 60);
  const hours = Math.floor(durationMs / (1000 * 60 * 60));

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

export function calculateDuration(task: Task): string | null {
  if (!task.history || task.history.length === 0) return null;

  // Use the last INPROGRESS entry as the start of the current/final implementation attempt
  const inProgressEntries = task.history.filter(t => t.to_status === TaskStatus.INPROGRESS);
  if (inProgressEntries.length === 0) return null;
  const inProgressEntry = inProgressEntries[inProgressEntries.length - 1];

  const implementedEntry = task.history.find(t => t.to_status === TaskStatus.IMPLEMENTED);

  if (!inProgressEntry || !implementedEntry) return null;

  const start = new Date(inProgressEntry.timestamp).getTime();
  const end = new Date(implementedEntry.timestamp).getTime();
  const durationMs = end - start;

  return formatMs(durationMs);
}

export function calculateDesignDuration(task: Task): string | null {
  if (!task.history || task.history.length === 0) return null;

  const proposedEntry = task.history.find(t => t.to_status === TaskStatus.PROPOSED);
  if (!proposedEntry) return null;

  const inProgressEntriesBeforeProposed = task.history.filter(t =>
    t.to_status === TaskStatus.INPROGRESS &&
    new Date(t.timestamp).getTime() < new Date(proposedEntry.timestamp).getTime()
  );

  if (inProgressEntriesBeforeProposed.length === 0) return null;
  const designStartEntry = inProgressEntriesBeforeProposed[0];

  const start = new Date(designStartEntry.timestamp).getTime();
  const end = new Date(proposedEntry.timestamp).getTime();
  const durationMs = end - start;

  return formatMs(durationMs);
}
