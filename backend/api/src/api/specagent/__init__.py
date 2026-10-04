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

from .registry import specagent_registry
from . import tools  # noqa: F401
from .actions import register_specagent_actions
from .router import router as specagent_router

# Register the accept/reject/open actions at import time so the notification
# framework can dispatch them as soon as the SpecAgent router is wired up.
register_specagent_actions()

__all__ = [
    "register_specagent_actions",
    "specagent_registry",
    "specagent_router",
]
