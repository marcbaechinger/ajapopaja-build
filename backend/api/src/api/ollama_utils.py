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

import logging
import ollama
from core import config

logger = logging.getLogger(__name__)

async def is_ollama_available() -> bool:
    """
    Checks if Ollama is reachable and responsive.
    """
    try:
        headers = {}
        if config.OLLAMA_API_KEY:
            headers["Authorization"] = f"Bearer {config.OLLAMA_API_KEY}"
        client = ollama.AsyncClient(host=config.OLLAMA_HOST, headers=headers)
        # Ensure we can list models as a health check
        await client.list()
        return True
    except Exception as e:
        logger.warning(f"Ollama is not available at {config.OLLAMA_HOST}: {e}")
        return False
