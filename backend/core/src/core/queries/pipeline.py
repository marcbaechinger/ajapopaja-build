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

import logging
from typing import Any, List, Optional

from core.exceptions import EntityNotFoundError, ValidationError, VersionMismatchError
from core.models.models import (
    Pipeline,
    PipelineStatus,
    Task,
    _normalize_model_override,
    _validate_command_lists,
)

logger = logging.getLogger(__name__)

#: Sentinel marking a model override that was not supplied in a partial update.
_UNSET: Any = object()


async def get_all_pipelines(include_deleted: bool = False) -> List[Pipeline]:
    # Newest first: order by created_at descending across both branches.
    if include_deleted:
        return await Pipeline.find_all().sort("-created_at").to_list()
    return await Pipeline.find(Pipeline.deleted == False).sort("-created_at").to_list()


def validate_pipeline_input(pipeline: Pipeline) -> None:
    """Validate that the pipeline is consistently populated for either a local
    or a remote repository before it is created.

    - Local pipeline: no ``repo_uri``; ``workspace_path`` optional. Credentials
      imply a remote repo, so they are invalid without a ``repo_uri``.
    - Remote pipeline: ``repo_uri`` required (implies remote); credentials
      optional. ``workspace_path`` is derived from the clone, so it must not be
      set explicitly.
    """
    if pipeline.repo_uri:
        if pipeline.workspace_path:
            raise ValidationError(
                "Remote pipeline must not set workspace_path \u2014 the working "
                "directory is derived from the cloned repository."
            )
    else:
        if pipeline.repo_username or pipeline.repo_token:
            raise ValidationError(
                "A local pipeline cannot have repo_username or repo_token. "
                "Set a repo_uri to create a remote pipeline or clear the "
                "credentials."
            )


async def get_pipeline_by_id(
    pipeline_id: str, include_deleted: bool = False
) -> Pipeline:
    try:
        pipeline = await Pipeline.get(pipeline_id)
    except Exception:
        pipeline = None

    if not pipeline or (not include_deleted and pipeline.deleted):
        raise EntityNotFoundError(f"Pipeline with ID {pipeline_id} not found")
    return pipeline


async def validate_pipeline_repository(pipeline: Pipeline) -> None:
    """Sanitize a pipeline's repository before it is created.

    - Remote: verify the repo_uri is reachable and authenticated.
    - Local:  verify the workspace_path (when set) points to an existing dir.
    Raises ValidationError on failure so the pipeline is never persisted.
    """
    # Imported locally to avoid a circular import (git_utils imports this module).
    from core.utils import git_utils

    if pipeline.repo_uri:
        username, token = git_utils._resolve_credentials(pipeline)
        git_utils.verify_remote_repo(pipeline.repo_uri, username, token)
        return

    if pipeline.workspace_path:
        ws = pipeline.workspace_abs_path
        if not ws or not ws.is_dir():
            raise ValidationError(
                f"The workspace path '{pipeline.workspace_path}' does not resolve "
                "to an existing directory under the project root."
            )


async def create_pipeline(pipeline: Pipeline) -> Pipeline:
    # Sanitize BEFORE inserting so a bad repo is never persisted.
    await validate_pipeline_repository(pipeline)
    # Ensure version is set to 1 for new pipelines
    pipeline.version = 1
    await pipeline.insert()
    # Clone remote repos immediately so the checkout exists without waiting for
    # a container restart (the startup bootstrap only sees pre-existing
    # pipelines). Best-effort: a failed clone is logged but never rolls back the
    # persisted pipeline; the pull UI or a restart can retry it.
    if pipeline.repo_uri:
        from core.utils import git_utils

        try:
            await git_utils.ensure_repo_cloned(pipeline)
        except Exception as e:
            logger.warning(
                "Failed to clone remote repo for pipeline '%s' after creation: %s",
                pipeline.name,
                e,
            )
    return pipeline


async def update_pipeline(
    pipeline_id: str,
    version: int,
    name: Optional[str] = None,
    status: Optional[PipelineStatus] = None,
    workspace_path: Optional[str] = None,
    repo_uri: Optional[str] = None,
    repo_username: Optional[str] = None,
    repo_token: Optional[str] = None,
    doc_root: Optional[str] = None,
    test_commands: Optional[List[List[str]]] = None,
    lint_commands: Optional[List[List[str]]] = None,
    serve_commands: Optional[List[List[str]]] = None,
    build_commands: Optional[List[List[str]]] = None,
    ollama_model: Any = _UNSET,
    one_prompt_model: Any = _UNSET,
    assistant_model: Any = _UNSET,
    archbot_model: Any = _UNSET,
    reviewbot_model: Any = _UNSET,
    docbot_model: Any = _UNSET,
    specagent_model: Any = _UNSET,
    coderbot_model: Any = _UNSET,
) -> Pipeline:
    pipeline = await get_pipeline_by_id(pipeline_id)

    if pipeline.version != version:
        raise VersionMismatchError(
            f"Pipeline version mismatch. Client has {version}, DB "
            f"has {pipeline.version}"
        )

    if name is not None:
        pipeline.name = name
    if status is not None:
        pipeline.status = status
    if workspace_path is not None:
        pipeline.workspace_path = workspace_path
    if repo_uri is not None:
        pipeline.repo_uri = repo_uri
    if repo_username is not None:
        pipeline.repo_username = repo_username
    # Only override the token when a non-empty value is provided, so an empty
    # or blank submission never clears the stored token.
    if repo_token:
        pipeline.repo_token = repo_token
    if doc_root is not None:
        pipeline.doc_root = doc_root
    if test_commands is not None:
        # Re-validate here (mirroring the model validator) so that invalid
        # payloads are rejected with a clear ValidationError before saving.
        pipeline.test_commands = _validate_command_lists(
            test_commands, "test_commands", "test", ValidationError
        )
    if lint_commands is not None:
        # Re-validate here (mirroring the model validator) so that invalid
        # payloads are rejected with a clear ValidationError before saving.
        pipeline.lint_commands = _validate_command_lists(
            lint_commands, "lint_commands", "lint", ValidationError
        )
    if serve_commands is not None:
        # Re-validate here (mirroring the model validator) so that invalid
        # payloads are rejected with a clear ValidationError before saving.
        pipeline.serve_commands = _validate_command_lists(
            serve_commands, "serve_commands", "serve", ValidationError
        )
    if build_commands is not None:
        # Re-validate here (mirroring the model validator) so that invalid
        # payloads are rejected with a clear ValidationError before saving.
        pipeline.build_commands = _validate_command_lists(
            build_commands, "build_commands", "build", ValidationError
        )

    # Model overrides use a sentinel so an explicit ``null`` clears the override
    # while an omitted field (partial PATCH) leaves the stored value untouched.
    if ollama_model is not _UNSET:
        pipeline.ollama_model = _normalize_model_override(ollama_model)
    if one_prompt_model is not _UNSET:
        pipeline.one_prompt_model = _normalize_model_override(one_prompt_model)
    if assistant_model is not _UNSET:
        pipeline.assistant_model = _normalize_model_override(assistant_model)
    if archbot_model is not _UNSET:
        pipeline.archbot_model = _normalize_model_override(archbot_model)
    if reviewbot_model is not _UNSET:
        pipeline.reviewbot_model = _normalize_model_override(reviewbot_model)
    if docbot_model is not _UNSET:
        pipeline.docbot_model = _normalize_model_override(docbot_model)
    if specagent_model is not _UNSET:
        pipeline.specagent_model = _normalize_model_override(specagent_model)
    if coderbot_model is not _UNSET:
        pipeline.coderbot_model = _normalize_model_override(coderbot_model)

    pipeline.version += 1
    await pipeline.save()
    return pipeline


async def delete_pipeline(pipeline_id: str):
    pipeline = await get_pipeline_by_id(pipeline_id)
    # Mark all tasks in this pipeline as deleted
    await Task.find(Task.pipeline_id == pipeline_id).update({"$set": {"deleted": True}})
    # Mark pipeline as deleted
    pipeline.deleted = True
    pipeline.version += 1
    await pipeline.save()
