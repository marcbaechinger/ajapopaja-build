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

from functools import wraps
from typing import Callable, Dict, Any, Optional
from api.assistant.tool_registry import registry


def register_tool(
    name: Optional[str] = None,
    description: Optional[str] = None,
    tool_type: str = "read_only",
    parameters: Optional[Dict[str, Any]] = None,
):
    def decorator(func: Callable):
        registry.register_tool(
            func=func,
            name=name,
            description=description,
            tool_type=tool_type,
            parameters=parameters,
        )

        @wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)

        return wrapper

    return decorator
