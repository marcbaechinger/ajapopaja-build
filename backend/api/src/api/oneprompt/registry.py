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

"""Template registry for the one-shot AI prompt framework.

Templates live in a dedicated directory, one ``<prompt_id>.prompt`` file per
prompt. Each file starts with a small YAML front-matter header followed by the
template body::

    ---
    id: task_elaborate_spec
    label: Elaborate
    title: Expand the task specification
    description: Turn a dot-list into a full specification.
    model: ${ONE_PROMPT_OLLAMA_MODEL}
    accept_label: Accept
    reject_label: Reject
    ---
    You are helping to elaborate the specification of a task...

The registry auto-discovers every ``*.prompt`` file and exposes the parsed
metadata (labels, model, ...). The front-matter ``id`` must match the file stem
so that the ``promptId`` used by the frontend is unambiguous.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import yaml

logger = logging.getLogger(__name__)

#: Directory containing the bundled ``*.prompt`` templates.
DEFAULT_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

#: Fallbacks used when the front-matter does not declare a value.
DEFAULT_LABEL = ""
DEFAULT_ACCEPT_LABEL = "Accept"
DEFAULT_REJECT_LABEL = "Reject"

# Matches ``---\n<yaml>\n---\n<body>`` where the body is optional.
_FRONT_MATTER_PATTERN = re.compile(
    r"\A---[ \t]*\r?\n(?P<meta>.*?)\r?\n---[ \t]*(?:\r?\n(?P<body>.*))?\Z",
    re.DOTALL,
)


class PromptError(Exception):
    """Base class for one-shot prompt template errors.

    ``status`` mirrors the terminal ``status`` field used by the WebSocket
    protocol (see the design document, section 5) so callers can map an
    exception straight onto a ``quick_prompt_error`` message.
    """

    status = "error"


class PromptNotFoundError(PromptError):
    """Raised when a ``promptId`` does not resolve to a known template."""

    status = "not_found"

    def __init__(self, prompt_id: str) -> None:
        self.prompt_id = prompt_id
        super().__init__(f"Unknown prompt id: {prompt_id!r}")


class PromptTemplateError(PromptError):
    """Raised when a ``*.prompt`` file is malformed."""

    status = "error"


@dataclass(frozen=True)
class PromptTemplate:
    """A parsed prompt template and its metadata.

    ``body`` is the raw template body (using ``$identifier`` / ``${...}``
    placeholders). Use :func:`api.oneprompt.renderer.render_template` to render
    it with a context object.
    """

    id: str
    label: str
    title: str
    description: str
    model: str
    accept_label: str
    reject_label: str
    body: str
    path: Optional[Path] = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    # Convenience aliases so callers can refer to the template source by a
    # natural name without caring which one the parser picked.
    @property
    def content(self) -> str:
        return self.body

    @property
    def text(self) -> str:
        return self.body

    @property
    def source(self) -> str:
        return self.body

    def render(self, context: Optional[Mapping[str, Any]] = None) -> str:
        """Render this template's body with ``context``.

        Imported lazily to keep the registry independent from the renderer
        implementation (and to avoid an import cycle).
        """

        from api.oneprompt.renderer import render_template

        return render_template(self, context)


def _as_str(metadata: Mapping[str, Any], key: str, default: str = "") -> str:
    """Return ``metadata[key]`` coerced to ``str`` falling back to ``default``."""

    value = metadata.get(key)
    if value is None:
        return default
    return str(value)


def parse_template(
    source: str,
    *,
    path: Optional[Path] = None,
    prompt_id: Optional[str] = None,
) -> PromptTemplate:
    """Parse a template ``source`` string into a :class:`PromptTemplate`.

    Args:
        source: Full file contents (front-matter + body).
        path: Optional originating path, stored on the template and used in
            error messages.
        prompt_id: Expected id (usually the file stem). When given, the
            front-matter ``id`` must match it.

    Raises:
        PromptTemplateError: If the front-matter is missing, is not a mapping,
            is not valid YAML or its ``id`` does not match ``prompt_id``.
    """

    location = str(path) if path is not None else (prompt_id or "<template>")
    match = _FRONT_MATTER_PATTERN.match(source)
    if match is None:
        raise PromptTemplateError(
            f"Template {location!r} is missing the YAML front-matter block "
            "delimited by '---' lines."
        )

    try:
        metadata = yaml.safe_load(match.group("meta"))
    except yaml.YAMLError as exc:  # pragma: no cover - exercised via tests
        raise PromptTemplateError(
            f"Template {location!r} has invalid YAML front-matter: {exc}"
        ) from exc

    if metadata is None:
        metadata = {}
    if not isinstance(metadata, Mapping):
        raise PromptTemplateError(
            f"Template {location!r} front-matter must be a YAML mapping, "
            f"got {type(metadata).__name__}."
        )

    template_id = metadata.get("id")
    if template_id is None:
        raise PromptTemplateError(
            f"Template {location!r} front-matter is missing the required 'id'."
        )
    template_id = str(template_id)

    if prompt_id is not None and template_id != prompt_id:
        raise PromptTemplateError(
            f"Template {location!r} front-matter id {template_id!r} does not "
            f"match the file stem {prompt_id!r}."
        )

    body = match.group("body") or ""
    # Drop the blank lines that separate the front-matter from the body and the
    # trailing newline every text editor adds, but keep internal formatting.
    body = body.strip("\r\n")

    return PromptTemplate(
        id=template_id,
        label=_as_str(metadata, "label", DEFAULT_LABEL),
        title=_as_str(metadata, "title", template_id),
        description=_as_str(metadata, "description", ""),
        model=_as_str(metadata, "model", ""),
        accept_label=_as_str(metadata, "accept_label", DEFAULT_ACCEPT_LABEL),
        reject_label=_as_str(metadata, "reject_label", DEFAULT_REJECT_LABEL),
        body=body,
        path=path,
        metadata=dict(metadata),
    )


class PromptRegistry:
    """Discovers and resolves :class:`PromptTemplate` objects by ``promptId``.

    The registry is populated automatically from ``templates_dir`` on
    construction. Call :meth:`reload` to re-scan the directory.
    """

    def __init__(
        self,
        templates_dir: Optional[Path | str] = None,
        *,
        auto_discover: bool = True,
    ) -> None:
        self.templates_dir = (
            Path(templates_dir) if templates_dir is not None else DEFAULT_TEMPLATES_DIR
        )
        self._templates: dict[str, PromptTemplate] = {}
        if auto_discover:
            self.discover()

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------
    def discover(self) -> dict[str, PromptTemplate]:
        """Scan :attr:`templates_dir` for ``*.prompt`` files.

        Returns the mapping of ``promptId -> PromptTemplate`` that was loaded.
        Unknown/malformed templates raise :class:`PromptTemplateError`.
        """

        templates: dict[str, PromptTemplate] = {}
        if not self.templates_dir.is_dir():
            logger.warning(
                "One-shot prompt template directory %s does not exist.",
                self.templates_dir,
            )
            self._templates = templates
            return templates

        for path in sorted(self.templates_dir.glob("*.prompt")):
            template = self.load(path)
            templates[template.id] = template

        self._templates = templates
        logger.debug(
            "Discovered %d one-shot prompt template(s) in %s.",
            len(templates),
            self.templates_dir,
        )
        return templates

    def load(self, path: Path | str) -> PromptTemplate:
        """Load and parse a single ``*.prompt`` file."""

        path = Path(path)
        source = path.read_text(encoding="utf-8")
        return parse_template(source, path=path, prompt_id=path.stem)

    def reload(self) -> dict[str, PromptTemplate]:
        """Re-scan the template directory and return the new mapping."""

        return self.discover()

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------
    def get(self, prompt_id: str) -> PromptTemplate:
        """Resolve a template by id.

        Raises:
            PromptNotFoundError: If no template is registered for ``prompt_id``.
        """

        try:
            return self._templates[prompt_id]
        except KeyError:
            raise PromptNotFoundError(prompt_id) from None

    # ``resolve`` is the vocabulary used by the design document.
    resolve = get

    def find(self, prompt_id: str) -> Optional[PromptTemplate]:
        """Like :meth:`get` but returns ``None`` instead of raising."""

        return self._templates.get(prompt_id)

    def has(self, prompt_id: str) -> bool:
        return prompt_id in self._templates

    # ------------------------------------------------------------------
    # Metadata access
    # ------------------------------------------------------------------
    @property
    def templates(self) -> dict[str, PromptTemplate]:
        """A shallow copy of the ``promptId -> PromptTemplate`` mapping."""

        return dict(self._templates)

    def all(self) -> list[PromptTemplate]:
        """All registered templates, ordered by id."""

        return [self._templates[key] for key in sorted(self._templates)]

    def ids(self) -> list[str]:
        return sorted(self._templates)

    def __contains__(self, prompt_id: object) -> bool:
        return prompt_id in self._templates

    def __getitem__(self, prompt_id: str) -> PromptTemplate:
        return self.get(prompt_id)

    def __iter__(self) -> Iterator[PromptTemplate]:
        return iter(self.all())

    def __len__(self) -> int:
        return len(self._templates)

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------
    def render(
        self,
        prompt_id: str,
        context: Optional[Mapping[str, Any]] = None,
    ) -> str:
        """Resolve ``prompt_id`` and render it with ``context``."""

        from api.oneprompt.renderer import render_template

        return render_template(self.get(prompt_id), context)


#: Default, process-wide registry scanning the bundled templates directory.
registry = PromptRegistry()


def get_registry() -> PromptRegistry:
    """Return the process-wide :data:`registry` (scans templates on first use)."""

    return registry
