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

The template layer consists of two pieces:

* :mod:`api.oneprompt.registry` discovers ``*.prompt`` files, parses their YAML
  front-matter and resolves them by ``promptId``.
* :mod:`api.oneprompt.renderer` renders a template body with a context object
  (falling back to environment configuration) using :class:`string.Template`.
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

__all__ = [
    "DEFAULT_TEMPLATES_DIR",
    "ContextResolver",
    "MissingPromptKeyError",
    "PromptError",
    "PromptNotFoundError",
    "PromptRegistry",
    "PromptRenderError",
    "PromptTemplate",
    "PromptTemplateError",
    "StringTemplateRenderer",
    "TemplateRenderer",
    "get_registry",
    "parse_template",
    "registry",
    "render_template",
]
