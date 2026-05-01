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

from fastmcp import FastMCP

from ajapopaja_mcp import tools

# Create an MCP server
mcp = FastMCP("Ajapopaja Build MCP")

# Register tools
mcp.tool()(tools.get_next_task)
mcp.tool()(tools.update_task_design_doc)
mcp.tool()(tools.complete_task)
mcp.tool()(tools.search_tasks)
mcp.tool()(tools.get_task_details)
mcp.tool()(tools.get_task_status)

if __name__ == "__main__":
    mcp.run()
