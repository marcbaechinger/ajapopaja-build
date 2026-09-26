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

"""Compatibility re-export of :mod:`api.coderbot.pi_rpc_process`."""

import asyncio  # noqa: F401  (kept so `...pi_rpc_process.asyncio` patch targets resolve)

from api.coderbot.pi_rpc_process import (  # noqa: F401
    DEFAULT_COMMAND_TIMEOUT,
    STDIO_BUFFER_LIMIT,
    PiRpcProcess,
)

__all__ = ["PiRpcProcess", "DEFAULT_COMMAND_TIMEOUT", "STDIO_BUFFER_LIMIT"]
