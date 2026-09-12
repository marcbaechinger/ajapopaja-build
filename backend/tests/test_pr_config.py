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

import pytest

from core import config


def _reload_config():
    return importlib.reload(config)


def test_remote_pr_mode_default_is_direct(monkeypatch):
    monkeypatch.delenv("REMOTE_PR_MODE", raising=False)
    reloaded = _reload_config()
    assert reloaded.REMOTE_PR_MODE == "direct"


@pytest.mark.parametrize("mode", ["direct", "gitea_pr", "DIRECT", "GITEA_PR"])
def test_remote_pr_mode_accepts_valid(monkeypatch, mode):
    monkeypatch.setenv("REMOTE_PR_MODE", mode)
    reloaded = _reload_config()
    assert reloaded.REMOTE_PR_MODE == mode.lower()


def test_remote_pr_mode_rejects_invalid(monkeypatch):
    monkeypatch.setenv("REMOTE_PR_MODE", "gitea")
    with pytest.raises(RuntimeError, match="REMOTE_PR_MODE"):
        _reload_config()
