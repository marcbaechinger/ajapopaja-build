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
import os
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Optional, Union

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from core.models.models import User

# Configuration
SECRET_KEY = os.getenv("AUTH_SECRET_KEY", "your-secret-key-for-development-only")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

logger = logging.getLogger(__name__)


def validate_secret_key() -> None:
    """Warn when the app runs with the shared development JWT secret.

    A missing ``AUTH_SECRET_KEY`` makes every instance fall back to the same
    well-known secret, so tokens (and therefore sessions) become replayable
    across deployments. We warn instead of failing hard so an existing
    deployment keeps serving while the operator sets a per-instance secret.
    """
    if os.getenv("AUTH_SECRET_KEY"):
        return
    logger.warning(
        "AUTH_SECRET_KEY is not set; falling back to the insecure development "
        "secret. Set a distinct AUTH_SECRET_KEY per instance before exposing "
        "the app (see deploy/*.env.example)."
    )


def get_refresh_cookie_name() -> str:
    """Return the name of the refresh-token cookie for this instance.

    Cookies are scoped by ``(name, domain, path)`` and **not** by port, so two
    instances served from the same host (e.g. production on ``:8081`` and
    staging on ``:8082``) would otherwise overwrite each other's
    ``refresh_token`` cookie. The name is resolved at call time so each
    instance can be configured independently via ``REFRESH_COOKIE_NAME``; when
    that is unset a suffix is derived from ``DATABASE_NAME`` so instances with
    their own databases stay isolated even without extra configuration.
    """
    explicit = os.getenv("REFRESH_COOKIE_NAME")
    if explicit:
        return explicit
    database = os.getenv("DATABASE_NAME", "").strip()
    if not database:
        return "refresh_token"
    safe = re.sub(r"[^A-Za-z0-9]+", "_", database).strip("_")
    return f"refresh_token_{safe}" if safe else "refresh_token"


def is_auth_cookie_secure() -> bool:
    """Whether the refresh cookie should carry the ``Secure`` attribute.

    Enable this (``AUTH_COOKIE_SECURE=true``) whenever the app is served over
    HTTPS; leaving it on for plain HTTP would stop the browser from storing
    the cookie at all.
    """
    return os.getenv("AUTH_COOKIE_SECURE", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


# Scope and lifetime of the short-lived tokens that authorise a single raw
# file view. Raw tokens are path-bound and must never be accepted as general
# access credentials (see ``decode_token``).
RAW_FILE_SCOPE = "file:raw"
RAW_FILE_TOKEN_TTL_SECONDS = 60

# Scope and lifetime of the short-lived tokens that authorise a single build
# artifact download. Artifact tokens are pipeline- and path-bound and, like raw
# tokens, must never be accepted as general access credentials.
ARTIFACT_SCOPE = "artifact:download"
ARTIFACT_TOKEN_TTL_SECONDS = int(
    os.getenv("ARTIFACT_TOKEN_TTL_SECONDS", str(RAW_FILE_TOKEN_TTL_SECONDS))
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")


class RawFileToken(BaseModel):
    """Decoded claims of a raw-file access token."""

    username: str
    pipeline_id: str
    path: str


class ArtifactToken(BaseModel):
    """Decoded claims of a build-artifact download token."""

    pipeline_id: str
    path: str
    jti: str
    exp: Optional[int] = None


def verify_password(plain_password: str, hashed_password: str):
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )


def get_password_hash(password: str):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


async def authenticate_user(username: str, password: str) -> Optional[User]:
    user = await User.find_one(User.username == username)
    if not user:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict):
    expire = datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = data.copy()
    to_encode.update({"exp": expire, "refresh": True})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_raw_file_token(username: str, pipeline_id: str, path: str) -> str:
    """Mint a short-lived, path-bound token for the raw file endpoint.

    The token binds the user, the pipeline and the exact repository-relative
    path together. It is only accepted by ``decode_raw_file_token`` and is
    rejected as a general access credential everywhere else.
    """
    expire = datetime.now(UTC) + timedelta(seconds=RAW_FILE_TOKEN_TTL_SECONDS)
    to_encode = {
        "sub": username,
        "scope": RAW_FILE_SCOPE,
        "pipeline_id": pipeline_id,
        "path": path,
        "jti": str(uuid.uuid4()),
        "exp": expire,
    }
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_raw_file_token(token: Optional[str]) -> RawFileToken:
    """Validate a raw-file token and return its claims.

    Raises ``HTTPException(401)`` for anything that is not a valid, unexpired
    token carrying the raw-file scope.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired raw file token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise credentials_exception

    if payload.get("scope") != RAW_FILE_SCOPE:
        raise credentials_exception

    username = payload.get("sub")
    pipeline_id = payload.get("pipeline_id")
    path = payload.get("path")
    if not username or not pipeline_id or not path:
        raise credentials_exception

    return RawFileToken(username=username, pipeline_id=pipeline_id, path=path)


def create_artifact_token(pipeline_id: str, path: str) -> str:
    """Mint a short-lived, pipeline- and path-bound artifact download token.

    The token carries the scope ``artifact:download`` together with the
    pipeline id and repository-relative artifact path. It is only accepted by
    :func:`decode_artifact_token`; the central :func:`decode_token` guard
    rejects it as a general access credential.
    """
    expire = datetime.now(UTC) + timedelta(seconds=ARTIFACT_TOKEN_TTL_SECONDS)
    to_encode = {
        "scope": ARTIFACT_SCOPE,
        "pipeline_id": pipeline_id,
        "path": path,
        "jti": str(uuid.uuid4()),
        "exp": expire,
    }
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_artifact_token(token: Optional[str]) -> ArtifactToken:
    """Validate an artifact download token and return its claims.

    Raises ``HTTPException(401)`` for anything that is not a valid, unexpired
    token carrying the artifact download scope and the required bindings.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired artifact token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise credentials_exception

    if payload.get("scope") != ARTIFACT_SCOPE:
        raise credentials_exception

    pipeline_id = payload.get("pipeline_id")
    path = payload.get("path")
    jti = payload.get("jti")
    if not pipeline_id or not path or not jti:
        raise credentials_exception

    return ArtifactToken(
        pipeline_id=pipeline_id,
        path=path,
        jti=jti,
        exp=payload.get("exp"),
    )


def decode_token(token: str) -> dict:
    """Decode and validate an application JWT.

    Centralises the token-confusion guard: a raw-file token must never be
    accepted as a general access credential by the REST API, the WebSocket
    handshake or the MCP endpoints. Any future decoding entry point should go
    through this helper so it inherits the check.
    """
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    if payload.get("scope") == RAW_FILE_SCOPE:
        raise JWTError("raw file token cannot be used as an access credential")
    if payload.get("scope") == ARTIFACT_SCOPE:
        raise JWTError("artifact token cannot be used as an access credential")
    return payload


async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        username: Union[str, None] = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = await User.find_one(User.username == username)
    if user is None:
        raise credentials_exception
    if user.disabled:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


async def get_current_user_from_token(token: Optional[str]) -> Optional[User]:
    if not token:
        return None
    try:
        payload = decode_token(token)
        username: str = payload.get("sub")
        if username is None:
            return None
        user = await User.find_one(User.username == username)
        return user
    except Exception:
        return None


def get_token_from_query(request: Request) -> Optional[str]:
    return request.query_params.get("token")
