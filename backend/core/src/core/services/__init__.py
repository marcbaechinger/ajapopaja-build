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

"""Reusable application services that are decoupled from the REST routers.

The :class:`~core.services.dev_process_manager.DevProcessManager` is the
service that owns the lifecycle of per-pipeline development-server processes.
It can be used by the REST API, agent tools or any other part of the
application.
"""

from core.services.dev_process_manager import (
    DevProcessAlreadyRunningError,
    DevProcessError,
    DevProcessManager,
    DevProcessNotFoundError,
    ProcessInfo,
)

__all__ = [
    "DevProcessManager",
    "DevProcessError",
    "DevProcessAlreadyRunningError",
    "DevProcessNotFoundError",
    "ProcessInfo",
]
