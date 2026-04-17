#!/bin/bash
# Exit on error
set -e

VERSION=${1:-latest}
IMAGE_NAME="ajapopaja-build"

echo "Building Docker image ${IMAGE_NAME}:${VERSION}..."
docker build -t ${IMAGE_NAME}:${VERSION} .

echo "Build complete."
echo "You can run the container with:"
echo "docker run -p 8000:8000 --add-host=host.docker.internal:host-gateway -e MONGODB_URI=mongodb://host.docker.internal:27017/ ${IMAGE_NAME}:${VERSION}"
