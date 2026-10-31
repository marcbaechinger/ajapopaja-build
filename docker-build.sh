#!/bin/bash
# Exit on error
set -e

VERSION=${1:-latest}
IMAGE_NAME="ajapopaja-build"
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "Building Docker image ${IMAGE_NAME}:${VERSION} (Commit: ${GIT_COMMIT})..."
docker build --build-arg BUILD_VERSION=${GIT_COMMIT} -t ${IMAGE_NAME}:${VERSION} .

echo "Build complete."
echo "To run the container with docker-compose (see docker-compose.yml):"
echo "  docker compose up -d"
echo "Or run directly (adjust PORT as needed). The scoped seccomp profile is"
echo "required for bubblewrap user namespaces; do not use --privileged or"
echo "--cap-add SYS_ADMIN as a substitute:"
echo "docker run -p 8000:8000 --security-opt seccomp=deploy/seccomp-bwrap.json -v /home:/home -v /tmp/nvimsocket:/tmp/nvimsocket -v /data/ajapopaja/pi_sessions:/data/ajapopaja/pi_sessions --add-host=host.docker.internal:host-gateway -e MONGODB_URI=mongodb://host.docker.internal:27017/ -e OLLAMA_HOST=http://host.docker.internal:11434 -e PORT=8000 ${IMAGE_NAME}:${VERSION}"
