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
 * Framework-agnostic slash-command catalogue and matching/expansion helpers.
 *
 * The data and pure string logic live here so multiple hosts (the
 * `AssistantPanel` and the `InteractivePromptView`) can share them without a
 * DOM. Hosts filter the catalogue through `contexts` and render their own UI.
 */

export type SlashCommandType = 'prompt' | 'action';
export type SlashCommandContext = 'assistant' | 'interactive';

export interface SlashCommand {
  /** Command token including the leading slash, e.g. '/clear'. */
  command: string;
  description: string;
  type: SlashCommandType;
  /** For 'prompt' commands: template with an optional PIPELINE_ID token. */
  template?: string;
  /** Hosts that expose this command. Omitted => all hosts. */
  contexts?: SlashCommandContext[];
}

/** Pipeline id placeholder substituted by {@link expandTemplate}. */
const PIPELINE_ID_TOKEN = 'PIPELINE_ID';

/**
 * The full slash-command catalogue (superset). Hosts narrow it down via
 * `contexts`; the ordering here is alphabetical for readability only —
 * {@link filterCommands} re-orders the results.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/backlog',
    description: 'Show the tasks in the backlog (state CREATED) of the pipeline',
    type: 'prompt',
    contexts: ['interactive'],
    template: 'Show me the tasks in the backlog (state CREATED) of pipeline PIPELINE_ID',
  },
  {
    command: '/build',
    description: 'Show the build commands to build the app of the pipeline',
    type: 'prompt',
    template: 'Show me the build commands to build the app of pipeline PIPELINE_ID',
  },
  {
    command: '/clear',
    description: 'Clear the conversation history',
    type: 'action',
  },
  {
    command: '/close',
    description: 'Close the assistant panel',
    type: 'action',
    contexts: ['assistant'],
  },
  {
    command: '/dd',
    description: 'List the design docs of the pipeline',
    type: 'prompt',
    template: 'List the design docs of pipeline PIPELINE_ID',
  },
  {
    command: '/gd',
    description: 'Drop the top local commit (that has not been pushed to the remote) of the pipeline',
    type: 'prompt',
    template: 'Drop the top commit (that has not been pushed to the remote) of pipeline PIPELINE_ID',
  },
  {
    command: '/i',
    description: 'Show the 5 most recent issues of the pipeline',
    type: 'prompt',
    template: 'Show 5 most recent issues of pipeline PIPELINE_ID',
  },
  {
    command: '/gl',
    description: 'Show the last 5 commit hashes and messages of the pipeline',
    type: 'prompt',
    template: 'Show me the commit hashes and message of the last 5 commits in pipeline PIPELINE_ID',
  },
  {
    command: '/lint',
    description: 'Lint the code of the pipeline and give a summary of the lint findings',
    type: 'prompt',
    template: 'Lint the code of pipeline PIPELINE_ID and give me a summary of the lint findings',
  },
  {
    command: '/overview',
    description: 'Give an overview of the application, why it is useful, and its general architecture and design',
    type: 'prompt',
    template:
      'Give me an overview of the project of pipeline PIPELINE_ID . Explain what the application is about and why it is useful for the user. Give a short introduction in the general architecture and design.',
  },
  {
    command: '/pipelines',
    description: 'Show the available pipelines',
    type: 'prompt',
    contexts: ['interactive'],
    template: 'Show me the available pipelines',
  },
  {
    command: '/pr',
    description: 'Show the project structure of the pipeline',
    type: 'prompt',
    template: 'Show me the project structure of pipeline PIPELINE_ID',
  },
  {
    command: '/pulls',
    description: 'Show the recent pull requests of the pipeline',
    type: 'prompt',
    template: 'Show me the recent pull request of pipeline PIPELINE_ID',
  },
  {
    command: '/readme',
    description: 'Show the README of the pipeline',
    type: 'prompt',
    template: 'Show me the README of pipeline PIPELINE_ID',
  },
  {
    command: '/review',
    description: 'Review the last implemented task of the pipeline',
    type: 'prompt',
    template: 'Make a review of the last implemented task of pipeline PIPELINE_ID',
  },
  {
    command: '/summary',
    description: 'Summarize what we discussed and suggest new tasks to address what we learned',
    type: 'prompt',
    template:
      'Summarize what we discussed and suggest new tasks to address what we learned (for pipeline PIPELINE_ID)',
  },
  {
    command: '/test',
    description: 'Run the test suite for the pipeline',
    type: 'prompt',
    template: 'Run the tests for pipeline PIPELINE_ID',
  },
];

/**
 * True while the composer value is exactly '/' with no whitespace.
 *
 * The value must start with a slash at position 0 (`^\/`) and contain no
 * whitespace (`\S*$`). A bare `/`, `/cl` or `/clear` qualify, whereas an
 * empty value, a leading space, `cl` or `/clear x` do not. Scanning therefore
 * stops as soon as the first non-whitespace character is not a slash and only
 * ever applies to a value that starts with a slash.
 */
export function shouldOfferSlashMenu(value: string): boolean {
  return /^\/\S*$/.test(value);
}

/** The query typed after the leading slash ('' for a bare '/'). */
export function slashQuery(value: string): string {
  return value.startsWith('/') ? value.slice(1) : '';
}

function matchesContext(command: SlashCommand, context: SlashCommandContext): boolean {
  return !command.contexts || command.contexts.includes(context);
}

/**
 * Commands for a host, ordered: prefix matches first, then substring matches,
 * each group sorted alphabetically by command token.
 */
export function filterCommands(query: string, context: SlashCommandContext): SlashCommand[] {
  const normalized = query.toLowerCase();
  const prefix: SlashCommand[] = [];
  const substring: SlashCommand[] = [];

  for (const command of SLASH_COMMANDS) {
    if (!matchesContext(command, context)) continue;
    const token = command.command.slice(1).toLowerCase();
    if (normalized === '' || token.startsWith(normalized)) {
      prefix.push(command);
    } else if (token.includes(normalized)) {
      substring.push(command);
    }
  }

  const byCommand = (a: SlashCommand, b: SlashCommand) => a.command.localeCompare(b.command);
  return [...prefix.sort(byCommand), ...substring.sort(byCommand)];
}

/**
 * Substitutes the PIPELINE_ID token in a prompt template. When no pipeline id
 * is known the template is left intact.
 */
export function expandTemplate(template: string, pipelineId: string | null): string {
  return pipelineId ? template.split(PIPELINE_ID_TOKEN).join(pipelineId) : template;
}

/** Looks up a command token within a host (exact match). */
export function findCommand(
  command: string,
  context: SlashCommandContext
): SlashCommand | undefined {
  return SLASH_COMMANDS.find((entry) => entry.command === command && matchesContext(entry, context));
}
