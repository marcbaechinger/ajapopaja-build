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
    assert "${DEV_SERVER_PORT:-1224}:${DEV_SERVER_PORT:-1224}" in compose


def test_deploy_script_seeds_dev_server_port():
    script = (REPO_ROOT / "deploy-local.sh").read_text()
    assert "DEV_SERVER_PORT=1224" in script
