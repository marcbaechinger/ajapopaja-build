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

"""Guards that the deployment artifacts advertise the dev-server port.

The config default, the image and the compose mapping must not drift apart
silently, so these lightweight assertions check the static files directly.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_dockerfile_declares_dev_server_port():
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert "DEV_SERVER_PORT=1224" in dockerfile
    assert "EXPOSE 8000 1224" in dockerfile


def test_compose_publishes_dev_server_port():
    compose = (REPO_ROOT / "docker-compose.yml").read_text()
    assert "127.0.0.1:${DEV_SERVER_PORT:-1224}:${DEV_SERVER_PORT:-1224}" in compose


def test_compose_binds_ports_to_loopback():
    """Both published ports must bind to loopback so nginx is the only entry point."""
    compose = (REPO_ROOT / "docker-compose.yml").read_text()
    assert "127.0.0.1:${PORT:-8081}:${PORT:-8081}" in compose
    assert "127.0.0.1:${DEV_SERVER_PORT:-1224}:${DEV_SERVER_PORT:-1224}" in compose


def test_deploy_templates_seed_dev_server_port():
    prod = (REPO_ROOT / "deploy" / "prod.env.example").read_text()
    staging = (REPO_ROOT / "deploy" / "staging.env.example").read_text()
    assert "DEV_SERVER_PORT=1224" in prod
    # Staging must publish a different port so both instances can run at once.
    assert "DEV_SERVER_PORT=1225" in staging


def test_dockerfile_bundles_pi_skill_library():
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert ".pi/skills" in dockerfile
    assert "PI_SKILLS_LIBRARY_DIR=/opt/ajapopaja/pi/skills" in dockerfile
    assert 'INTERACTIVE_SKILLS="ajapopaja code-review"' in dockerfile
