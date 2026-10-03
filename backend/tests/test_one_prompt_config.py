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

"""Tests for the ``ONE_PROMPT_OLLAMA_MODEL`` configuration value."""

import importlib
import os

import pytest

from core import config


@pytest.fixture(autouse=True)
def restore_config():
    """Reload ``core.config`` with clean env after each test.

    Tests here reload the module under monkeypatched env vars; restoring the
    defaults afterwards prevents the modified value leaking into other tests.
    """
    yield
    os.environ.pop("ONE_PROMPT_OLLAMA_MODEL", None)
    os.environ.pop("OLLAMA_MODEL", None)
    importlib.reload(config)


@pytest.fixture(autouse=True)
def existing_workspaces_root(monkeypatch, tmp_path):
    """Point ``WORKSPACES_ROOT`` at a real directory so reloads succeed."""
    monkeypatch.setenv("WORKSPACES_ROOT", str(tmp_path))


def _reload_config():
    return importlib.reload(config)


def test_one_prompt_model_defaults_to_ollama_model(monkeypatch):
    monkeypatch.delenv("ONE_PROMPT_OLLAMA_MODEL", raising=False)
    reloaded = _reload_config()
    assert reloaded.ONE_PROMPT_OLLAMA_MODEL == reloaded.OLLAMA_MODEL


def test_one_prompt_model_env_override(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "global-model")
    monkeypatch.setenv("ONE_PROMPT_OLLAMA_MODEL", "one-shot-model")
    reloaded = _reload_config()
    assert reloaded.ONE_PROMPT_OLLAMA_MODEL == "one-shot-model"
    # The global model is not affected by the dedicated one-shot knob.
    assert reloaded.OLLAMA_MODEL == "global-model"
