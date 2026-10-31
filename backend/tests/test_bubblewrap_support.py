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

"""Guards that the runtime image ships bubblewrap for sandboxed processes.

The sandbox mode shells out to ``bwrap``. These lightweight assertions read the
Dockerfile directly so the final image cannot silently lose the package or its
build-time smoke test.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _final_stage() -> str:
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert " AS final" in dockerfile
    return dockerfile.split(" AS final", 1)[1]


def test_final_stage_installs_bubblewrap():
    final_stage = _final_stage()
    assert "bubblewrap" in final_stage
    assert "--no-install-recommends" in final_stage


def test_final_stage_checks_bwrap_at_build_time():
    assert "bwrap --version" in _final_stage()
