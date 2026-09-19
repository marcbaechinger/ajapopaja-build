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
    TASK_ELABORATE_SPEC,
    ContextProvider,
    ContextProviderError,
    load_task_and_pipeline,
    provide_context,
    register_context_providers,
    unregister_context_providers,
)

__all__ = [
    "DEFAULT_HOOK",
    "DEFAULT_TEMPLATES_DIR",
    "ContextResolver",
    "ContextProvider",
    "ContextProviderError",
    "HookError",
    "HookRejectedError",
    "MissingPromptKeyError",
    "NOOP_HOOK",
    "PromptError",
    "PromptHook",
    "PromptHookError",
    "PromptNotFoundError",
    "PromptRegistry",
    "PromptRejectedError",
    "PromptRenderError",
    "PromptTemplate",
    "PromptTemplateError",
    "StringTemplateRenderer",
    "TASK_ELABORATE_SPEC",
    "TemplateRenderer",
    "apply_post_render",
    "apply_post_response",
    "apply_pre_render",
    "clear_hooks",
    "get_hook",
    "get_registry",
    "has_hook",
    "load_task_and_pipeline",
    "parse_template",
    "provide_context",
    "register_context_providers",
    "register_hook",
    "registered_hooks",
    "registry",
    "render_template",
    "run_post_render",
    "run_post_response",
    "run_pre_render",
    "unregister_context_providers",
    "unregister_hook",
]
