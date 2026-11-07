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

"""Tests for the central model resolver and catalog helpers."""

import json

import pytest

from core import config
from core.models.models import Pipeline
from core.services import model_resolver
from core.services.model_resolver import (
    list_coderbot_models,
    list_ollama_models,
    parse_coderbot_models,
    resolve_model,
)


def _pipeline(**overrides):
    """Build a detached Pipeline without requiring an initialized Beanie DB."""

    return Pipeline.model_construct(name="p", **overrides)


# ---------------------------------------------------------------------------
# resolve_model precedence
# ---------------------------------------------------------------------------


def test_pipeline_per_use_case_override_wins(monkeypatch):
    monkeypatch.setattr(config, "ARCHBOT_MODEL", "config-arch")
    pipeline = _pipeline(archbot_model="pipeline-arch")
    assert resolve_model("archbot", pipeline) == "pipeline-arch"


def test_blank_override_falls_back_to_config(monkeypatch):
    monkeypatch.setattr(config, "ASSISTANT_MODEL", "config-assistant")
    pipeline = _pipeline(assistant_model="   ")
    assert resolve_model("assistant", pipeline) == "config-assistant"


def test_none_pipeline_falls_back_to_config(monkeypatch):
    monkeypatch.setattr(config, "DOCBOT_MODEL", "config-doc")
    assert resolve_model("docbot", None) == "config-doc"


def test_general_ollama_override_applies_to_ollama_use_cases(monkeypatch):
    monkeypatch.setattr(config, "REVIEWBOT_MODEL", "config-review")
    pipeline = _pipeline(ollama_model="general-model")
    assert resolve_model("reviewbot", pipeline) == "general-model"
    assert resolve_model("one_prompt", pipeline) == "general-model"


def test_specific_override_beats_general_override(monkeypatch):
    monkeypatch.setattr(config, "REVIEWBOT_MODEL", "config-review")
    pipeline = _pipeline(ollama_model="general", reviewbot_model="specific")
    assert resolve_model("reviewbot", pipeline) == "specific"


def test_coderbot_ignores_general_ollama_override(monkeypatch):
    monkeypatch.setattr(config, "CODERBOT_MODEL", "config-coder")
    pipeline = _pipeline(ollama_model="general-model")
    assert resolve_model("coderbot", pipeline) == "config-coder"


def test_specagent_pipeline_override_wins(monkeypatch):
    monkeypatch.setattr(config, "SPECAGENT_MODEL", "config-spec")
    pipeline = _pipeline(specagent_model="pipeline-spec")
    assert resolve_model("specagent", pipeline) == "pipeline-spec"


def test_specagent_uses_general_ollama_override(monkeypatch):
    monkeypatch.setattr(config, "SPECAGENT_MODEL", "config-spec")
    pipeline = _pipeline(ollama_model="general-model")
    assert resolve_model("specagent", pipeline) == "general-model"


def test_coderbot_can_resolve_to_none(monkeypatch):
    monkeypatch.setattr(config, "CODERBOT_MODEL", None)
    assert resolve_model("coderbot", _pipeline()) is None


def test_explicit_default_beats_config_fallback(monkeypatch):
    monkeypatch.setattr(config, "CODERBOT_MODEL", "config-coder")
    assert (
        resolve_model("coderbot", _pipeline(), default="runtime-default")
        == "runtime-default"
    )


def test_explicit_none_default_is_honoured(monkeypatch):
    monkeypatch.setattr(config, "CODERBOT_MODEL", "config-coder")
    assert resolve_model("coderbot", _pipeline(), default=None) is None


def test_unknown_use_case_raises():
    with pytest.raises(ValueError):
        resolve_model("does-not-exist")


# ---------------------------------------------------------------------------
# CoderBot catalog
# ---------------------------------------------------------------------------


def test_parse_coderbot_models_reads_every_provider():
    data = {
        "providers": {
            "ollama": {"models": [{"id": "a"}, {"id": "b"}]},
            "other": {"models": [{"id": "c"}]},
        }
    }
    assert parse_coderbot_models(data) == ["a", "b", "c"]


def test_parse_coderbot_models_ignores_malformed_entries():
    assert parse_coderbot_models({"providers": {"p": {"models": ["not-a-dict"]}}}) == []
    assert parse_coderbot_models({"providers": []}) == []
    assert parse_coderbot_models(None) == []


def test_list_coderbot_models_reads_file(tmp_path):
    path = tmp_path / "models.json"
    path.write_text(json.dumps({"providers": {"ollama": {"models": [{"id": "qwen"}]}}}))
    assert list_coderbot_models(path) == ["qwen"]


def test_list_coderbot_models_missing_file_is_empty(tmp_path):
    assert list_coderbot_models(tmp_path / "missing.json") == []


def test_list_coderbot_models_invalid_json_is_empty(tmp_path):
    path = tmp_path / "models.json"
    path.write_text("{ this is not json")
    assert list_coderbot_models(path) == []


def test_list_coderbot_models_uses_configured_path(monkeypatch, tmp_path):
    path = tmp_path / "custom-models.json"
    path.write_text(json.dumps({"providers": {"p": {"models": [{"id": "custom"}]}}}))
    monkeypatch.setattr(config, "PI_AGENT_MODELS_PATH", path)
    assert list_coderbot_models() == ["custom"]


# ---------------------------------------------------------------------------
# Ollama catalog
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_ollama_models_parses_object_response(monkeypatch):
    class _Model:
        def __init__(self, model):
            self.model = model

    class _Response:
        models = [_Model("llama3"), _Model("gpt-oss:20b")]

    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def list(self):
            return _Response()

    monkeypatch.setattr(model_resolver.ollama, "AsyncClient", _Client)
    assert await list_ollama_models() == ["llama3", "gpt-oss:20b"]


@pytest.mark.asyncio
async def test_list_ollama_models_parses_dict_response(monkeypatch):
    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def list(self):
            return {"models": [{"name": "m1"}, {"model": "m2"}]}

    monkeypatch.setattr(model_resolver.ollama, "AsyncClient", _Client)
    assert await list_ollama_models() == ["m1", "m2"]


@pytest.mark.asyncio
async def test_list_ollama_models_degrades_to_empty_on_error(monkeypatch):
    class _Client:
        def __init__(self, *args, **kwargs):
            pass

        async def list(self):
            raise RuntimeError("ollama down")

    monkeypatch.setattr(model_resolver.ollama, "AsyncClient", _Client)
    assert await list_ollama_models() == []
