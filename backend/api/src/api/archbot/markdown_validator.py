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

import re


class MarkdownValidator:
    """
    Helper class for validating and sanitizing Markdown content.
    """

    @staticmethod
    def has_top_level_heading(text: str) -> bool:
        """
        Checks if the Markdown text contains at least one top-level heading (# Heading).
        """
        # Matches # Heading at the start of a line, or after some whitespace
        # if the line starts with #.
        pattern = re.compile(r"^#\s+.+", re.MULTILINE)
        return bool(pattern.search(text))

    @staticmethod
    def sanitize(text: str) -> str:
        """
        Sanitizes the Markdown text by stripping raw HTML tags.
        """
        # Simple regex to strip HTML tags
        clean_pattern = re.compile(r"<[^>]*>")
        return clean_pattern.sub("", text)
