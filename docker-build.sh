#!/bin/bash
# Exit on error
set -e

VERSION=${1:-latest}
IMAGE_NAME="ajapopaja-build"
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "Building Docker image ${IMAGE_NAME}:${VERSION} (Commit: ${GIT_COMMIT})..."
docker build --build-arg BUILD_VERSION=${GIT_COMMIT} -t ${IMAGE_NAME}:${VERSION} .

echo "Build complete."
echo "You can run the container with (adjust PORT as needed):"
echo "docker run -p 8000:8000 --add-host=host.docker.internal:host-gateway -e MONGODB_URI=mongodb://host.docker.internal:27017/ -e OLLAMA_HOST=http://host.docker.internal:11434 -e PORT=8000 ${IMAGE_NAME}:${VERSION}"
