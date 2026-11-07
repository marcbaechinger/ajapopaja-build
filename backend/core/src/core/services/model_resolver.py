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

"""Central model resolver and model catalog helpers.

Model selection is a three-level precedence:

1. a per-pipeline override stored on the :class:`~core.models.models.Pipeline`,
2. a per-use-case value configured through the environment (as resolved in
   :mod:`core.config`, which already folds in the global ``OLLAMA_MODEL`` and
   the hard-coded default),
3. the global configuration value.

Keeping this logic in one place ensures every call site (ArchBot, ReviewBot,
DocBot, the assistant, the one-shot prompt runner and CoderBot) applies the
same rule.

This module also exposes the read-only catalogs used by the UI's model
configuration dialog:

* :func:`list_ollama_models` — the tags reported by ``ollama list``,
* :func:`list_coderbot_models` — the pi-agent model ids from ``models.json``.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable, Optional

import ollama

from core import config
from core.models.models import Pipeline, _normalize_model_override

logger = logging.getLogger(__name__)

__all__ = [
    "USE_CASES",
    "list_coderbot_models",
    "list_ollama_models",
    "normalize_model",
    "parse_coderbot_models",
    "resolve_model",
]

#: Maps a use case to ``(pipeline field name, config fallback provider)``.
#: The fallback is a zero-argument callable so monkeypatched config values are
#: always read at resolution time.
USE_CASES: dict[str, tuple[str, Callable[[], Optional[str]]]] = {
    "one_prompt": ("one_prompt_model", lambda: config.ONE_PROMPT_OLLAMA_MODEL),
    "assistant": ("assistant_model", lambda: config.ASSISTANT_MODEL),
    "archbot": ("archbot_model", lambda: config.ARCHBOT_MODEL),
    "reviewbot": ("reviewbot_model", lambda: config.REVIEWBOT_MODEL),
    "docbot": ("docbot_model", lambda: config.DOCBOT_MODEL),
    "specagent": ("specagent_model", lambda: config.SPECAGENT_MODEL),
    "coderbot": ("coderbot_model", lambda: config.CODERBOT_MODEL),
}

#: Use cases that fall back to the global Ollama model and are therefore also
#: satisfied by a pipeline's generic ``ollama_model`` override. CoderBot is
#: deliberately excluded: it selects a pi-agent model from ``models.json``
#: rather than an Ollama tag.
_GENERAL_OLLAMA_USE_CASES = frozenset(
    {"one_prompt", "assistant", "archbot", "reviewbot", "docbot", "specagent"}
)

#: Sentinel distinguishing "no explicit default supplied" from ``None``.
_UNSET: Any = object()


def normalize_model(value: Any) -> Optional[str]:
    """Backwards-friendly public alias for the model-name normalizer."""

    return _normalize_model_override(value)


def resolve_model(
    use_case: str,
    pipeline: Optional[Pipeline] = None,
    *,
    default: Any = _UNSET,
) -> Optional[str]:
    """Resolve the model for ``use_case`` using the documented precedence.

    1. the pipeline's per-use-case override,
    2. the pipeline's generic ``ollama_model`` override (Ollama use cases only),
    3. ``default`` when explicitly supplied (e.g. a manager runtime default),
    4. the value from :mod:`core.config`.

    ``coderbot`` may legitimately resolve to ``None`` (no ``--model`` flag).
    """

    try:
        field_name, fallback = USE_CASES[use_case]
    except KeyError as exc:  # pragma: no cover - programming error
        raise ValueError(f"Unknown model use case: {use_case!r}") from exc

    if pipeline is not None:
        override = _normalize_model_override(getattr(pipeline, field_name, None))
        if override:
            return override
        if use_case in _GENERAL_OLLAMA_USE_CASES:
            general = _normalize_model_override(getattr(pipeline, "ollama_model", None))
            if general:
                return general

    if default is not _UNSET:
        return default
    return fallback()


# ---------------------------------------------------------------------------
# Catalog helpers
# ---------------------------------------------------------------------------


def _extract_model_names(response: Any) -> list[str]:
    """Extract model names from an ``ollama`` list response (object or dict)."""

    models = getattr(response, "models", None)
    if models is None and isinstance(response, dict):
        models = response.get("models")

    names: list[str] = []
    for model in models or []:
        if isinstance(model, dict):
            name = model.get("model") or model.get("name")
        else:
            name = getattr(model, "model", None) or getattr(model, "name", None)
        if name:
            names.append(str(name))
    return names


async def list_ollama_models() -> list[str]:
    """Return the model tags available on the configured Ollama server.

    Never raises: when Ollama is unreachable or returns an unexpected shape an
    empty list is returned so the UI can degrade to a free-text/empty state.
    """

    try:
        headers: dict[str, str] = {}
        if config.OLLAMA_API_KEY:
            headers["Authorization"] = f"Bearer {config.OLLAMA_API_KEY}"
        client = ollama.AsyncClient(host=config.OLLAMA_HOST, headers=headers)
        response = await client.list()
        return _extract_model_names(response)
    except Exception as exc:  # noqa: BLE001 - the UI must never see a failure
        logger.warning(
            "Failed to list Ollama models at %s: %s", config.OLLAMA_HOST, exc
        )
        return []


def parse_coderbot_models(data: Any) -> list[str]:
    """Return every ``providers.*.models[].id`` from a parsed ``models.json``."""

    if not isinstance(data, dict):
        return []
    providers = data.get("providers")
    if not isinstance(providers, dict):
        return []

    model_ids: list[str] = []
    for provider in providers.values():
        if not isinstance(provider, dict):
            continue
        models = provider.get("models")
        if not isinstance(models, list):
            continue
        for model in models:
            if not isinstance(model, dict):
                continue
            model_id = _normalize_model_override(model.get("id"))
            if model_id:
                model_ids.append(model_id)
    return model_ids


def _models_json_candidates() -> list[Path]:
    """Configured ``models.json`` path plus the repo-relative dev fallback."""

    candidates: list[Path] = []
    configured = getattr(config, "PI_AGENT_MODELS_PATH", None)
    if configured:
        candidates.append(Path(configured))
    # ``model_resolver.py`` lives at ``<repo>/backend/core/src/core/services``.
    repo_relative = (
        Path(__file__).resolve().parents[5] / "docker" / "pi-agent" / "models.json"
    )
    if repo_relative not in candidates:
        candidates.append(repo_relative)
    return candidates


def list_coderbot_models(path: Optional[Path] = None) -> list[str]:
    """Return the pi-agent model ids configured for CoderBot.

    Reads the first readable/parseable ``models.json`` candidate and returns an
    empty list on any error. ``path`` is exposed for tests.
    """

    candidates = [Path(path)] if path is not None else _models_json_candidates()
    for candidate in candidates:
        try:
            with candidate.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:  # noqa: BLE001 - missing/invalid file degrades to []
            continue
        return parse_coderbot_models(data)
    return []
