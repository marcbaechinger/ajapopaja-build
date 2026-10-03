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

"""Guards that the persistent session root is mounted host-path:container-path 1:1.

Pi writes absolute paths into its session files and ``PiSession`` stores
absolute paths, so the host and container paths must be identical. These
lightweight assertions read the deployment artifacts directly and make sure the
mount, the image env and the scripts cannot drift apart silently.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SESSIONS_ROOT = "/data/ajapopaja/pi_sessions"


def test_compose_mounts_sessions_root_identically():
    compose = (REPO_ROOT / "docker-compose.yml").read_text()
    assert f"{SESSIONS_ROOT}:{SESSIONS_ROOT}" in compose


def test_dockerfile_declares_and_creates_sessions_root():
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert f"PI_SESSIONS_ROOT={SESSIONS_ROOT}" in dockerfile
    assert f"mkdir -p {SESSIONS_ROOT}" in dockerfile


def test_deploy_script_seeds_sessions_root():
    script = (REPO_ROOT / "deploy-local.sh").read_text()
    assert f"PI_SESSIONS_ROOT={SESSIONS_ROOT}" in script
    assert f"mkdir -p {SESSIONS_ROOT}" in script


def test_docker_build_example_mounts_sessions_root():
    script = (REPO_ROOT / "docker-build.sh").read_text()
    assert f"{SESSIONS_ROOT}:{SESSIONS_ROOT}" in script
