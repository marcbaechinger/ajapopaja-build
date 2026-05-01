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

from unittest.mock import AsyncMock, patch

import pytest

import api.ollama_utils
from api.ollama_utils import is_ollama_available


@pytest.fixture(autouse=True)
def reset_ollama_cache():
    """Reset the module-level cache before and after each test."""
    api.ollama_utils._ollama_available = None
    yield
    api.ollama_utils._ollama_available = None


@pytest.mark.asyncio
async def test_is_ollama_available_success():
    with patch("ollama.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.list.return_value = {"models": []}
        mock_client_class.return_value = mock_client

        result = await is_ollama_available()
        assert result is True
        assert api.ollama_utils._ollama_available is True
        assert mock_client.list.call_count == 1


@pytest.mark.asyncio
async def test_is_ollama_available_caching():
    with patch("ollama.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.list.return_value = {"models": []}
        mock_client_class.return_value = mock_client

        # First call: triggers check
        await is_ollama_available()
        # Second call: uses cache
        result = await is_ollama_available()

        assert result is True
        # list() should only be called once due to caching
        assert mock_client.list.call_count == 1


@pytest.mark.asyncio
async def test_is_ollama_available_retries_and_failure():
    with patch("ollama.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        mock_client.list.side_effect = Exception("Connection failed")
        mock_client_class.return_value = mock_client

        # Patch sleep to avoid waiting during tests
        with patch("asyncio.sleep", AsyncMock()) as mock_sleep:
            result = await is_ollama_available()

        assert result is False
        assert api.ollama_utils._ollama_available is False
        # Should retry 3 times (initial + 2 retries)
        assert mock_client.list.call_count == 3
        assert mock_sleep.call_count == 2


@pytest.mark.asyncio
async def test_is_ollama_available_success_after_retry():
    with patch("ollama.AsyncClient") as mock_client_class:
        mock_client = AsyncMock()
        # Fail twice, succeed on third attempt
        mock_client.list.side_effect = [
            Exception("Fail 1"),
            Exception("Fail 2"),
            {"models": []},
        ]
        mock_client_class.return_value = mock_client

        with patch("asyncio.sleep", AsyncMock()) as mock_sleep:
            result = await is_ollama_available()

        assert result is True
        assert api.ollama_utils._ollama_available is True
        assert mock_client.list.call_count == 3
        assert mock_sleep.call_count == 2
