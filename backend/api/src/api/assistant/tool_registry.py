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

from dataclasses import dataclass
from typing import Callable, Dict, List, Any, Optional

@dataclass
class ToolDefinition:
    name: str
    description: str
    type: str  # "read_only" or "write_access"
    parameters: Dict[str, Any]
    func: Callable

class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}

    def register_tool(
        self, 
        name: str, 
        description: str, 
        tool_type: str, 
        parameters: Dict[str, Any], 
        func: Callable
    ) -> None:
        if name in self._tools:
            # We could raise an error or just overwrite. 
            # Given dynamic loading, overwriting might be safer or warned.
            pass
        
        self._tools[name] = ToolDefinition(
            name=name,
            description=description,
            type=tool_type,
            parameters=parameters,
            func=func
        )

    def get_tool(self, name: str) -> Optional[ToolDefinition]:
        return self._tools.get(name)

    def list_tools(self) -> List[ToolDefinition]:
        return list(self._tools.values())

    def unregister_tool(self, name: str) -> bool:
        if name in self._tools:
            del self._tools[name]
            return True
        return False

# Global registry instance
registry = ToolRegistry()
