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

"""Unit tests for build-artifact declarations and live metadata.

Covers the model-level path safety rules and the service's fingerprint fields
for an existing file, a missing file/workspace, and a non-git workspace.
"""

import hashlib
import os
import subprocess
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from core import config
from core.models.models import BuildArtifactInfo, BuildArtifactSpec, Pipeline
from core.services.artifact import get_artifact_info


@pytest.fixture(autouse=True)
def _init_database(init_mock_db):
    """Beanie models require an initialized database even when not persisted."""
    yield init_mock_db


RUN_GIT_ENV = {
    "GIT_AUTHOR_NAME": "Test User",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test User",
    "GIT_COMMITTER_EMAIL": "test@example.com",
}


def _git(cwd, args):
    return subprocess.run(
        ["git"] + args,
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, **RUN_GIT_ENV},
    )


def _make_git_repo(root):
    repo = root / "repo"
    repo.mkdir()
    _git(repo, ["init", "-b", "main"])
    (repo / "README.md").write_text("# Repo\n")
    _git(repo, ["add", "README.md"])
    _git(repo, ["commit", "-m", "Initial commit"])
    return repo, _git(repo, ["rev-parse", "HEAD"]).stdout.strip()


def _pipeline(workspace_path="ws", **artifact):
    spec = {"path": "dist/app.bin", "label": "App binary", **artifact}
    return Pipeline(
        name="Artifact Pipeline",
        workspace_path=workspace_path,
        build_commands=[["make", "build"]],
        build_artifact=spec,
    )


# ---------------------------------------------------------------------------
# BuildArtifactSpec / Pipeline validation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/etc/passwd",
        "../outside.bin",
        "dist/../../outside.bin",
        ".git/config",
        "dist/.git/app.bin",
    ],
)
def test_build_artifact_spec_rejects_unsafe_paths(path):
    with pytest.raises(ValidationError):
        BuildArtifactSpec(path=path)


@pytest.mark.parametrize(
    "path",
    [
        "/tmp/app.apk",
        "../app.apk",
        "a/../../app.apk",
        ".git/app.apk",
    ],
)
def test_pipeline_rejects_unsafe_artifact_paths(path):
    with pytest.raises(ValidationError):
        Pipeline(name="Bad artifact", build_artifact={"path": path})


def test_build_artifact_spec_normalises_safe_paths():
    spec = BuildArtifactSpec(path="./dist/./app.apk")
    assert spec.path == "dist/app.apk"

    pipeline = Pipeline(
        name="Normalised",
        build_artifact={"path": "./dist/./app.apk", "label": "Debug APK"},
    )
    assert pipeline.build_artifact is not None
    assert pipeline.build_artifact.path == "dist/app.apk"
    assert pipeline.build_artifact.label == "Debug APK"


# ---------------------------------------------------------------------------
# Artifact service
# ---------------------------------------------------------------------------


def test_artifact_info_existing_file_in_non_git_workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = tmp_path / "ws"
    artifact = workspace / "dist" / "app.bin"
    artifact.parent.mkdir(parents=True)
    payload = b"\x00\x01artifact-bytes\xff" * 1024
    artifact.write_bytes(payload)
    mtime = artifact.stat().st_mtime

    pipeline = _pipeline(media_type="application/x-test-artifact")
    info = get_artifact_info(pipeline)

    assert isinstance(info, BuildArtifactInfo)
    assert info.path == "dist/app.bin"
    assert info.exists is True
    assert info.size == len(payload)
    assert info.sha256 == hashlib.sha256(payload).hexdigest()
    assert info.modified_at == datetime.fromtimestamp(mtime, tz=UTC)
    assert info.version is None  # not a git workspace
    assert info.media_type == "application/x-test-artifact"
    assert info.label == "App binary"
    assert info.build_commands_configured is True


def test_artifact_info_infers_media_type_when_not_overridden(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "dist").mkdir()
    (workspace / "dist" / "app.apk").write_bytes(b"apk")

    pipeline = Pipeline(
        name="APK",
        workspace_path="ws",
        build_artifact={"path": "dist/app.apk"},
    )
    info = get_artifact_info(pipeline)

    assert info.exists is True
    assert info.media_type == "application/vnd.android.package-archive"


def test_artifact_info_existing_file_in_git_workspace_reports_head(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace, head = _make_git_repo(tmp_path)
    artifact = workspace / "dist" / "app.bin"
    artifact.parent.mkdir()
    payload = b"git-workspace-artifact"
    artifact.write_bytes(payload)

    info = get_artifact_info(_pipeline(workspace_path="repo"))

    assert info.exists is True
    assert info.version == head
    assert info.size == len(payload)
    assert info.sha256 == hashlib.sha256(payload).hexdigest()
    # The artifact itself is untracked; provenance is still the workspace HEAD.
    assert (workspace / ".git").is_dir()


def test_artifact_info_missing_file_keeps_configuration_and_version(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    _workspace, head = _make_git_repo(tmp_path)
    (tmp_path / "repo" / "dist").mkdir()

    info = get_artifact_info(_pipeline(workspace_path="repo"))

    assert info.path == "dist/app.bin"
    assert info.exists is False
    assert info.size is None
    assert info.modified_at is None
    assert info.sha256 is None
    assert info.version == head
    assert info.label == "App binary"
    assert info.media_type == "application/octet-stream"


def test_artifact_info_missing_workspace_reports_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    info = get_artifact_info(_pipeline(workspace_path="does-not-exist"))

    assert info.path == "dist/app.bin"
    assert info.exists is False
    assert info.size is None
    assert info.sha256 is None
    assert info.version is None


def test_artifact_info_without_declaration(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    (tmp_path / "ws").mkdir()

    pipeline = Pipeline(
        name="No artifact",
        workspace_path="ws",
        build_commands=[["make", "build"]],
    )
    info = get_artifact_info(pipeline)

    assert info.path is None
    assert info.exists is False
    assert info.size is None
    assert info.modified_at is None
    assert info.version is None
    assert info.sha256 is None
    assert info.media_type is None
    assert info.build_commands_configured is True


def test_artifact_info_can_skip_hashing_for_cheap_polling(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = tmp_path / "ws"
    artifact = workspace / "dist" / "app.bin"
    artifact.parent.mkdir(parents=True)
    artifact.write_bytes(b"poll-me")

    info = get_artifact_info(_pipeline(), include_hash=False)

    assert info.exists is True
    assert info.size == len(b"poll-me")
    assert info.modified_at is not None
    assert info.sha256 is None
