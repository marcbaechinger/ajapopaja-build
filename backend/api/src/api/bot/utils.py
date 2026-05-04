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

from api.bot.base_session import BaseBotSession


def generate_execution_report(session: BaseBotSession) -> str:
    """
    Generates a brief Markdown execution report for a bot session.
    """
    stats = session.get_summary_stats()

    # Determine status
    if stats["finished_via_terminal_tool"]:
        if stats["reached_turn_warning"]:
            status = "⚠️ Complete (Forced)"
        else:
            status = "✅ Complete"
    else:
        status = "❌ Timed Out"

    success_rate = f"{stats['success_rate'] * 100:.0f}%"

    # Get last few tool calls for the activity log
    tool_calls = [t for t in session.conversation_log if t.role == "tool"]
    activity_log = ""
    for t in tool_calls[-5:]:  # Show last 5 tool calls
        status_emoji = "✅" if t.success else "❌"
        activity_log += f"- {status_emoji} `{t.tool_name}`\n"

    if not activity_log:
        activity_log = "- No tool calls recorded.\n"

    report = f"""
---

### 🤖 Execution Report
- **Status**: {status}
- **Turns**: {stats["iterations_used"]} / {stats["max_iterations"]}
- **Tool Success Rate**: {success_rate}

#### Activity Log (Last 5)
{activity_log}
"""

    return report
