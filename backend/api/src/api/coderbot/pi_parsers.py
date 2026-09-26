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

"""Pure helpers for extracting data from raw Pi RPC JSON dictionaries.

These functions contain no process/IO state so they can be unit tested in
isolation and reused by every :class:`~api.coderbot.pi_rpc_process.PiRpcProcess`
subclass.
"""

from typing import Any, Dict, List, Optional

# Summary used when Pi finished without producing a textual assistant message.
DEFAULT_SUMMARY = "Task completed by Pi."

# Assistant summaries are truncated before they are stored on a PullRequest so a
# chatty agent cannot blow up the database/document size.
MAX_SUMMARY_LENGTH = 2000


def _message_update_delta(event: Any) -> Optional[Dict[str, Any]]:
    """Return the ``assistantMessageEvent`` payload of a ``message_update``.

    Returns ``None`` for any other record shape so callers can chain the
    ``extract_*`` helpers without defensive checks.
    """
    if not isinstance(event, dict):
        return None
    if event.get("type") != "message_update":
        return None
    delta = event.get("assistantMessageEvent")
    return delta if isinstance(delta, dict) else None


def extract_text_delta(event: Any) -> Optional[str]:
    """Extract the streamed text delta from a ``message_update`` event.

    Only ``text_delta`` records are considered; thinking output is handled by
    :func:`extract_thinking_delta`.
    """
    delta = _message_update_delta(event)
    if delta is None or delta.get("type") != "text_delta":
        return None
    value = delta.get("delta")
    return value if value else None


def extract_thinking_delta(event: Any) -> Optional[str]:
    """Extract the streamed thinking delta from a ``message_update`` event."""
    delta = _message_update_delta(event)
    if delta is None or delta.get("type") != "thinking_delta":
        return None
    value = delta.get("delta")
    return value if value else None


def extract_tool_call_name(event: Any) -> Optional[str]:
    """Extract the tool name from a ``toolcall_start`` ``message_update``.

    Newer Pi releases expose the name directly as ``toolName`` while older ones
    nest it below ``partial.toolCall.name``; both shapes are supported. When the
    event is a tool call but carries no name the generic ``"tool"`` placeholder
    is returned so callers can always render something meaningful.
    """
    delta = _message_update_delta(event)
    if delta is None or delta.get("type") != "toolcall_start":
        return None

    name = delta.get("toolName")
    if not name:
        partial = delta.get("partial")
        if isinstance(partial, dict):
            tool_call = partial.get("toolCall")
            if isinstance(tool_call, dict):
                name = tool_call.get("name")
    return name or "tool"


def extract_final_summary(messages: Any) -> str:
    """Return the last textual assistant message from an ``agent_end`` payload.

    Pi reports the final conversation under the ``messages`` key of the
    ``agent_end`` event. This helper walks the messages in reverse and returns
    the last assistant text block (truncated to :data:`MAX_SUMMARY_LENGTH`),
    falling back to :data:`DEFAULT_SUMMARY` when no text is available.
    """
    if not isinstance(messages, list):
        return DEFAULT_SUMMARY

    for message in reversed(messages):
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue

        content: List[Any] | str = message.get("content", [])
        if isinstance(content, str):
            return (content or DEFAULT_SUMMARY)[:MAX_SUMMARY_LENGTH]
        if not isinstance(content, list):
            break
        for block in reversed(content):
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text") or DEFAULT_SUMMARY
                return text[:MAX_SUMMARY_LENGTH]
        break

    return DEFAULT_SUMMARY
