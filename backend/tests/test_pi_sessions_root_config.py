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

"""Tests for the ``PI_SESSIONS_ROOT`` configuration value."""

import importlib
import os
from pathlib import Path

import pytest

from core import config


@pytest.fixture(autouse=True)
def restore_config():
    """Reload ``core.config`` with clean env after each test.

    Tests here reload the module under monkeypatched env vars; restoring the
    defaults afterwards prevents the modified value leaking into other tests.
    """
    yield
    os.environ.pop("PI_SESSIONS_ROOT", None)
    importlib.reload(config)


@pytest.fixture(autouse=True)
def existing_workspaces_root(monkeypatch, tmp_path):
    """Point ``WORKSPACES_ROOT`` at a real directory so reloads succeed."""
    monkeypatch.setenv("WORKSPACES_ROOT", str(tmp_path))


def _reload_config():
    return importlib.reload(config)


def test_pi_sessions_root_default_is_host_mounted_path(monkeypatch):
    monkeypatch.delenv("PI_SESSIONS_ROOT", raising=False)
    reloaded = _reload_config()
    assert reloaded.PI_SESSIONS_ROOT == Path("/data/ajapopaja/pi_sessions")


def test_pi_sessions_root_parses_custom_value(monkeypatch):
    monkeypatch.setenv("PI_SESSIONS_ROOT", "/tmp/x")
    reloaded = _reload_config()
    assert reloaded.PI_SESSIONS_ROOT == Path("/tmp/x").resolve()


def test_pi_sessions_root_does_not_affect_sandbox_root(monkeypatch):
    monkeypatch.setenv("PI_SESSIONS_ROOT", "/tmp/x")
    reloaded = _reload_config()
    assert reloaded.SANDBOX_ROOT == Path("/data/ajapopaja/sandboxes").resolve()
