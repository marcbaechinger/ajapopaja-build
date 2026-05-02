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
from fastapi import status


@pytest.mark.asyncio
async def test_register_user_success(async_client, init_mock_db):
    with patch(
        "api.routes.auth.User.find_one", new_callable=AsyncMock
    ) as mock_find_one:
        mock_find_one.return_value = None
        with patch(
            "api.routes.auth.User.insert", new_callable=AsyncMock
        ) as mock_insert:
            response = await async_client.post(
                "/api/auth/register",
                json={
                    "username": "testuser",
                    "password": "testpassword",
                    "email": "test@example.com",
                    "full_name": "Test User",
                },
            )
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["username"] == "testuser"
            assert mock_insert.called


@pytest.mark.asyncio
async def test_register_user_already_exists(async_client, init_mock_db):
    with patch(
        "api.routes.auth.User.find_one", new_callable=AsyncMock
    ) as mock_find_one:
        mock_find_one.return_value = AsyncMock()  # User exists
        response = await async_client.post(
            "/api/auth/register",
            json={"username": "testuser", "password": "testpassword"},
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["detail"] == "Username already registered"


@pytest.mark.asyncio
async def test_register_user_invalid_json(async_client, init_mock_db):
    response = await async_client.post(
        "/api/auth/register",
        json={"username": "testuser"},  # missing password
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


@pytest.mark.asyncio
async def test_login_success(async_client, init_mock_db):
    with patch(
        "api.routes.auth.authenticate_user", new_callable=AsyncMock
    ) as mock_auth:
        mock_user = AsyncMock()
        mock_user.username = "testuser"
        mock_auth.return_value = mock_user

        with patch("api.routes.auth.create_access_token") as mock_access:
            mock_access.return_value = "fake_access_token"
            with patch("api.routes.auth.create_refresh_token") as mock_refresh:
                mock_refresh.return_value = "fake_refresh_token"

                response = await async_client.post(
                    "/api/auth/login",
                    data={"username": "testuser", "password": "testpassword"},
                )
                assert response.status_code == status.HTTP_200_OK
                assert response.json()["access_token"] == "fake_access_token"
                assert "refresh_token" in response.cookies


@pytest.mark.asyncio
async def test_login_failure(async_client, init_mock_db):
    with patch(
        "api.routes.auth.authenticate_user", new_callable=AsyncMock
    ) as mock_auth:
        mock_auth.return_value = None
        response = await async_client.post(
            "/api/auth/login",
            data={"username": "testuser", "password": "wrongpassword"},
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_refresh_token_success(async_client, init_mock_db):
    with patch("api.routes.auth.jwt.decode") as mock_decode:
        mock_decode.return_value = {"sub": "testuser", "refresh": True}
        with patch(
            "api.routes.auth.User.find_one", new_callable=AsyncMock
        ) as mock_find:
            mock_user = AsyncMock()
            mock_user.username = "testuser"
            mock_user.disabled = False
            mock_find.return_value = mock_user

            async_client.cookies.set("refresh_token", "valid_refresh_token")
            response = await async_client.post("/api/auth/refresh")
            assert response.status_code == status.HTTP_200_OK
            assert "access_token" in response.json()


@pytest.mark.asyncio
async def test_refresh_token_missing(async_client, init_mock_db):
    response = await async_client.post("/api/auth/refresh")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.json()["detail"] == "Refresh token missing"


@pytest.mark.asyncio
async def test_logout(async_client, init_mock_db):
    async_client.cookies.set("refresh_token", "some_token")
    response = await async_client.post("/api/auth/logout")
    assert response.status_code == status.HTTP_200_OK
    assert (
        "refresh_token" not in response.cookies
        or response.cookies.get("refresh_token") == ""
    )


@pytest.mark.asyncio
async def test_me_unauthenticated(async_client, init_mock_db):
    response = await async_client.get("/api/auth/me")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_me_authenticated(async_client, init_mock_db):
    # We need to mock get_current_user because it's a dependency
    # FastAPI dependency overrides can be used
    from api.auth import get_current_user
    from api.main import app

    mock_user = AsyncMock()
    mock_user.username = "testuser"
    mock_user.email = "test@example.com"
    mock_user.full_name = "Test User"

    app.dependency_overrides[get_current_user] = lambda: mock_user
    try:
        response = await async_client.get("/api/auth/me")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["username"] == "testuser"
    finally:
        app.dependency_overrides.clear()
