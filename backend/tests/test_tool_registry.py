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

import pytest
from api.assistant.tool_registry import ToolRegistry
from api.assistant.decorators import register_tool

def test_tool_registry_registration():
    registry = ToolRegistry()
    
    async def my_tool(arg1: str):
        return f"Result: {arg1}"
    
    registry.register_tool(
        name="test_tool",
        description="A test tool",
        tool_type="read_only",
        parameters={"type": "object", "properties": {"arg1": {"type": "string"}}},
        func=my_tool
    )
    
    tool = registry.get_tool("test_tool")
    assert tool is not None
    assert tool.name == "test_tool"
    assert tool.description == "A test tool"
    assert tool.type == "read_only"
    assert tool.func == my_tool

def test_tool_registry_list_unregister():
    registry = ToolRegistry()
    
    async def tool1(): pass
    async def tool2(): pass
    
    registry.register_tool(tool1, name="t1", description="d1", tool_type="read_only", parameters={})
    registry.register_tool(tool2, name="t2", description="d2", tool_type="write_access", parameters={})
    
    tools = registry.list_tools()
    assert len(tools) == 2
    
    assert registry.unregister_tool("t1") is True
    assert len(registry.list_tools()) == 1
    assert registry.get_tool("t1") is None

@pytest.mark.asyncio
async def test_register_tool_decorator():
    # We use the global registry for the decorator test
    from api.assistant.tool_registry import registry as global_registry
    
    @register_tool(
        name="decorated_tool",
        description="Decorated description",
        tool_type="write_access",
        parameters={"p": 1}
    )
    async def my_decorated_func(p: int):
        return p * 2
    
    tool = global_registry.get_tool("decorated_tool")
    assert tool is not None
    assert tool.name == "decorated_tool"
    assert tool.description == "Decorated description"
    assert tool.type == "write_access"
    assert tool.parameters == {"p": 1}
    
    result = await tool.func(5)
    assert result == 10
    
    # Test default values from docstring and function name
    @register_tool()
    async def default_name_tool():
        """This is a docstring."""
        return "default"
    
    tool2 = global_registry.get_tool("default_name_tool")
    assert tool2 is not None
    assert tool2.description == "This is a docstring."

@pytest.mark.asyncio
async def test_automatic_metadata_extraction():
    from api.assistant.tool_registry import ToolRegistry
    registry = ToolRegistry()
    
    @register_tool(tool_type="read_only")
    async def complex_tool(pipeline_id: str, count: int = 5):
        """
        A complex tool description.
        
        Args:
            pipeline_id: The ID of the pipeline.
            count: How many items to return.
        """
        return f"{pipeline_id}: {count}"
    
    # We need to manually register it to the local registry for this test 
    # as the decorator uses the global one.
    registry.register_tool(complex_tool, tool_type="read_only")
    
    tool = registry.get_tool("complex_tool")
    assert tool is not None
    assert tool.description == "A complex tool description."
    assert tool.parameters["type"] == "object"
    assert "pipeline_id" in tool.parameters["properties"]
    assert "count" in tool.parameters["properties"]
    assert tool.parameters["properties"]["pipeline_id"]["type"] == "string"
    assert tool.parameters["properties"]["pipeline_id"]["description"] == "The ID of the pipeline."
    assert tool.parameters["properties"]["count"]["type"] == "number"
    assert tool.parameters["properties"]["count"]["description"] == "How many items to return."
    assert "pipeline_id" in tool.parameters["required"]
    assert "count" not in tool.parameters["required"]
