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

"""Unit tests for the filesystem helpers backing the design-doc library."""

import pytest

from core import config
from core.exceptions import EntityNotFoundError, ValidationError
from core.models.models import Pipeline
from core.utils import design_docs


def _make_pipeline(monkeypatch, tmp_path, doc_root="design") -> Pipeline:
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    # ``model_construct`` avoids Beanie's DB-backed initialization since these
    # tests only exercise the pure filesystem helpers.
    return Pipeline.model_construct(
        name="Project", workspace_path="proj", doc_root=doc_root
    )


def _write_doc(base, relative: str, content: str):
    target = base / "proj" / "design" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


def test_list_design_docs_missing_root_returns_empty(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    documents, total = design_docs.list_design_docs(pipeline)

    assert documents == []
    assert total == 0


def test_list_design_docs_discovers_nested_markdown_with_titles(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(tmp_path, "top.md", "# Top Document\n\nBody.")
    _write_doc(tmp_path, "sub/nested.md", "# Nested Title\n\nMore.")
    _write_doc(tmp_path, "notes.txt", "not markdown")

    documents, total = design_docs.list_design_docs(pipeline)

    assert total == 2
    by_path = {doc.path: doc for doc in documents}
    assert set(by_path) == {"top.md", "sub/nested.md"}
    assert by_path["top.md"].title == "Top Document"
    assert by_path["sub/nested.md"].title == "Nested Title"
    assert by_path["top.md"].size > 0
    assert by_path["top.md"].modified_at is not None
    # Sorted by path.
    assert [doc.path for doc in documents] == ["sub/nested.md", "top.md"]


def test_list_design_docs_falls_back_to_filename_title(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(tmp_path, "dd_no_heading.md", "Body without a heading.")

    documents, _ = design_docs.list_design_docs(pipeline)

    assert documents[0].title == "dd no heading"


def test_list_design_docs_search_by_path(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(tmp_path, "auth.md", "# Authentication\n\nBody.")
    _write_doc(tmp_path, "database.md", "# Database\n\nBody.")

    documents, total = design_docs.list_design_docs(pipeline, query="auth.md")

    assert total == 1
    assert documents[0].path == "auth.md"
    assert documents[0].snippet is None


def test_list_design_docs_search_by_content_returns_snippet(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(
        tmp_path,
        "architecture.md",
        "# Architecture\n\nThe widget pipeline handles scheduling.",
    )
    _write_doc(tmp_path, "other.md", "# Other\n\nUnrelated content.")

    documents, total = design_docs.list_design_docs(pipeline, query="widget")

    assert total == 1
    assert documents[0].path == "architecture.md"
    assert documents[0].snippet is not None
    assert "widget" in documents[0].snippet.lower()


def test_list_design_docs_search_no_match(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(tmp_path, "a.md", "# A\n\nBody.")

    documents, total = design_docs.list_design_docs(pipeline, query="zzz-nope")

    assert documents == []
    assert total == 0


def test_read_design_doc_returns_content_and_title(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(tmp_path, "sub/dd_feature.md", "# Feature\n\nDetails here.")

    doc = design_docs.read_design_doc(pipeline, "sub/dd_feature.md")

    assert doc.path == "sub/dd_feature.md"
    assert doc.title == "Feature"
    assert "Details here." in doc.content
    assert doc.size > 0
    assert doc.modified_at is not None


def test_read_design_doc_missing_file_raises_not_found(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(tmp_path, "a.md", "# A")

    with pytest.raises(EntityNotFoundError):
        design_docs.read_design_doc(pipeline, "does_not_exist.md")


def test_read_design_doc_missing_root_raises_not_found(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)

    with pytest.raises(EntityNotFoundError):
        design_docs.read_design_doc(pipeline, "a.md")


def test_read_design_doc_rejects_path_traversal(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(tmp_path, "a.md", "# A")
    (tmp_path / "proj" / "secret.md").write_text("secret", encoding="utf-8")

    with pytest.raises(ValidationError):
        design_docs.read_design_doc(pipeline, "../secret.md")


def test_read_design_doc_rejects_absolute_path(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(tmp_path, "a.md", "# A")

    with pytest.raises(ValidationError):
        design_docs.read_design_doc(
            pipeline, str(tmp_path / "proj" / "design" / "a.md")
        )


def test_read_design_doc_rejects_non_markdown(monkeypatch, tmp_path):
    pipeline = _make_pipeline(monkeypatch, tmp_path)
    _write_doc(tmp_path, "a.md", "# A")
    (tmp_path / "proj" / "design" / "secret.txt").write_text("x", encoding="utf-8")

    with pytest.raises(ValidationError):
        design_docs.read_design_doc(pipeline, "secret.txt")
