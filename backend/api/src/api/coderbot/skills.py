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

"""Per-session staging of Pi skills.

The Docker image ships a read-only *skill library* (see
``PI_SKILLS_LIBRARY_DIR``) but Pi discovers project skills from
``<workspace>/.pi/skills/``. :class:`PiSkillStager` bridges the two: before a
Pi process is spawned it links only the skills that session type is configured
with into the workspace and makes sure git never sees them.

Models stay global (a single ``/root/.pi/agent/models.json``); skills are
deliberately configurable per session type so interactive and CoderBot sessions
can expose different skill sets.
"""

import logging
import shutil
from pathlib import Path
from typing import Iterable, List, Optional

from core import config

logger = logging.getLogger(__name__)

#: Project-root skill directory (relative to a session workspace) from which Pi
#: discovers project skills.
PROJECT_SKILLS_DIR = Path(".pi") / "skills"

#: Pattern added to ``.git/info/exclude`` so staged skills stay invisible to
#: ``git status``, ``git add -A`` and generated PR patches.
GIT_EXCLUDE_PATTERN = ".pi/"


class PiSkillStager:
    """Stages a subset of the image's Pi skill library into a workspace.

    Staging is deliberately best-effort: a missing library, unknown skill or
    unwritable workspace must never break a Pi session. Any problems are logged
    and skipped.
    """

    def __init__(
        self,
        library_dir: Path,
        skill_names: Optional[Iterable[str]] = None,
    ):
        self.library_dir = Path(library_dir)
        self.skill_names = [name for name in (skill_names or []) if name]
        # Paths this stager created (and is therefore allowed to remove).
        self._created: List[Path] = []
        # Workspaces in which skills were staged, so cleanup can prune the
        # now-empty ``.pi/skills``/``.pi`` directories it helped create.
        self._workspaces: List[Path] = []

    @classmethod
    def from_config(
        cls, skill_names: Optional[Iterable[str]] = None
    ) -> "PiSkillStager":
        """Build a stager using the configured image skill library."""
        return cls(config.PI_SKILLS_LIBRARY_DIR, skill_names)

    # ------------------------------------------------------------------
    # Staging
    # ------------------------------------------------------------------
    def stage(self, workspace: Path) -> List[Path]:
        """Link the configured skills into ``workspace/.pi/skills``.

        Returns the list of paths that were created. The method never raises;
        a failure to stage one skill (or the whole workspace) is logged and the
        remaining skills are still attempted.
        """
        workspace = Path(workspace)
        if not self.skill_names:
            return []

        if not self.library_dir.is_dir():
            logger.warning(
                "Pi skill library %s does not exist; skipping skill staging.",
                self.library_dir,
            )
            return []

        if not workspace.is_dir():
            logger.warning(
                "Workspace %s does not exist; skipping skill staging.", workspace
            )
            return []

        skills_dir = workspace / PROJECT_SKILLS_DIR
        for name in self.skill_names:
            source = self.library_dir / name
            if not source.is_dir():
                logger.warning(
                    "Pi skill '%s' not found in %s; skipping.", name, self.library_dir
                )
                continue

            target = skills_dir / name
            # Never clobber a skill the repository already provides. ``exists``
            # is False for a broken symlink, so check ``is_symlink`` too.
            if target.exists() or target.is_symlink():
                logger.info("Pi skill target %s already exists; leaving it.", target)
                continue

            try:
                skills_dir.mkdir(parents=True, exist_ok=True)
                self._link_or_copy(source, target)
            except Exception:  # pragma: no cover - defensive
                logger.warning("Failed to stage Pi skill '%s'.", name, exc_info=True)
                continue

            self._created.append(target)
            logger.info("Staged Pi skill '%s' at %s.", name, target)

        if self._created:
            logger.info("Staged %d Pi skill(s) for %s.", len(self._created), workspace)

        # Ensure git never sees the staged skills, even if a repository already
        # provided some of the configured targets (which are left untouched).
        if workspace not in self._workspaces:
            self._workspaces.append(workspace)
        self._exclude_from_git(workspace)

        return list(self._created)

    @staticmethod
    def _link_or_copy(source: Path, target: Path) -> None:
        """Symlink ``target`` to ``source``, falling back to a copy."""
        try:
            target.symlink_to(source, target_is_directory=True)
        except (OSError, NotImplementedError):
            logger.info(
                "Symlinks unavailable for %s; copying the skill instead.", target
            )
            shutil.copytree(source, target)

    def _exclude_from_git(self, workspace: Path) -> None:
        """Add ``.pi/`` to the workspace's ``.git/info/exclude`` if needed."""
        git_dir = workspace / ".git"
        # A ``.git`` file (worktree/submodule) has no ``info/exclude`` we own.
        if not git_dir.is_dir():
            return

        exclude = git_dir / "info" / "exclude"
        try:
            existing = ""
            if exclude.is_file():
                existing = exclude.read_text(encoding="utf-8", errors="ignore")

            if GIT_EXCLUDE_PATTERN in {line.strip() for line in existing.splitlines()}:
                return

            exclude.parent.mkdir(parents=True, exist_ok=True)
            with exclude.open("a", encoding="utf-8") as handle:
                if existing and not existing.endswith("\n"):
                    handle.write("\n")
                handle.write(GIT_EXCLUDE_PATTERN + "\n")
            logger.debug("Added '%s' to %s.", GIT_EXCLUDE_PATTERN, exclude)
        except Exception:  # pragma: no cover - defensive
            logger.warning(
                "Failed to update git exclude file %s.", exclude, exc_info=True
            )

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    def cleanup(self) -> None:
        """Remove only the paths this stager created (idempotent)."""
        for path in self._created:
            try:
                if path.is_symlink() or path.is_file():
                    path.unlink()
                elif path.is_dir():
                    shutil.rmtree(path)
                logger.debug("Removed staged Pi skill path %s.", path)
            except Exception:  # pragma: no cover - defensive
                logger.warning("Failed to remove staged skill %s.", path, exc_info=True)
        self._created = []

        # Prune the ``.pi/skills`` and ``.pi`` directories, but only when they
        # are empty (``rmdir`` refuses non-empty directories). This keeps a
        # repository's own ``.pi`` content intact.
        for workspace in self._workspaces:
            for directory in (workspace / PROJECT_SKILLS_DIR, workspace / ".pi"):
                try:
                    directory.rmdir()
                except OSError:
                    pass
        self._workspaces = []
