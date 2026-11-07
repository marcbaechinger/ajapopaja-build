#!/bin/bash
# Exit on error
set -e

VERSION=${1:-latest}
IMAGE_NAME="ajapopaja-build"
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Load the local configuration (.env) so the printed run example below uses
# your WORKSPACES_ROOT rather than a hardcoded path. Create it from the
# template once:
#   cp .env.example .env
#   # edit WORKSPACES_ROOT
if [ -f .env ]; then
  set -a; . ./.env; set +a
else
  echo "WARNING: .env not found. Copy .env.example to .env and set WORKSPACES_ROOT." >&2
fi

echo "Building Docker image ${IMAGE_NAME}:${VERSION} (Commit: ${GIT_COMMIT})..."
docker build --build-arg BUILD_VERSION=${GIT_COMMIT} -t ${IMAGE_NAME}:${VERSION} .

echo "Build complete."
echo "To run the container with docker-compose (see docker-compose.yml):"
echo "  docker compose up -d"
echo "Or run directly (adjust PORT as needed):"
echo "docker run -p 8000:8000 -v \${WORKSPACES_ROOT:-<your-workspace-root>}:\${WORKSPACES_ROOT:-<your-workspace-root>} -v /tmp/nvimsocket:/tmp/nvimsocket -v /data/ajapopaja/pi_sessions:/data/ajapopaja/pi_sessions --add-host=host.docker.internal:host-gateway -e MONGODB_URI=mongodb://host.docker.internal:27017/ -e OLLAMA_HOST=http://host.docker.internal:11434 -e PORT=8000 ${IMAGE_NAME}:${VERSION}"
