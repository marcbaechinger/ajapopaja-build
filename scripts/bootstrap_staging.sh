#!/bin/bash
# One-time bootstrap for the Ajapopaja Build staging instance.
#
# Creates the isolated host directories used by staging. By default it leaves
# the staging database empty so you get the full "first-time user" experience
# (register a user, create a first pipeline, create a first task). Pass --seed
# to instead import the generic test_repo task data set.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="/etc/ajapopaja-build-staging.env"
ROOT="/data/ajapopaja/staging"
IMAGE_NAME="ajapopaja-build:latest"
SEED=0

for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    -h|--help)
      echo "Usage: $0 [--seed]"
      echo "  Creates the staging host directories under $ROOT."
      echo "  --seed  also import the test_repo task data into the staging DB"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

echo "Creating staging directories under $ROOT ..."
sudo mkdir -p "$ROOT"/{pi_sessions,sandboxes,remote_workspaces,workspaces}

if [ "$SEED" = "1" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE. Run './deploy-local.sh staging' first." >&2
    exit 1
  fi

  # Read the staging DB settings from the env file installed by deploy-local.sh.
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a

  # MONGODB_URI points at host.docker.internal, which only resolves inside a
  # container (the extra_hosts mapping), so run the seeder in a throwaway
  # container of the same image and mount the checkout read-only for the script.
  echo "Seeding staging database '${DATABASE_NAME}' ..."
  sudo docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -v "$REPO_ROOT:/bootstrap:ro" \
    -e MONGODB_URI="$MONGODB_URI" \
    -e DATABASE_NAME="$DATABASE_NAME" \
    "$IMAGE_NAME" \
    uv run python /bootstrap/scripts/setup_test_db.py \
      --uri "$MONGODB_URI" --db "$DATABASE_NAME"
  echo "Seeding complete."
else
  echo "Staging database left empty for a first-run experience."
  echo "Run '$0 --seed' to import the test_repo task data set instead."
fi

echo "Bootstrap complete. Start staging with:"
echo "  sudo systemctl start ajapopaja-build-staging"
