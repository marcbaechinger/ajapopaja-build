# Copyright 2026 Marc Baechinger
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""One-shot AI prompt framework.

The backend framework consists of four layers:

* :mod:`api.oneprompt.registry` discovers ``*.prompt`` files, parses their YAML
  front-matter and resolves them by ``promptId``.
* :mod:`api.oneprompt.renderer` renders a template body with a context object
  (falling back to environment configuration) using :class:`string.Template`.
* :mod:`api.oneprompt.hooks` provides the per-prompt hook registry used to
  transform/reject a request at each stage of the lifecycle.
* :mod:`api.oneprompt.context` provides MongoDB-backed data providers that
  enrich the context before rendering.
* :mod:`api.oneprompt.ollama_client` is a configuration-aware wrapper over
  :class:`ollama.AsyncClient`.
* :mod:`api.oneprompt.runner` orchestrates the full
  pre-hook → render → post-render → Ollama → post-response pipeline and emits
  the ``quick_prompt_*`` WebSocket lifecycle events.
"""

from api.oneprompt.registry import (
    DEFAULT_TEMPLATES_DIR,
    PromptError,
    PromptNotFoundError,
    PromptRegistry,
    PromptTemplate,
    PromptTemplateError,
    get_registry,
    parse_template,
    registry,
)
from api.oneprompt.renderer import (
    ContextResolver,
    MissingPromptKeyError,
    PromptRenderError,
    StringTemplateRenderer,
    TemplateRenderer,
    render_template,
)
from api.oneprompt.hooks import (
    DEFAULT_HOOK,
    NOOP_HOOK,
    HookError,
    HookRejectedError,
    PromptHook,
    PromptHookError,
    PromptRejectedError,
    apply_post_render,
    apply_post_response,
    apply_pre_render,
    clear_hooks,
    get_hook,
    has_hook,
    register_hook,
    registered_hooks,
    run_post_render,
    run_post_response,
    run_pre_render,
    unregister_hook,
)
from api.oneprompt.context import (
    DEFAULT_CONTEXT_PROMPTS,
    TASK_ELABORATE_SPEC,
    ContextProvider,
    ContextProviderError,
    enrich_context,
    load_task_and_pipeline,
    provide_context,
    provide_task_context,
    register_context_providers,
    reset_context_providers,
    task_and_pipeline_provider,
    unregister_context_providers,
)
from api.oneprompt.ollama_client import (
    DEFAULT_UNAVAILABLE_MESSAGE,
    OLLAMA_UNAVAILABLE_MESSAGE,
    OllamaClient,
    OllamaClientError,
    OllamaError,
    OllamaUnavailableError,
    build_headers,
    create_ollama_client,
    default_client,
    get_ollama_client,
)
from api.oneprompt.runner import (
    DEFAULT_TIMEOUT,
    EVENT_ERROR,
    EVENT_RENDERED,
    EVENT_RESULT,
    EVENT_START,
    EVENT_STREAM,
    STATUS_CANCELLED,
    STATUS_ERROR,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_RUNNING,
    STATUS_TIMEOUT,
    STATUS_UNAVAILABLE,
    OnePromptRunner,
    PromptRun,
    PromptRunStatus,
    dispatch_message,
    extract_content,
    get_runner,
    one_prompt_runner,
)
from api.oneprompt.ws_handler import (
    INBOUND_MESSAGE_TYPES,
    OUTBOUND_MESSAGE_TYPES,
    QUICK_PROMPT,
    QUICK_PROMPT_ACCEPT,
    QUICK_PROMPT_CANCEL,
    QUICK_PROMPT_REJECT,
    QUICK_PROMPT_STREAM_CMD,
    handle_quick_prompt,
    handle_quick_prompt_accept,
    handle_quick_prompt_cancel,
    handle_quick_prompt_reject,
    handle_quick_prompt_stream_cmd,
    initialize_oneprompt,
    register_oneprompt_handlers,
    send_oneprompt_message,
)

__all__ = [
    "DEFAULT_CONTEXT_PROMPTS",
    "DEFAULT_HOOK",
    "DEFAULT_TEMPLATES_DIR",
    "DEFAULT_TIMEOUT",
    "DEFAULT_UNAVAILABLE_MESSAGE",
    "ContextResolver",
    "ContextProvider",
    "ContextProviderError",
    "EVENT_ERROR",
    "EVENT_RENDERED",
    "EVENT_RESULT",
    "EVENT_START",
    "EVENT_STREAM",
    "HookError",
    "HookRejectedError",
    "INBOUND_MESSAGE_TYPES",
    "MissingPromptKeyError",
    "NOOP_HOOK",
    "OLLAMA_UNAVAILABLE_MESSAGE",
    "OllamaClient",
    "OllamaClientError",
    "OllamaError",
    "OllamaUnavailableError",
    "OnePromptRunner",
    "OUTBOUND_MESSAGE_TYPES",
    "PromptError",
    "PromptHook",
    "PromptHookError",
    "PromptNotFoundError",
    "PromptRegistry",
    "PromptRejectedError",
    "PromptRenderError",
    "PromptRun",
    "PromptRunStatus",
    "PromptTemplate",
    "PromptTemplateError",
    "QUICK_PROMPT",
    "QUICK_PROMPT_ACCEPT",
    "QUICK_PROMPT_CANCEL",
    "QUICK_PROMPT_REJECT",
    "QUICK_PROMPT_STREAM_CMD",
    "STATUS_CANCELLED",
    "STATUS_ERROR",
    "STATUS_NOT_FOUND",
    "STATUS_OK",
    "STATUS_RUNNING",
    "STATUS_TIMEOUT",
    "STATUS_UNAVAILABLE",
    "StringTemplateRenderer",
    "TASK_ELABORATE_SPEC",
    "TemplateRenderer",
    "apply_post_render",
    "apply_post_response",
    "apply_pre_render",
    "build_headers",
    "clear_hooks",
    "create_ollama_client",
    "default_client",
    "dispatch_message",
    "enrich_context",
    "extract_content",
    "get_hook",
    "get_ollama_client",
    "get_registry",
    "get_runner",
    "has_hook",
    "handle_quick_prompt",
    "handle_quick_prompt_accept",
    "handle_quick_prompt_cancel",
    "handle_quick_prompt_reject",
    "handle_quick_prompt_stream_cmd",
    "initialize_oneprompt",
    "load_task_and_pipeline",
    "one_prompt_runner",
    "parse_template",
    "provide_context",
    "provide_task_context",
    "register_context_providers",
    "register_hook",
    "register_oneprompt_handlers",
    "registered_hooks",
    "registry",
    "render_template",
    "reset_context_providers",
    "run_post_render",
    "run_post_response",
    "run_pre_render",
    "send_oneprompt_message",
    "task_and_pipeline_provider",
    "unregister_context_providers",
    "unregister_hook",
]
