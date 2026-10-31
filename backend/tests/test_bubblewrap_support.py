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

"""Guards that bubblewrap can run inside the Docker container.

The sandbox mode shells out to ``bwrap``. These lightweight assertions read the
Dockerfile and deployment artifacts directly so the image cannot silently lose
the package, and the container keeps the scoped seccomp profile that lets
bubblewrap create an unprivileged user namespace.
"""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Linux UAPI value for CLONE_NEWUSER. Docker's default profile blocks this
# without CAP_SYS_ADMIN; the vendored profile relaxes exactly that path.
CLONE_NEWUSER = 0x10000000


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


def _seccomp_profile() -> dict:
    return json.loads((REPO_ROOT / "deploy" / "seccomp-bwrap.json").read_text())


def _rules_for(profile: dict, syscall: str):
    for rule in profile["syscalls"]:
        if syscall in rule.get("names", []):
            yield rule


def _has_unprivileged_masked_allow(profile: dict, syscall: str, arg_index: int) -> bool:
    """Return True if *syscall* allows an argument containing CLONE_NEWUSER.

    The profile format uses ``value`` as the mask and ``valueTwo`` as the
    expected value for ``SCMP_CMP_MASKED_EQ``. Requiring both to contain
    CLONE_NEWUSER means the rule matches when that bit is set, not only when
    all other namespace bits are clear.
    """
    for rule in _rules_for(profile, syscall):
        if rule.get("action") != "SCMP_ACT_ALLOW":
            continue
        if "CAP_SYS_ADMIN" in rule.get("excludes", {}).get("caps", []):
            continue
        for arg in rule.get("args", []):
            if arg.get("index") != arg_index:
                continue
            if arg.get("op") != "SCMP_CMP_MASKED_EQ":
                continue
            mask = arg.get("value", 0)
            expected = arg.get("valueTwo", 0)
            if mask & CLONE_NEWUSER == CLONE_NEWUSER and (
                expected & CLONE_NEWUSER == CLONE_NEWUSER
            ):
                return True
    return False


def test_seccomp_profile_is_valid_and_keeps_default_deny_action():
    profile = _seccomp_profile()
    assert profile["defaultAction"] == "SCMP_ACT_ERRNO"


def test_seccomp_profile_allows_unprivileged_clone_and_unshare_newuser():
    profile = _seccomp_profile()
    assert _has_unprivileged_masked_allow(profile, "clone", 0)
    assert _has_unprivileged_masked_allow(profile, "unshare", 0)


def test_seccomp_profile_allows_clone3_when_source_profile_has_it():
    profile = _seccomp_profile()
    clone3_rules = list(_rules_for(profile, "clone3"))
    assert clone3_rules, "Docker v29 default profile has an explicit clone3 rule"
    assert any(
        rule.get("action") == "SCMP_ACT_ALLOW"
        and "CAP_SYS_ADMIN" not in rule.get("excludes", {}).get("caps", [])
        and "CAP_SYS_ADMIN" not in rule.get("includes", {}).get("caps", [])
        for rule in clone3_rules
    )


def test_compose_uses_scoped_bwrap_seccomp_profile():
    compose = (REPO_ROOT / "docker-compose.yml").read_text()
    assert "security_opt:" in compose
    assert "BWRAP_SECCOMP_PROFILE" in compose
    assert "seccomp=${BWRAP_SECCOMP_PROFILE:-./seccomp-bwrap.json}" in compose
    assert "seccomp=unconfined" not in compose


def test_deploy_script_installs_profile_next_to_compose_for_every_instance():
    script = (REPO_ROOT / "deploy-local.sh").read_text()
    assert 'sudo cp deploy/seccomp-bwrap.json "$DATA_DIR/seccomp-bwrap.json"' in script
    assert (
        'sudo chmod 644 "$DATA_DIR/docker-compose.yml" "$DATA_DIR/seccomp-bwrap.json"'
        in script
    )
    # Both environments have their own DATA_DIR, so the single copy command
    # covers production and staging.
    assert 'DATA_DIR="/data/ajapopaja"' in script
    assert 'DATA_DIR="/data/ajapopaja/staging"' in script


def test_env_templates_point_at_their_instance_profile():
    prod = (REPO_ROOT / "deploy" / "prod.env.example").read_text()
    staging = (REPO_ROOT / "deploy" / "staging.env.example").read_text()
    assert "BWRAP_SECCOMP_PROFILE=/data/ajapopaja/seccomp-bwrap.json" in prod
    assert "BWRAP_SECCOMP_PROFILE=/data/ajapopaja/staging/seccomp-bwrap.json" in staging
