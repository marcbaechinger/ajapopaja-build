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

from dataclasses import dataclass, field
from datetime import datetime, UTC
from typing import Any, Dict, Optional


@dataclass
class ConversationTurn:
    turn_id: int
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    role: str = ""  # "user", "assistant", "tool", or "system"
    content: str = ""  # Raw text (potentially truncated)
    tool_name: Optional[str] = None
    tool_args: Optional[Dict[str, Any]] = None
    tool_result: Optional[Any] = None
    success: Optional[bool] = None


def shorten_content(text: str, limit: int = 120) -> str:
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


def prune_value(value: Any) -> Any:
    if isinstance(value, str):
        if len(value) > 100:
            return value[:100] + "..."
        return value
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, list):
        if not value:
            return "[]"
        item_type = type(value[0]).__name__ if value else "unknown"
        return f"[list:{item_type}:{len(value)}]"
    if isinstance(value, dict):
        # Shallow prune
        return {
            k: (
                "[object]"
                if not isinstance(v, (str, int, float, bool, list)) and v is not None
                else prune_value(v)
            )
            for k, v in value.items()
        }
    return "[object]"


def create_log_turn(
    turn_id: int,
    role: str,
    content: str,
    tool_name: Optional[str] = None,
    tool_args: Optional[Dict[str, Any]] = None,
    tool_result: Optional[Any] = None,
    success: Optional[bool] = None,
) -> ConversationTurn:
    return ConversationTurn(
        turn_id=turn_id,
        timestamp=datetime.now(UTC),
        role=role,
        content=shorten_content(content),
        tool_name=tool_name,
        tool_args=prune_value(tool_args) if tool_args else None,
        tool_result=prune_value(tool_result) if tool_result is not None else None,
        success=success,
    )
