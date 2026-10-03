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

"""Tests for the one-shot prompt renderer."""

from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest

from api.oneprompt.registry import parse_template
from api.oneprompt.renderer import (
    ContextResolver,
    MissingPromptKeyError,
    PromptRenderError,
    StringTemplateRenderer,
    TemplateRenderer,
    render_template,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclass
class Context:
    name: str
    count: int


def _template(body: str):
    source = f"---\nid: sample\ntitle: Sample\n---\n{body}"
    return parse_template(source, prompt_id="sample")


# ---------------------------------------------------------------------------
# Rendering correctness
# ---------------------------------------------------------------------------


def test_render_mapping_context_supports_both_syntaxes():
    template = _template("Hello $name, you have ${count} new messages.")

    result = render_template(template, {"name": "Ada", "count": 3})

    assert result == "Hello Ada, you have 3 new messages."


def test_render_object_context():
    template = _template("Hello $name, you have ${count} new messages.")

    result = render_template(template, Context(name="Ada", count=3))

    assert result == "Hello Ada, you have 3 new messages."


def test_render_raw_string_template():
    assert render_template("Hi ${name}", {"name": "Ada"}) == "Hi Ada"


def test_render_preserves_surrounding_body_text():
    template = _template('Pipeline: ${pipeline}\n\nSpec:\n"""${spec}"""\n')

    result = render_template(template, {"pipeline": "p", "spec": "- a\n- b"})

    assert result == 'Pipeline: p\n\nSpec:\n"""- a\n- b"""'


def test_render_bundled_template_end_to_end():
    registry_context = {
        "pipeline_name": "Ajapopaja",
        "pipeline_id": "p-1",
        "task_title": "Add feature",
        "task_spec": "- do a thing",
    }
    from api.oneprompt.registry import registry

    template = registry.get("task_elaborate_spec")
    result = render_template(template, registry_context)

    assert "Pipeline: Ajapopaja (id p-1)" in result
    assert "Task title: Add feature" in result
    assert '"""- do a thing"""' in result
    # Every placeholder was substituted: no literal token is left behind.
    assert "$" not in result


def test_bundled_templates_render_model_from_one_prompt_config():
    from api.oneprompt.registry import registry

    config = SimpleNamespace(ONE_PROMPT_OLLAMA_MODEL="one-shot-template-model")

    for prompt_id in ("task_elaborate_spec", "session_generate_title"):
        template = registry.get(prompt_id)
        assert template.model == "${ONE_PROMPT_OLLAMA_MODEL}"
        rendered = render_template(template.model, {}, environment={}, config=config)
        assert rendered == "one-shot-template-model"


# ---------------------------------------------------------------------------
# Context vs. environment resolution
# ---------------------------------------------------------------------------


def test_environment_fallback_is_used_for_unknown_context_keys():
    template = _template("model=$OLLAMA_MODEL")

    result = render_template(template, {}, environment={"OLLAMA_MODEL": "test-model"})

    assert result == "model=test-model"


def test_context_takes_precedence_over_environment():
    template = _template("model=${OLLAMA_MODEL}")

    result = render_template(
        template,
        {"OLLAMA_MODEL": "context-model"},
        environment={"OLLAMA_MODEL": "env-model"},
    )

    assert result == "model=context-model"


def test_config_fallback_is_used_as_last_resort():
    template = _template("model=${OLLAMA_MODEL}")
    config = SimpleNamespace(OLLAMA_MODEL="config-model")

    result = render_template(template, {}, environment={}, config=config)

    assert result == "model=config-model"


def test_environment_is_not_required_when_context_is_complete():
    template = _template("hi ${name}")
    assert (
        render_template(template, {"name": "Ada"}, environment={"name": "wrong"})
        == "hi Ada"
    )


# ---------------------------------------------------------------------------
# Missing keys
# ---------------------------------------------------------------------------


def test_missing_key_raises_clear_error():
    template = _template("Hello ${name} and ${other}")

    with pytest.raises(MissingPromptKeyError) as excinfo:
        render_template(template, {"name": "Ada"}, environment={})

    assert "other" in excinfo.value.missing_keys
    assert "other" in str(excinfo.value)
    assert excinfo.value.status == "error"


def test_missing_key_never_renders_placeholder():
    template = _template("Hello ${name}")

    with pytest.raises(MissingPromptKeyError):
        render_template(template, {}, environment={})


def test_invalid_template_syntax_raises_render_error():
    with pytest.raises(PromptRenderError):
        render_template("broken $", {}, environment={})


# ---------------------------------------------------------------------------
# Resolver protocol
# ---------------------------------------------------------------------------


def test_context_resolver_protocol():
    resolver = ContextResolver(
        context={"from_context": "ctx"},
        environment={"from_env": "env"},
        config=SimpleNamespace(from_config="cfg"),
    )

    assert resolver["from_context"] == "ctx"
    assert resolver["from_env"] == "env"
    assert resolver["from_config"] == "cfg"
    assert "from_context" in resolver
    assert "totally_missing" not in resolver
    assert resolver.resolve("totally_missing", default="fallback") == "fallback"


def test_context_resolver_raises_on_missing_key():
    resolver = ContextResolver(context={}, environment={}, config=None)

    with pytest.raises(MissingPromptKeyError):
        resolver["nope"]


# ---------------------------------------------------------------------------
# Renderer is swappable
# ---------------------------------------------------------------------------


class _RecordingRenderer(TemplateRenderer):
    def __init__(self) -> None:
        self.calls: list[tuple[Any, Any]] = []

    def render(self, template: Any, context: Any = None) -> str:
        self.calls.append((template, context))
        return "rendered-by-custom-engine"


def test_renderer_can_be_swapped():
    custom = _RecordingRenderer()

    result = render_template("ignored ${x}", {"x": 1}, renderer=custom)

    assert result == "rendered-by-custom-engine"
    assert custom.calls and custom.calls[0][1] == {"x": 1}


def test_string_template_renderer_can_be_instantiated_directly():
    renderer = StringTemplateRenderer(environment={"MODEL": "m"})

    assert renderer.render("model=${MODEL}", {}) == "model=m"
