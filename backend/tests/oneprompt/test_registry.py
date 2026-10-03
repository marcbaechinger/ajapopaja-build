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

"""Tests for the one-shot prompt template registry."""

from __future__ import annotations

import textwrap

import pytest

from api.oneprompt.registry import (
    PromptNotFoundError,
    PromptRegistry,
    PromptTemplate,
    PromptTemplateError,
    parse_template,
    registry,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_template(tmp_path, prompt_id, body="Hello ${name}", **meta):
    metadata = {"id": prompt_id, "title": f"{prompt_id} title", **meta}
    front_matter = "\n".join(f"{key}: {value}" for key, value in metadata.items())
    path = tmp_path / f"{prompt_id}.prompt"
    path.write_text(f"---\n{front_matter}\n---\n{body}\n", encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def test_discovers_all_prompt_files(tmp_path):
    _write_template(tmp_path, "alpha")
    _write_template(tmp_path, "beta")

    registry = PromptRegistry(tmp_path)

    assert registry.ids() == ["alpha", "beta"]
    assert len(registry) == 2
    assert registry.has("alpha")
    assert "beta" in registry


def test_discovery_exposes_template_metadata(tmp_path):
    _write_template(
        tmp_path,
        "task_elaborate_spec",
        label="Elaborate",
        title="Expand the task specification",
        description="Turn a dot-list into a full spec.",
        model="${OLLAMA_MODEL}",
        accept_label="Accept",
        reject_label="Reject",
    )

    template = PromptRegistry(tmp_path).get("task_elaborate_spec")

    assert isinstance(template, PromptTemplate)
    assert template.id == "task_elaborate_spec"
    assert template.label == "Elaborate"
    assert template.title == "Expand the task specification"
    assert template.description == "Turn a dot-list into a full spec."
    assert template.model == "${OLLAMA_MODEL}"
    assert template.accept_label == "Accept"
    assert template.reject_label == "Reject"
    assert template.body == "Hello ${name}"


def test_discovery_ignores_non_prompt_files(tmp_path):
    _write_template(tmp_path, "alpha")
    (tmp_path / "notes.txt").write_text("not a template", encoding="utf-8")
    (tmp_path / "README.md").write_text("# Docs", encoding="utf-8")

    registry = PromptRegistry(tmp_path)

    assert registry.ids() == ["alpha"]


def test_missing_directory_yields_empty_registry(tmp_path):
    registry = PromptRegistry(tmp_path / "does-not-exist")

    assert len(registry) == 0
    assert registry.all() == []


def test_reload_picks_up_new_templates(tmp_path):
    _write_template(tmp_path, "alpha")
    registry = PromptRegistry(tmp_path)
    assert registry.ids() == ["alpha"]

    _write_template(tmp_path, "beta")
    registry.reload()

    assert registry.ids() == ["alpha", "beta"]


def test_default_registry_discovers_bundled_template():
    template = registry.get("task_elaborate_spec")

    assert template.label == "Elaborate"
    assert "${ONE_PROMPT_OLLAMA_MODEL}" == template.model
    assert template.accept_label == "Accept"
    assert template.reject_label == "Reject"
    assert "${task_spec}" in template.body


# ---------------------------------------------------------------------------
# Resolution / metadata access
# ---------------------------------------------------------------------------


def test_resolve_by_id(tmp_path):
    _write_template(tmp_path, "alpha")
    registry = PromptRegistry(tmp_path)

    assert registry.get("alpha").id == "alpha"
    assert registry.resolve("alpha").id == "alpha"
    assert registry["alpha"].id == "alpha"
    assert registry.find("missing") is None


def test_unknown_prompt_id_raises_not_found(tmp_path):
    registry = PromptRegistry(tmp_path)

    with pytest.raises(PromptNotFoundError) as excinfo:
        registry.get("does_not_exist")

    assert excinfo.value.status == "not_found"
    assert excinfo.value.prompt_id == "does_not_exist"


def test_dunder_getitem_raises_not_found(tmp_path):
    registry = PromptRegistry(tmp_path)

    with pytest.raises(PromptNotFoundError):
        _ = registry["missing"]


def test_templates_property_is_a_copy(tmp_path):
    _write_template(tmp_path, "alpha")
    registry = PromptRegistry(tmp_path)

    snapshot = registry.templates
    snapshot.clear()

    assert registry.has("alpha")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_front_matter_id_must_match_file_stem(tmp_path):
    path = tmp_path / "alpha.prompt"
    path.write_text(
        textwrap.dedent(
            """\
            ---
            id: beta
            title: Mismatch
            ---
            body
            """
        ),
        encoding="utf-8",
    )

    with pytest.raises(PromptTemplateError):
        PromptRegistry(tmp_path)


def test_missing_front_matter_raises(tmp_path):
    path = tmp_path / "alpha.prompt"
    path.write_text("just a body without front-matter", encoding="utf-8")

    with pytest.raises(PromptTemplateError):
        PromptRegistry(tmp_path)


def test_missing_id_raises(tmp_path):
    path = tmp_path / "alpha.prompt"
    path.write_text("---\ntitle: No id\n---\nbody", encoding="utf-8")

    with pytest.raises(PromptTemplateError):
        parse_template(path.read_text(encoding="utf-8"), path=path, prompt_id="alpha")


def test_invalid_yaml_raises(tmp_path):
    path = tmp_path / "alpha.prompt"
    path.write_text("---\nid: [unclosed\n---\nbody", encoding="utf-8")

    with pytest.raises(PromptTemplateError):
        parse_template(path.read_text(encoding="utf-8"), path=path, prompt_id="alpha")


def test_front_matter_defaults_are_applied(tmp_path):
    path = _write_template(tmp_path, "alpha")
    template = parse_template(
        path.read_text(encoding="utf-8"), path=path, prompt_id="alpha"
    )

    assert template.label == ""
    assert template.accept_label == "Accept"
    assert template.reject_label == "Reject"
    assert template.description == ""
    assert template.model == ""
    assert template.title == "alpha title"


def test_parse_template_strips_surrounding_blank_lines(tmp_path):
    path = tmp_path / "alpha.prompt"
    path.write_text("---\nid: alpha\n---\n\n\nbody line\n\n\n", encoding="utf-8")

    template = parse_template(
        path.read_text(encoding="utf-8"), path=path, prompt_id="alpha"
    )

    assert template.body == "body line"


# ---------------------------------------------------------------------------
# Convenience rendering through the registry
# ---------------------------------------------------------------------------


def test_registry_render_resolves_and_renders(tmp_path):
    _write_template(tmp_path, "alpha", body="Hi ${name}!")
    registry = PromptRegistry(tmp_path)

    assert registry.render("alpha", {"name": "Ada"}) == "Hi Ada!"


def test_template_render_helper(tmp_path):
    _write_template(tmp_path, "alpha", body="Hi ${name}!")
    template = PromptRegistry(tmp_path).get("alpha")

    assert template.render({"name": "Ada"}) == "Hi Ada!"
