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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.git_hosting.gitea import GiteaApiError, GiteaClient


@pytest.mark.asyncio
async def test_create_pull_request_builds_request_and_returns_html_url():
    client = GiteaClient("https://host", "mytoken")
    response = MagicMock()
    response.status_code = 201
    response.json.return_value = {
        "html_url": "https://host/owner/repo/pulls/42",
        "number": 42,
    }
    response.text = "{}"

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        url = await client.create_pull_request(
            "owner",
            "repo",
            head="feature/x",
            base="main",
            title="Summary",
            body="Summary body",
        )

    assert url == "https://host/owner/repo/pulls/42"
    mock_req.assert_awaited_once()
    args, kwargs = mock_req.await_args
    assert args[0] == "POST"
    assert args[1] == "https://host/api/v1/repos/owner/repo/pulls"
    assert kwargs["headers"]["Authorization"] == "token mytoken"
    assert kwargs["json"] == {
        "head": "feature/x",
        "base": "main",
        "title": "Summary",
        "body": "Summary body",
    }


@pytest.mark.asyncio
async def test_create_pull_request_falls_back_to_number_url():
    client = GiteaClient("http://host:3000", "tok")
    response = MagicMock()
    response.status_code = 201
    response.json.return_value = {"number": 7}
    response.text = "{}"

    with patch.object(client._client, "request", new=AsyncMock(return_value=response)):
        url = await client.create_pull_request(
            "owner", "repo", head="h", base="main", title="t"
        )

    assert url == "http://host:3000/owner/repo/pulls/7"


@pytest.mark.asyncio
async def test_create_pull_request_raises_on_non_2xx():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 422
    response.json.return_value = {}
    response.text = '{"message":"bad"}'

    with patch.object(client._client, "request", new=AsyncMock(return_value=response)):
        with pytest.raises(GiteaApiError) as excinfo:
            await client.create_pull_request(
                "owner", "repo", head="h", base="main", title="t"
            )

    assert excinfo.value.status_code == 422
    assert "bad" in excinfo.value.detail
