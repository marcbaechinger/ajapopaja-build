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

"""Tests for the ``DEV_SERVER_PORT`` configuration value."""

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
    os.environ.pop("DEV_SERVER_PORT", None)
    importlib.reload(config)


def _reload_config():
    return importlib.reload(config)


def test_dev_server_port_default_is_1224(monkeypatch):
    monkeypatch.delenv("DEV_SERVER_PORT", raising=False)
    reloaded = _reload_config()
    assert reloaded.DEV_SERVER_PORT == 1224
    assert isinstance(reloaded.DEV_SERVER_PORT, int)


def test_dev_server_port_parses_custom_value(monkeypatch):
    monkeypatch.setenv("DEV_SERVER_PORT", "3000")
    reloaded = _reload_config()
    assert reloaded.DEV_SERVER_PORT == 3000
    assert isinstance(reloaded.DEV_SERVER_PORT, int)


def test_dev_server_port_rejects_non_integer(monkeypatch):
    monkeypatch.setenv("DEV_SERVER_PORT", "not-a-port")
    with pytest.raises(RuntimeError, match="DEV_SERVER_PORT"):
        _reload_config()
