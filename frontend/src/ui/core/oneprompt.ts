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

/**
 * Compatibility re-export.
 *
 * The design document (`design/dd_one_shot_ai.md`) refers to the one-shot core
 * as `ui/core/oneprompt.ts`, while this repository keeps its shared core modules
 * under `frontend/src/core/`. The canonical implementation lives in
 * `../../core/oneprompt.ts`; this shim keeps the documented import path working
 * and shares the exact same registries/state.
 */

export * from '../../core/oneprompt.ts';
