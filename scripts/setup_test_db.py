#!/usr/bin/env python3
"""Standalone script to seed a test database with the tasks of ``test_repo``.

This script imports the tasks from ``test_repo_tasks_data.json`` (or any
``--data`` file following the same schema) into a MongoDB database, leaving them
in the ``CREATED`` state so they can be scheduled and executed afterwards.

It is **idempotent**: it always creates a fresh, deterministic ``test_repo``
Pipeline if one is absent, and within a given database it only creates tasks
that do not already exist for that pipeline.

Examples:
    # Use default local MongoDB + ajapopaja_build_prod + default data file
    python scripts/setup_test_db.py

    # Seed an isolated test database
    python scripts/setup_test_db.py --db mytestdb

    # Point at a remote MongoDB with a custom data file
    python scripts/setup_test_db.py --uri mongodb://host:27017 --db prod \\
        --data /path/to/tasks.json
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# Make the backend workspace packages importable regardless of the CWD this
# script is invoked from. The ``core`` package lives in ``backend/core/src``.
_REPO_ROOT = Path(__file__).resolve().parent.parent
for _src in (_REPO_ROOT / "backend" / "core" / "src",):
    _src_str = str(_src)
    if _src_str not in sys.path:
        sys.path.insert(0, _src_str)

from core.db import init_db  # noqa: E402
from core.models.models import Pipeline, Task, TaskStatus  # noqa: E402
from core.queries import pipeline as pipeline_queries  # noqa: E402
from core.queries import task as task_queries  # noqa: E402

PIPELINE_NAME = "test_repo"
# Fields that are safe to set at creation time. Status is always forced to
# CREATED regardless of file content.
ALLOWED_TASK_FIELDS = (
    "title",
    "description",
    "spec",
    "want_design_doc",
    "type",
    "order",
)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description=(
            "Seed a MongoDB database with the tasks of the test_repo pipeline, "
            "all created in the CREATED state."
        )
    )
    parser.add_argument(
        "--uri",
        default="mongodb://localhost:27017",
        help="MongoDB connection string (default: mongodb://localhost:27017)",
    )
    parser.add_argument(
        "--db",
        default="ajapopaja_build_prod",
        help="Target database name to seed (default: ajapopaja_build_prod)",
    )
    default_data = Path(__file__).resolve().parent / "test_repo_tasks_data.json"
    parser.add_argument(
        "--data",
        default=str(default_data),
        help=(
            f"Path to the JSON file containing task data "
            f"(default: {default_data})"
        ),
    )
    return parser.parse_args(argv)


def load_tasks(data_path):
    with open(data_path, encoding="utf-8") as fh:
        raw = json.load(fh)
    if not isinstance(raw, list):
        raise ValueError("The data file must contain a JSON array of task objects.")

    tasks = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"Data item at index {idx} is not an object.")
        for key in item:
            if key not in ALLOWED_TASK_FIELDS:
                raise ValueError(
                    f"Unsupported field '{key}' in task at index {idx}. Allowed: "
                    f"{', '.join(ALLOWED_TASK_FIELDS)}"
                )
        tasks.append(item)
    return tasks


async def get_or_create_pipeline(name: str) -> Pipeline:
    existing = await Pipeline.find_one(
        Pipeline.name == name, Pipeline.deleted == False
    )
    if existing:
        print(f"Reusing existing pipeline '{name}' ({existing.id}).")
        return existing
    return await pipeline_queries.create_pipeline(Pipeline(name=name))


async def seed_tasks(pipeline: Pipeline, tasks):
    inserted = 0
    skipped = 0

    # Existing non-deleted task titles in this pipeline, used for idempotency.
    existing_titles = {
        t.title
        for t in await Task.find(
            Task.pipeline_id == str(pipeline.id), Task.deleted == False
        ).to_list()
    }

    for item in tasks:
        title = item["title"]
        if title in existing_titles:
            print(f"  skipping existing task: {title!r}")
            skipped += 1
            continue

        task = Task(
            pipeline_id=str(pipeline.id),
            title=title,
            status=TaskStatus.CREATED,
            description=item.get("description"),
            spec=item.get("spec"),
            want_design_doc=item.get("want_design_doc", False),
            type=item.get("type", "manual"),
            order=item.get("order", 0),
        )
        await task_queries.create_task(str(pipeline.id), task, actor="system")
        existing_titles.add(title)
        inserted += 1

    return inserted, skipped


async def main(argv=None):
    args = parse_args(argv)

    # Configure the shared core.db bootstrap (reuses core.db.init_db).
    os.environ["MONGODB_URI"] = args.uri
    os.environ["DATABASE_NAME"] = args.db

    print(f"Initializing database '{args.db}' at {args.uri} ...")
    await init_db(force=True)

    tasks = load_tasks(args.data)
    print(f"Loaded {len(tasks)} task(s) from {args.data}")

    pipeline = await get_or_create_pipeline(PIPELINE_NAME)
    inserted, skipped = await seed_tasks(pipeline, tasks)

    print(
        f"Seeded {inserted} task(s) into pipeline '{PIPELINE_NAME}' "
        f"({pipeline.id}) in database '{args.db}' "
        f"({skipped} already existed and were skipped)."
    )


if __name__ == "__main__":
    asyncio.run(main())
