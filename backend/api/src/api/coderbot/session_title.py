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

"""Backend support for the ``session_generate_title`` one-shot prompt.

This module turns a stored Pi session into a short, human readable title. It is
a declarative one-shot use case (see ``design/dd_one_shot_ai.md``): a template
(``templates/session_generate_title.prompt``) plus a data-provider
(``pre_render``) and a response normaliser (``post_response``) registered by
:func:`register_session_title_hooks`.

The interesting part is recovering the text a user actually typed, because Pi
does **not** echo the prompt back as a top-level event. Instead the persisted
raw-RPC replay log (``events.jsonl``) is mined for the first ``role == "user"``
message. When the event log is unavailable (disabled or empty for an old
session) the native Pi session file is parsed as a best-effort fallback, and for
batch sessions the linked ``Task.title`` is used as a last resort.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any, Optional

from core import config
from core.models.models import PiSession, PiSessionKind, Task

from api.oneprompt.context import ContextProviderError
from api.oneprompt.hooks import PromptHook, get_hook, register_hook

from .pi_session_store import read_session_events

logger = logging.getLogger(__name__)

__all__ = [
    "SESSION_GENERATE_TITLE",
    "extract_first_user_prompt",
    "extract_first_user_prompt_from_native_file",
    "normalize_title",
    "provide_session_title_context",
    "read_first_user_prompt",
    "register_session_title_hooks",
    "unregister_session_title_hooks",
]

#: Prompt id of the bundled "generate a session title" use case.
SESSION_GENERATE_TITLE = "session_generate_title"

#: Accepted aliases for the session uid in the incoming context. The frontend
#: sends camelCase, the rest of the backend uses snake_case; both are accepted.
_SESSION_UID_KEYS = ("session_uid", "sessionUid", "uid")

#: Characters that are commonly wrapped around a model's title output.
_QUOTE_PAIRS = (
    ('"', '"'),
    ("'", "'"),
    ("`", "`"),
    ("\u201c", "\u201d"),
    ("\u2018", "\u2019"),
    ("\u00ab", "\u00bb"),
)

#: A single/triple code fence around the whole answer (or at either end).
_FENCE_RE = re.compile(r"^```[^\n`]*\s*|\s*```$", re.MULTILINE)

#: Prefixes a model likes to add, e.g. ``Title:`` or ``Session name -``.
_TITLE_PREFIX_RE = re.compile(
    r"^(?:(?:session|chat|conversation)\s+)?"
    r"(?:title|name|heading|subject)\s*[:\-\u2013\u2014]\s*",
    re.IGNORECASE,
)

#: Trailing punctuation trimmed after a word-boundary truncation.
_TRAILING_PUNCTUATION = " \t\r\n-–—:;,.!?\"'`"


# ---------------------------------------------------------------------------
# Pure extraction
# ---------------------------------------------------------------------------
def _extract_text(content: Any) -> Optional[str]:
    """Return the textual content of a Pi message payload.

    ``content`` is either a plain string or a list of content blocks (mirroring
    :func:`api.coderbot.pi_parsers.extract_final_summary`). Only ``text`` blocks
    are considered; unknown shapes are ignored rather than raising so event
    shape drift across Pi versions never crashes a title request.
    """

    if content is None:
        return None
    if isinstance(content, str):
        text = content.strip()
        return text or None
    if isinstance(content, (list, tuple)):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, Mapping):
                if block.get("type") == "text":
                    text = block.get("text")
                    if text:
                        parts.append(str(text))
        joined = "\n".join(part for part in parts if part).strip()
        return joined or None
    return None


def _iter_event_messages(event: Any) -> Iterator[Mapping[str, Any]]:
    """Yield the message envelopes carried by a single replay event.

    Supports the shapes documented in ``dd_one_shot_ai.md`` (and used by the
    real logs):

    * ``{"message": {"role": ..., "content": ...}}`` — ``message_start`` /
      ``message_end``,
    * ``{"messages": [{"role": ..., "content": ...}, ...]}`` — ``agent_end``,
    * a bare ``{"role": ..., "content": ...}`` envelope.
    """

    if not isinstance(event, Mapping):
        return

    message = event.get("message")
    if isinstance(message, Mapping):
        yield message

    messages = event.get("messages")
    if isinstance(messages, (list, tuple)):
        for item in messages:
            if isinstance(item, Mapping):
                yield item

    if "role" in event and "content" in event:
        yield event


def extract_first_user_prompt(events: Any) -> Optional[str]:
    """Return the text of the first ``role == "user"`` message in ``events``.

    Walks the events in order and returns the text of the first user message
    found. The content may be a plain string or a list of
    ``{"type": "text", "text": ...}`` blocks. Returns ``None`` when no user
    message is present (or the list is malformed).
    """

    if not isinstance(events, (list, tuple)):
        return None

    for event in events:
        for message in _iter_event_messages(event):
            if message.get("role") != "user":
                continue
            text = _extract_text(message.get("content"))
            if text:
                return text
    return None


def extract_first_user_prompt_from_native_file(path: Any) -> Optional[str]:
    """Best-effort first user prompt from a native Pi session file.

    Pi stores its conversation as a version-3 ``id``/``parentId`` JSONL tree.
    Each line is parsed on its own; the first entry carrying a user message
    wins. Missing/unreadable files yield ``None`` instead of raising.
    """

    if not path:
        return None
    try:
        file_path = Path(str(path))
    except (TypeError, ValueError):  # pragma: no cover - defensive
        return None
    if not file_path.is_file():
        return None

    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                for message in _iter_event_messages(entry):
                    if message.get("role") != "user":
                        continue
                    text = _extract_text(message.get("content"))
                    if text:
                        return text
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Failed to parse native Pi session file %s: %s", path, exc)
    return None


# ---------------------------------------------------------------------------
# IO-backed reading
# ---------------------------------------------------------------------------
def _first_present(context: Mapping[str, Any], *keys: str) -> Optional[Any]:
    """Return the first non-empty value among ``keys`` in ``context``."""

    for key in keys:
        if key in context:
            value = context[key]
            if value is not None and value != "":
                return value
    return None


async def read_first_user_prompt(
    uid: str, record: Optional[PiSession] = None
) -> Optional[str]:
    """Return the first user prompt stored for the session ``uid``.

    Sources are tried in order:

    1. the persisted ``events.jsonl`` replay log (interactive and batch),
    2. the native Pi session file (``record.pi_session_file``),
    3. for batch sessions, the linked ``Task.title`` (the seed prompt).

    Returns ``None`` when none of the sources yield text.
    """

    uid = str(uid)

    prompt = extract_first_user_prompt(read_session_events(uid))
    if prompt:
        return prompt

    if record is None:
        try:
            record = await PiSession.find_one(PiSession.uid == uid)
        except Exception as exc:  # pragma: no cover - DB unavailable
            logger.debug("Failed to load PiSession %s: %s", uid, exc)
            record = None

    if record is None:
        return None

    prompt = extract_first_user_prompt_from_native_file(
        getattr(record, "pi_session_file", None)
    )
    if prompt:
        return prompt

    # Coarse fallback: batch sessions were seeded with the task title.
    if getattr(record, "kind", None) == PiSessionKind.CODERBOT:
        task_id = getattr(record, "task_id", None)
        if task_id:
            try:
                task = await Task.get(str(task_id))
            except Exception as exc:  # pragma: no cover - DB unavailable
                logger.debug("Failed to load task %s: %s", task_id, exc)
                task = None
            title = getattr(task, "title", None) if task is not None else None
            if title:
                cleaned = str(title).strip()
                if cleaned:
                    return cleaned

    return None


# ---------------------------------------------------------------------------
# Data provider (pre_render hook)
# ---------------------------------------------------------------------------
async def provide_session_title_context(context: Any) -> dict:
    """Enrich a ``session_generate_title`` context with the first user prompt.

    The frontend only sends ``{sessionUid}``. This provider loads the durable
    :class:`~core.models.models.PiSession` record, extracts its first user
    prompt and injects:

    * ``session_uid`` / ``sessionUid`` — the normalised uid,
    * ``first_user_prompt`` — the prompt the model must name,
    * ``max_title_length`` — :data:`core.config.SESSION_TITLE_MAX_LENGTH`.

    Raises:
        ContextProviderError: When the context has no session uid, the session
            does not exist, or no user prompt can be recovered (``status`` is
            ``"not_found"`` in the latter two cases).
    """

    if not isinstance(context, Mapping):
        raise ContextProviderError(
            f"One-shot prompt context must be a mapping, got {type(context).__name__}."
        )

    session_uid = _first_present(context, *_SESSION_UID_KEYS)
    if session_uid is None:
        raise ContextProviderError(
            "One-shot prompt context is missing a session uid "
            "(expected 'sessionUid' or 'session_uid')."
        )
    session_uid = str(session_uid)

    try:
        record = await PiSession.find_one(PiSession.uid == session_uid)
    except Exception as exc:  # pragma: no cover - DB unavailable
        raise ContextProviderError(
            f"Could not load session {session_uid!r}: {exc}"
        ) from exc

    if record is None:
        raise ContextProviderError(
            f"Session {session_uid!r} was not found.",
            status="not_found",
        )

    first_user_prompt = await read_first_user_prompt(session_uid, record=record)
    if not first_user_prompt:
        raise ContextProviderError(
            f"Session {session_uid!r} has no stored user prompt to name.",
            status="not_found",
        )

    enriched = dict(context)
    enriched.update(
        {
            "session_uid": session_uid,
            "sessionUid": session_uid,
            "first_user_prompt": first_user_prompt,
            "max_title_length": config.SESSION_TITLE_MAX_LENGTH,
        }
    )
    return enriched


# ---------------------------------------------------------------------------
# Response normaliser (post_response hook)
# ---------------------------------------------------------------------------
def _strip_wrapping_quotes(text: str) -> str:
    """Repeatedly strip matching quote pairs from both ends of ``text``."""

    changed = True
    while changed and len(text) >= 2:
        changed = False
        for open_quote, close_quote in _QUOTE_PAIRS:
            if text[0] == open_quote and text[-1] == close_quote:
                text = text[1:-1].strip()
                changed = True
                break
    return text


def _truncate_title(text: str, max_len: int) -> str:
    """Truncate ``text`` to at most ``max_len`` characters on a word boundary."""

    if max_len <= 0 or len(text) <= max_len:
        return text
    truncated = text[:max_len]
    cut = max(truncated.rfind(" "), truncated.rfind("\t"))
    if cut >= max_len // 2:
        truncated = truncated[:cut]
    return truncated.rstrip(_TRAILING_PUNCTUATION).strip()


def normalize_title(raw: Any, max_len: Optional[int] = None) -> str:
    """Normalise a raw model answer into a single-line session title.

    Strips code fences, ``Title:``-style prefixes and wrapping quotes, collapses
    all whitespace to one line and truncates to ``max_len`` characters on a word
    boundary. ``max_len`` defaults to
    :data:`core.config.SESSION_TITLE_MAX_LENGTH`.

    Raises:
        ContextProviderError: When the cleaned title is empty (the model
            returned nothing usable). The runner turns this into a
            ``quick_prompt_error`` so the UI can show a friendly message.
    """

    if max_len is None:
        max_len = config.SESSION_TITLE_MAX_LENGTH
    try:
        max_len = int(max_len)
    except (TypeError, ValueError):  # pragma: no cover - defensive
        max_len = config.SESSION_TITLE_MAX_LENGTH

    text = "" if raw is None else str(raw)
    text = text.strip()
    if not text:
        raise ContextProviderError(
            "The model did not return a usable session title.", status="error"
        )

    # Strip fences, wrapping quotes and "Title:" prefixes in a loop because the
    # model may combine them in any order (e.g. a fenced, quoted "Title:").
    for _ in range(3):
        text = _FENCE_RE.sub("", text).strip()
        text = _strip_wrapping_quotes(text)
        text = _TITLE_PREFIX_RE.sub("", text).strip()
    text = re.sub(r"\s+", " ", text).strip()
    text = _strip_wrapping_quotes(text)
    text = re.sub(r"\s+", " ", text).strip()
    text = _truncate_title(text, max_len)

    if not text:
        raise ContextProviderError(
            "The model did not return a usable session title.", status="error"
        )
    return text


def _session_title_post_response(raw_output: Any, context: Any) -> str:
    """``post_response`` stage for ``session_generate_title``.

    Reads ``max_title_length`` from the enriched context so the template and the
    normaliser agree on the limit, then delegates to :func:`normalize_title`.
    """

    max_len: Optional[int] = None
    if isinstance(context, Mapping):
        value = context.get("max_title_length")
        if value is not None:
            try:
                max_len = int(value)
            except (TypeError, ValueError):
                max_len = None
    return normalize_title(raw_output, max_len)


# Natural aliases used by callers/tests.
extract_first_user_message = extract_first_user_prompt
first_user_prompt = extract_first_user_prompt
session_title_provider = provide_session_title_context
normalise_title = normalize_title


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------
def register_session_title_hooks() -> PromptHook:
    """Register the provider + normaliser for ``session_generate_title``.

    Called from the application lifespan next to ``initialize_oneprompt()``.
    Returns the registered hook.
    """

    hook = PromptHook(
        pre_render=provide_session_title_context,
        post_response=_session_title_post_response,
    )
    register_hook(SESSION_GENERATE_TITLE, hook)
    logger.debug("Registered session title one-shot hooks.")
    return get_hook(SESSION_GENERATE_TITLE)


def unregister_session_title_hooks() -> None:
    """Remove the ``session_generate_title`` hooks (mainly for tests)."""

    from api.oneprompt.hooks import unregister_hook

    unregister_hook(SESSION_GENERATE_TITLE)
