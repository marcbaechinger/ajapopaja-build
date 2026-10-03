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

"""Template rendering for the one-shot AI prompt framework.

The default implementation uses the standard-library :class:`string.Template`
syntax (``$identifier`` and ``${...}``) so the framework does not depend on a
heavy templating engine. Rendering is deliberately hidden behind the
:class:`TemplateRenderer` interface: if richer control flow is ever required,
the ``string.Template`` implementation can be swapped for Jinja2 (or a
database-backed renderer) without touching callers.

Placeholders are resolved by :class:`ContextResolver`, which looks a key up in
the supplied context object first and then falls back to environment
configuration (``os.environ`` followed by ``core.config``). Missing keys raise
:class:`MissingPromptKeyError` instead of silently rendering ``$undefined``.
"""

from __future__ import annotations

import os
import string
from abc import ABC, abstractmethod
from collections.abc import Iterator, Mapping
from typing import Any, Callable, Optional, Union

_Context = Union[Mapping[str, Any], object, None]
_Environment = Mapping[str, Any]


class PromptRenderError(Exception):
    """Raised when a template cannot be rendered."""

    status = "error"


class MissingPromptKeyError(PromptRenderError):
    """Raised when a placeholder has no value in the context or environment."""

    status = "error"

    def __init__(self, missing_keys: Union[str, list[str]]) -> None:
        if isinstance(missing_keys, str):
            missing_keys = [missing_keys]
        self.missing_keys = list(missing_keys)
        placeholders = ", ".join(f"${{{key}}}" for key in self.missing_keys)
        super().__init__(
            f"Missing value for {placeholders}. Provide the value in the "
            "context object or in the environment configuration."
        )


_MISSING = object()


def _lookup_context(context: _Context, key: str) -> Any:
    """Look ``key`` up in ``context`` (mapping or attribute based)."""

    if context is None:
        return _MISSING

    if isinstance(context, Mapping):
        if key in context:
            return context[key]
        return _MISSING

    # Objects (dataclasses, pydantic models, ...) expose values as attributes.
    try:
        return getattr(context, key)
    except AttributeError:
        pass
    except Exception:  # pragma: no cover - defensive against weird properties
        return _MISSING

    # Custom containers may implement item access without being Mappings.
    try:
        return context[key]  # type: ignore[index]
    except (KeyError, IndexError, TypeError):
        return _MISSING


def _default_config() -> Any:
    """Return the project config module, or ``None`` if unavailable."""

    try:
        from core import config as core_config
    except Exception:  # pragma: no cover - config import is best-effort
        return None
    return core_config


class ContextResolver:
    """Resolves template placeholders for :class:`string.Template`.

    Resolution order:

    1. the supplied ``context`` object (mapping or object attributes),
    2. the ``environment`` mapping (``os.environ`` by default),
    3. attributes of the project ``config`` module (defaults such as
       ``ONE_PROMPT_OLLAMA_MODEL`` that may not be exported as environment
       variables).

    The class implements the mapping protocol expected by
    :meth:`string.Template.substitute`, so it can be passed directly as the
    substitution mapping.
    """

    def __init__(
        self,
        context: _Context = None,
        environment: Optional[_Environment] = None,
        config: Any = None,
    ) -> None:
        self.context = context
        self.environment = os.environ if environment is None else environment
        self._config = config

    @property
    def config(self) -> Any:
        if self._config is None:
            self._config = _default_config()
        return self._config

    def resolve(self, key: str, default: Any = _MISSING) -> Any:
        """Resolve a single placeholder key."""

        value = _lookup_context(self.context, key)
        if value is not _MISSING:
            return value

        if self.environment is not None and key in self.environment:
            return self.environment[key]

        config = self.config
        if config is not None and hasattr(config, key):
            return getattr(config, key)

        if default is not _MISSING:
            return default
        raise MissingPromptKeyError(key)

    def __getitem__(self, key: str) -> Any:
        return self.resolve(key)

    def __contains__(self, key: object) -> bool:
        if not isinstance(key, str):
            return False
        try:
            self.resolve(key)
        except MissingPromptKeyError:
            return False
        return True

    def __iter__(self) -> Iterator[str]:
        # Only used by a few string.Template helpers; not required by
        # ``substitute`` but keeps the mapping protocol well behaved.
        keys: dict[str, None] = {}
        if isinstance(self.context, Mapping):
            keys.update(dict.fromkeys(self.context))
        if self.environment is not None:
            keys.update(dict.fromkeys(self.environment))
        return iter(keys)

    def __len__(self) -> int:
        return sum(1 for _ in self)


def _template_source(template: Any) -> str:
    """Return the template body from a template object or a raw string."""

    if isinstance(template, str):
        return template

    for attribute in ("body", "content", "source", "text"):
        if hasattr(template, attribute):
            value = getattr(template, attribute)
            if callable(value):
                value = value()
            return str(value)

    raise TypeError(
        "render_template() expects a template object with a 'body' attribute "
        f"or a raw string, got {type(template).__name__}."
    )


class TemplateRenderer(ABC):
    """Abstract template renderer.

    Implementations turn a template (source or :class:`PromptTemplate`) plus a
    context into the final prompt string. Callers depend on this interface, not
    on :class:`string.Template`, so the engine can be replaced later.
    """

    @abstractmethod
    def render(self, template: Any, context: _Context = None) -> str:
        """Render ``template`` with ``context`` and return the prompt."""

        raise NotImplementedError


class StringTemplateRenderer(TemplateRenderer):
    """Renderer backed by the standard library :class:`string.Template`."""

    def __init__(
        self,
        environment: Optional[_Environment] = None,
        config: Any = None,
    ) -> None:
        self.environment = environment
        self.config = config

    def render(self, template: Any, context: _Context = None) -> str:
        source = _template_source(template)

        if isinstance(context, ContextResolver):
            resolver = context
        else:
            resolver = ContextResolver(
                context=context,
                environment=self.environment,
                config=self.config,
            )

        try:
            return string.Template(source).substitute(resolver)
        except MissingPromptKeyError:
            raise
        except KeyError as exc:  # pragma: no cover - resolver raises first
            key = exc.args[0] if exc.args else "<unknown>"
            raise MissingPromptKeyError(str(key)) from exc
        except ValueError as exc:
            raise PromptRenderError(f"Invalid template syntax: {exc}") from exc


#: Renderer used by :func:`render_template` when none is supplied.
DEFAULT_RENDERER: TemplateRenderer = StringTemplateRenderer()


def render_template(
    template: Any,
    context: _Context = None,
    *,
    renderer: Optional[TemplateRenderer] = None,
    environment: Optional[_Environment] = None,
    config: Any = None,
) -> str:
    """Render ``template`` with ``context``.

    Args:
        template: A :class:`~api.oneprompt.registry.PromptTemplate` (or any
            object exposing a ``body``/``content``/``source``/``text``
            attribute) or a raw template string.
        context: The context object. May be a mapping (``dict``) or any object
            whose attributes hold the placeholder values.
        renderer: Optional renderer overriding :data:`DEFAULT_RENDERER`. Use
            this to swap in a different engine (e.g. Jinja2).
        environment: Optional environment mapping used as a fallback for
            placeholders such as ``${ONE_PROMPT_OLLAMA_MODEL}`` (defaults to
            ``os.environ``).
        config: Optional config object used as a final fallback (defaults to
            :mod:`core.config`).

    Raises:
        MissingPromptKeyError: If a placeholder cannot be resolved. The
            placeholder is never rendered literally.
        PromptRenderError: If the template syntax is invalid.
    """

    if renderer is None:
        if environment is None and config is None:
            renderer = DEFAULT_RENDERER
        else:
            renderer = StringTemplateRenderer(environment=environment, config=config)
    return renderer.render(template, context)


#: Optional hook type for callers that prefer a callable resolver.
ResolverCallable = Callable[[str], Any]
