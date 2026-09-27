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

import importlib
from pathlib import Path

from api.coderbot.session import CoderBotSession, InteractivePiSession
from api.coderbot.skills import PiSkillStager
from core import config


def _make_library(tmp_path: Path, names):
    library = tmp_path / "library"
    for name in names:
        skill = library / name
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(f"# {name}\n", encoding="utf-8")
        (skill / "mcp_client.py").write_text("print('hi')\n", encoding="utf-8")
    return library


def _make_workspace(tmp_path: Path) -> Path:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    return workspace


# ---------------------------------------------------------------------------
# PiSkillStager
# ---------------------------------------------------------------------------
def test_stage_links_only_configured_skills(tmp_path):
    library = _make_library(tmp_path, ["ajapopaja", "other"])
    workspace = _make_workspace(tmp_path)

    stager = PiSkillStager(library, ["ajapopaja"])
    created = stager.stage(workspace)

    target = workspace / ".pi" / "skills" / "ajapopaja"
    assert target.is_symlink()
    assert (target / "SKILL.md").read_text(encoding="utf-8") == "# ajapopaja\n"
    assert created == [target]
    assert not (workspace / ".pi" / "skills" / "other").exists()


def test_stage_skips_pre_existing_target(tmp_path):
    library = _make_library(tmp_path, ["ajapopaja"])
    workspace = _make_workspace(tmp_path)
    target = workspace / ".pi" / "skills" / "ajapopaja"
    target.mkdir(parents=True)
    (target / "SKILL.md").write_text("repo-owned\n", encoding="utf-8")

    stager = PiSkillStager(library, ["ajapopaja"])
    created = stager.stage(workspace)

    assert created == []
    assert not target.is_symlink()
    assert (target / "SKILL.md").read_text(encoding="utf-8") == "repo-owned\n"


def test_stage_writes_git_exclude(tmp_path):
    library = _make_library(tmp_path, ["ajapopaja"])
    workspace = _make_workspace(tmp_path)
    (workspace / ".git" / "info").mkdir(parents=True)

    PiSkillStager(library, ["ajapopaja"]).stage(workspace)

    exclude = workspace / ".git" / "info" / "exclude"
    assert exclude.is_file()
    assert ".pi/" in exclude.read_text(encoding="utf-8").splitlines()


def test_stage_does_not_duplicate_git_exclude(tmp_path):
    library = _make_library(tmp_path, ["ajapopaja"])
    workspace = _make_workspace(tmp_path)
    info = workspace / ".git" / "info"
    info.mkdir(parents=True)
    (info / "exclude").write_text(".pi/\n", encoding="utf-8")

    PiSkillStager(library, ["ajapopaja"]).stage(workspace)

    lines = (info / "exclude").read_text(encoding="utf-8").splitlines()
    assert lines.count(".pi/") == 1


def test_stage_is_safe_when_library_missing(tmp_path):
    workspace = _make_workspace(tmp_path)
    stager = PiSkillStager(tmp_path / "does-not-exist", ["ajapopaja"])
    assert stager.stage(workspace) == []


def test_stage_is_safe_when_workspace_missing(tmp_path):
    library = _make_library(tmp_path, ["ajapopaja"])
    stager = PiSkillStager(library, ["ajapopaja"])
    assert stager.stage(tmp_path / "does-not-exist") == []


def test_stage_is_noop_without_skill_names(tmp_path):
    library = _make_library(tmp_path, ["ajapopaja"])
    workspace = _make_workspace(tmp_path)
    assert PiSkillStager(library, []).stage(workspace) == []
    assert not (workspace / ".pi").exists()


def test_stage_skips_unknown_skill(tmp_path):
    library = _make_library(tmp_path, ["ajapopaja"])
    workspace = _make_workspace(tmp_path)
    stager = PiSkillStager(library, ["missing"])
    assert stager.stage(workspace) == []


def test_cleanup_removes_only_created_paths(tmp_path):
    library = _make_library(tmp_path, ["ajapopaja", "other"])
    workspace = _make_workspace(tmp_path)
    # A repo-owned skill that must survive cleanup.
    owned = workspace / ".pi" / "skills" / "other"
    owned.mkdir(parents=True)
    (owned / "SKILL.md").write_text("repo-owned\n", encoding="utf-8")

    stager = PiSkillStager(library, ["ajapopaja"])
    stager.stage(workspace)
    staged = workspace / ".pi" / "skills" / "ajapopaja"
    assert staged.is_symlink()

    stager.cleanup()

    assert not staged.exists()
    assert not staged.is_symlink()
    assert (owned / "SKILL.md").read_text(encoding="utf-8") == "repo-owned\n"
    # The pre-existing repo-owned skill kept .pi alive.
    assert (workspace / ".pi").exists()


def test_cleanup_prunes_empty_dirs_and_is_idempotent(tmp_path):
    library = _make_library(tmp_path, ["ajapopaja"])
    workspace = _make_workspace(tmp_path)
    (workspace / ".git" / "info").mkdir(parents=True)

    stager = PiSkillStager(library, ["ajapopaja"])
    stager.stage(workspace)
    stager.cleanup()
    stager.cleanup()

    assert not (workspace / ".pi").exists()


def test_from_config_uses_configured_library(tmp_path, monkeypatch):
    library = _make_library(tmp_path, ["ajapopaja"])
    monkeypatch.setattr(config, "PI_SKILLS_LIBRARY_DIR", library)

    stager = PiSkillStager.from_config(["ajapopaja"])
    assert stager.library_dir == library
    assert stager.skill_names == ["ajapopaja"]


# ---------------------------------------------------------------------------
# Config parsing
# ---------------------------------------------------------------------------
def test_parse_skill_list_variants():
    assert config._parse_skill_list("") == []
    assert config._parse_skill_list("ajapopaja") == ["ajapopaja"]
    assert config._parse_skill_list("a,b, c") == ["a", "b", "c"]
    assert config._parse_skill_list("a b\tc") == ["a", "b", "c"]


def test_skill_config_defaults(monkeypatch):
    monkeypatch.delenv("CODERBOT_SKILLS", raising=False)
    monkeypatch.delenv("INTERACTIVE_SKILLS", raising=False)
    importlib.reload(config)

    assert config.CODERBOT_SKILLS == []
    assert config.INTERACTIVE_SKILLS == ["ajapopaja"]


def test_skill_config_overrides(monkeypatch):
    monkeypatch.setenv("CODERBOT_SKILLS", "a, b")
    monkeypatch.setenv("INTERACTIVE_SKILLS", "c d")
    importlib.reload(config)

    assert config.CODERBOT_SKILLS == ["a", "b"]
    assert config.INTERACTIVE_SKILLS == ["c", "d"]


def test_pi_skills_library_dir_default(monkeypatch):
    monkeypatch.delenv("PI_SKILLS_LIBRARY_DIR", raising=False)
    importlib.reload(config)

    assert config.PI_SKILLS_LIBRARY_DIR == Path("/opt/ajapopaja/pi/skills").resolve()


# ---------------------------------------------------------------------------
# Session wiring
# ---------------------------------------------------------------------------
def test_coderbot_session_uses_coderbot_skills(monkeypatch):
    monkeypatch.setattr(config, "CODERBOT_SKILLS", ["a", "b"])

    session = CoderBotSession(pipeline_id="p1", task_id="t1")

    assert session.skill_names == ["a", "b"]


def test_interactive_session_uses_interactive_skills(monkeypatch):
    monkeypatch.setattr(config, "INTERACTIVE_SKILLS", ["ajapopaja"])

    session = InteractivePiSession()

    assert session.skill_names == ["ajapopaja"]
