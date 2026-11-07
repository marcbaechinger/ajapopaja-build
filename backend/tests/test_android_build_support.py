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

"""Guards for the Android/JDK toolchain baked into the runtime image.

There is no Docker daemon in the regular test environment, so these lightweight
assertions inspect the deployment artifacts directly. They catch accidental
removal of the toolchain, environment variables or license acceptance step.
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _dockerfile() -> str:
    return (REPO_ROOT / "Dockerfile").read_text()


def test_dockerfile_installs_jdk_and_unzip():
    dockerfile = _dockerfile()
    assert "openjdk-17-jdk-headless" in dockerfile
    assert "unzip" in dockerfile
    assert "ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64" in dockerfile


def test_dockerfile_installs_android_command_line_tools_from_pinned_arg():
    dockerfile = _dockerfile()
    assert "ARG ANDROID_CMDLINE_TOOLS_URL=" in dockerfile
    assert "commandlinetools-linux-" in dockerfile
    assert "${ANDROID_HOME}/cmdline-tools/latest" in dockerfile
    assert "ANDROID_HOME=/opt/android-sdk" in dockerfile
    assert "ANDROID_SDK_ROOT=/opt/android-sdk" in dockerfile
    assert "${ANDROID_HOME}/cmdline-tools/latest/bin" in dockerfile


def test_dockerfile_accepts_licenses_and_installs_platform_tools():
    dockerfile = _dockerfile()
    assert "yes | sdkmanager --licenses" in dockerfile
    assert 'sdkmanager --install "platform-tools"' in dockerfile


def test_agent_guidance_documents_gradle_wrapper_and_local_properties():
    skill = (REPO_ROOT / ".pi" / "skills" / "ajapopaja" / "SKILL.md").read_text()
    howto = (REPO_ROOT / "howtos" / "android_builds.md").read_text()

    for text in (skill, howto):
        assert "./gradlew" in text
        assert "local.properties" in text
        assert "ANDROID_HOME" in text
