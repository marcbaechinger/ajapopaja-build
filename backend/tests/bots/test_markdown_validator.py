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

from api.archbot.markdown_validator import MarkdownValidator


def test_has_top_level_heading_valid():
    md = "# My Design Document\n\nSome content."
    assert MarkdownValidator.has_top_level_heading(md) is True


def test_has_top_level_heading_invalid():
    md = "## Subheading\n\nSome content without top-level heading."
    assert MarkdownValidator.has_top_level_heading(md) is False


def test_has_top_level_heading_empty():
    assert MarkdownValidator.has_top_level_heading("") is False


def test_sanitize_html_tags():
    md = "# Heading\n\n<script>alert('xss')</script>Body content <p>with tags</p>."
    expected = "# Heading\n\nalert('xss')Body content with tags."
    assert MarkdownValidator.sanitize(md) == expected


def test_sanitize_no_html():
    md = "# Heading\n\nBody content without HTML."
    assert MarkdownValidator.sanitize(md) == md


def test_has_top_level_heading_multiline():
    md = "Some intro.\n\n# The Real Heading\n\nContent."
    assert MarkdownValidator.has_top_level_heading(md) is True
