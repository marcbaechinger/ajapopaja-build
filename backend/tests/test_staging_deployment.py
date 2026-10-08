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

"""Guards the staging deployment contract.

Staging is a second instance of the same image that must never share mutable
state with production. These lightweight assertions read the static deployment
artifacts and make sure the database, ports, host directories, systemd unit and
compose project stay isolated.
"""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

STAGING_DB = "ajapopaja_build_staging"
STAGING_ROOT = "/data/ajapopaja/staging"


def _read(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text()


def test_staging_env_template_uses_a_dedicated_database():
    env = _read("deploy/staging.env.example")
    assert f"DATABASE_NAME={STAGING_DB}" in env
    # Production's database must not be referenced by the staging template.
    assert "ajapopaja_build_prod" not in env


def test_staging_env_template_uses_different_ports():
    env = _read("deploy/staging.env.example")
    assert "PORT=8082" in env
    assert "DEV_SERVER_PORT=1225" in env
    assert "PORT=8081" not in env
    assert "DEV_SERVER_PORT=1224" not in env


def test_staging_env_template_isolates_writable_roots():
    env = _read("deploy/staging.env.example")
    expected = {
        "WORKSPACES_ROOT": f"{STAGING_ROOT}/workspaces",
        "PI_SESSIONS_ROOT": f"{STAGING_ROOT}/pi_sessions",
        "SANDBOX_ROOT": f"{STAGING_ROOT}/sandboxes",
        "REMOTE_WORKSPACES_ROOT": f"{STAGING_ROOT}/remote_workspaces",
    }
    for key, value in expected.items():
        assert f"{key}={value}" in env


def test_staging_env_template_has_its_own_secret():
    env = _read("deploy/staging.env.example")
    assert "AUTH_SECRET_KEY=" in env
    # The secret must be generated on first deploy, never committed.
    assert "AUTH_SECRET_KEY=CHANGE_ME" in env


def test_staging_service_is_isolated():
    unit = _read("ajapopaja-build-staging.service")
    assert "EnvironmentFile=/etc/ajapopaja-build-staging.env" in unit
    assert f"WorkingDirectory={STAGING_ROOT}" in unit
    assert "docker compose -p ajapopaja-build-staging up" in unit
    assert "docker rm -f ajapopaja-build-staging" in unit
    # The shared production tarball is loaded, not a separate image.
    assert "docker load -i /data/ajapopaja/docker/ajapopaja-build.tar" in unit


def test_compose_parameterizes_instance_identity_and_roots():
    compose = _read("docker-compose.yml")
    assert "${CONTAINER_NAME:-ajapopaja-build}" in compose
    assert "${AJAPOPAJA_ENV_FILE:-/etc/ajapopaja-build.env}" in compose
    for variable in (
        "PI_SESSIONS_ROOT",
        "SANDBOX_ROOT",
        "REMOTE_WORKSPACES_ROOT",
        "WORKSPACES_ROOT",
    ):
        assert f"${{{variable}:-" in compose


def test_deploy_script_supports_staging_without_touching_prod():
    script = _read("deploy-local.sh")
    assert "staging)" in script
    assert "/etc/ajapopaja-build-staging.env" in script
    assert f"{STAGING_ROOT}" in script
    assert "ajapopaja-build-staging.service" in script
    # The env file is only created when it does not exist yet.
    assert 'if [ ! -f "$ENV_FILE" ]' in script
    # Staging gets a freshly generated JWT secret on first deploy.
    assert "AUTH_SECRET_KEY" in script


def test_prod_deploy_still_uses_the_legacy_defaults():
    script = _read("deploy-local.sh")
    assert "/etc/ajapopaja-build.env" in script
    assert "ajapopaja-build.service" in script
    prod_env = _read("deploy/prod.env.example")
    assert "DATABASE_NAME=ajapopaja_build_prod" in prod_env
    assert "PORT=8081" in prod_env


def test_bootstrap_script_exists_and_is_executable():
    script_path = REPO_ROOT / "scripts" / "bootstrap_staging.sh"
    assert script_path.is_file()
    assert os.access(script_path, os.X_OK)
    script = script_path.read_text()
    assert STAGING_ROOT in script
    assert "setup_test_db.py" in script
    assert "--seed" in script
