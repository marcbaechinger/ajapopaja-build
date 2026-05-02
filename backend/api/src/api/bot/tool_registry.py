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

import inspect
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, get_type_hints

logger = logging.getLogger(__name__)


@dataclass
class ToolDefinition:
    name: str
    description: str
    type: str  # "read_only" or "write_access"
    parameters: Dict[str, Any]
    func: Callable
    is_available: Callable[[], bool] = lambda: True


class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}

    def register_tool(
        self,
        func: Callable,
        name: Optional[str] = None,
        description: Optional[str] = None,
        tool_type: str = "read_only",
        parameters: Optional[Dict[str, Any]] = None,
        is_available: Optional[Callable[[], bool]] = None,
    ) -> None:
        """
        Registers a tool, optionally automatically extracting metadata
        from docstrings and type hints.
        """
        tool_name = name or func.__name__

        # If parameters aren't provided, try to generate them from type hints
        if parameters is None:
            parameters = self._generate_json_schema(func)

        # If description is missing, try to extract it from docstring
        if description is None:
            doc = inspect.getdoc(func) or ""
            # Take the first paragraph as description (split by one or more blank lines)
            raw_desc = (
                re.split(r"\n\s*\n", doc)[0].strip() or "No description provided."
            )
            # Collapse multiline description into single line
            description = " ".join(raw_desc.split())
            # Also integrate argument descriptions if they exist in the docstring
            arg_docs = self._parse_docstring_args(doc)
            for arg_name, arg_desc in arg_docs.items():
                if arg_name in parameters["properties"]:
                    parameters["properties"][arg_name]["description"] = arg_desc

        self._tools[tool_name] = ToolDefinition(
            name=tool_name,
            description=description,
            type=tool_type,
            parameters=parameters,
            func=func,
            is_available=is_available or (lambda: True),
        )
        logger.info(f"Registered tool: '{tool_name}' (type: {tool_type})")

    def get_tool(self, name: str) -> Optional[ToolDefinition]:
        return self._tools.get(name)

    def list_tools(self) -> List[ToolDefinition]:
        """Returns a list of tools that are currently available."""
        return [t for t in self._tools.values() if t.is_available()]

    def unregister_tool(self, name: str) -> bool:
        if name in self._tools:
            del self._tools[name]
            return True
        return False

    def _generate_json_schema(self, func: Callable) -> Dict[str, Any]:
        """Generates a JSON schema from function type hints."""
        sig = inspect.signature(func)
        type_hints = get_type_hints(func)

        properties = {}
        required = []

        for param_name, param in sig.parameters.items():
            if (
                param_name in ("self", "cls")
                or param.kind == inspect.Parameter.VAR_KEYWORD
            ):
                continue

            hint = type_hints.get(param_name, Any)
            json_type = self._python_type_to_json(hint)

            properties[param_name] = {"type": json_type}

            # If no default value, it's required
            if param.default is inspect.Parameter.empty:
                required.append(param_name)

        schema = {"type": "object", "properties": properties}
        if required:
            schema["required"] = required

        return schema

    def _python_type_to_json(self, hint: Any) -> str:
        """Simple mapping of Python types to JSON schema types."""
        if hint is str:
            return "string"
        elif hint is int or hint is float:
            return "number"
        elif hint is bool:
            return "boolean"
        elif hasattr(hint, "__origin__"):  # Handle List, Dict, etc.
            origin = hint.__origin__
            if origin is list:
                return "array"
            elif origin is dict:
                return "object"
        return "string"  # Default fallback

    def _parse_docstring_args(self, doc: str) -> Dict[str, str]:
        """
        Parses Google-style docstrings to extract argument descriptions.
        """
        arg_docs = {}
        if not doc:
            return arg_docs

        lines = doc.splitlines()
        in_args_section = False
        current_arg = None
        current_desc = []

        for line in lines:
            stripped = line.strip()
            # Detect section start
            if stripped.lower() in ("args:", "arguments:"):
                in_args_section = True
                continue

            # Detect next section start (capitalized word followed by colon)
            if in_args_section and re.match(r"^[A-Z][a-z]+:", stripped):
                break

            if in_args_section:
                # Detect new argument line: "  name: description"
                match = re.match(r"^\s+([a-zA-Z_0-9]+):\s*(.*)", line)
                if match:
                    # Save previous argument if any
                    if current_arg:
                        arg_docs[current_arg] = " ".join(" ".join(current_desc).split())

                    current_arg = match.group(1)
                    current_desc = [match.group(2).strip()]
                elif current_arg and line.startswith(" "):
                    # Continue description for current argument
                    current_desc.append(line.strip())
                elif stripped == "":
                    # Empty line inside Args usually ends the section or current arg
                    if current_arg:
                        arg_docs[current_arg] = " ".join(" ".join(current_desc).split())
                        current_arg = None
                        current_desc = []

        # Save last argument
        if current_arg:
            arg_docs[current_arg] = " ".join(" ".join(current_desc).split())

        return arg_docs


# Global registry instance
registry = ToolRegistry()
