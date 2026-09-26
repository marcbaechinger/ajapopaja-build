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

from api.coderbot.pi_parsers import (
    DEFAULT_SUMMARY,
    extract_final_summary,
    extract_text_delta,
    extract_thinking_delta,
    extract_tool_call_name,
)


def _message_update(delta):
    return {"type": "message_update", "assistantMessageEvent": delta}


def test_extract_text_delta_returns_delta():
    event = _message_update({"type": "text_delta", "delta": "Hello"})
    assert extract_text_delta(event) == "Hello"


def test_extract_text_delta_ignores_thinking_and_non_updates():
    thinking = _message_update({"type": "thinking_delta", "delta": "x"})
    assert extract_text_delta(thinking) is None
    assert extract_text_delta({"type": "agent_start"}) is None
    assert extract_text_delta(None) is None
    assert extract_text_delta(_message_update({"type": "text_delta"})) is None


def test_extract_thinking_delta_returns_delta():
    event = _message_update({"type": "thinking_delta", "delta": "hmm"})
    assert extract_thinking_delta(event) == "hmm"
    text_event = _message_update({"type": "text_delta", "delta": "x"})
    assert extract_thinking_delta(text_event) is None


def test_extract_tool_call_name_supports_tool_name_shape():
    event = _message_update({"type": "toolcall_start", "toolName": "bash"})
    assert extract_tool_call_name(event) == "bash"


def test_extract_tool_call_name_supports_partial_shape():
    event = _message_update(
        {"type": "toolcall_start", "partial": {"toolCall": {"name": "write"}}}
    )
    assert extract_tool_call_name(event) == "write"


def test_extract_tool_call_name_defaults_and_ignores_other_events():
    start = _message_update({"type": "toolcall_start"})
    assert extract_tool_call_name(start) == "tool"
    text_event = _message_update({"type": "text_delta", "delta": "x"})
    assert extract_tool_call_name(text_event) is None
    assert extract_tool_call_name({"type": "message_update"}) is None


def test_extract_final_summary_returns_last_assistant_text():
    messages = [
        {"role": "user", "content": [{"type": "text", "text": "hi"}]},
        {
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "..."},
                {"type": "text", "text": "first"},
            ],
        },
        {
            "role": "assistant",
            "content": [{"type": "text", "text": "final answer"}],
        },
    ]
    assert extract_final_summary(messages) == "final answer"


def test_extract_final_summary_handles_string_content_and_truncation():
    long_text = "a" * 5000
    messages = [{"role": "assistant", "content": long_text}]
    assert len(extract_final_summary(messages)) == 2000


def test_extract_final_summary_falls_back_to_default():
    assert extract_final_summary([]) == DEFAULT_SUMMARY
    assert extract_final_summary(None) == DEFAULT_SUMMARY
    assert extract_final_summary([{"role": "user", "content": []}]) == DEFAULT_SUMMARY
