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

import asyncio
import logging

import ollama

from core import config

logger = logging.getLogger(__name__)

# Cache for Ollama availability to avoid repeated connection attempts
_ollama_available: bool | None = None


async def is_ollama_available() -> bool:
    """
    Checks if Ollama is reachable and responsive.

    Retries up to 3 times in case of failure. Once the availability is determined,
    the result is cached and returned in future calls. A server restart is required
    to trigger a new check.
    """
    global _ollama_available
    if _ollama_available is not None:
        return _ollama_available

    headers = {}
    if config.OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {config.OLLAMA_API_KEY}"

    client = ollama.AsyncClient(host=config.OLLAMA_HOST, headers=headers)

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        logger.info(
            f"Attempting to connect to Ollama at {config.OLLAMA_HOST} "
            f"(attempt {attempt}/{max_retries})..."
        )
        try:
            # Ensure we can list models as a health check
            await client.list()
            logger.info("Ollama is available and responsive.")
            _ollama_available = True
            return True
        except Exception as e:
            logger.warning(f"Ollama connection attempt {attempt} failed: {e}")
            if attempt < max_retries:
                await asyncio.sleep(1)  # Brief pause before retrying
            else:
                logger.error(
                    f"Ollama is not available at {config.OLLAMA_HOST} after "
                    f"{max_retries} attempts. Marking as unavailable for the "
                    "remainder of this session."
                )

    _ollama_available = False
    return False
