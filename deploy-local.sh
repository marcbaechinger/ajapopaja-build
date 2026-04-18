#!/bin/bash
# Exit on error
set -e

# Configuration
DEST_DIR="/data/ajapopaja/docker"
IMAGE_NAME="ajapopaja-build"
VERSION="latest"
ENV_FILE="/etc/ajapopaja-build.env"

echo "1. Building Docker image..."
./docker-build.sh $VERSION

echo "2. Ensuring destination directory $DEST_DIR exists..."
sudo mkdir -p $DEST_DIR

echo "3. Exporting image to $DEST_DIR/$IMAGE_NAME.tar..."
docker save -o $DEST_DIR/$IMAGE_NAME.tar $IMAGE_NAME:$VERSION
sudo chmod 644 $DEST_DIR/$IMAGE_NAME.tar

echo "4. Setting up environment file at $ENV_FILE..."
if [ ! -f "$ENV_FILE" ]; then
  sudo bash -c "cat <<EOT > $ENV_FILE
MONGODB_URI=mongodb://host.docker.internal:27017/
OLLAMA_HOST=http://host.docker.internal:11434
DATABASE_NAME=ajapopaja_build_prod
PORT=8081
EOT"
  echo "Created default environment file."
else
  echo "Environment file already exists, skipping."
fi

echo "5. Installing systemd service..."
sudo cp ajapopaja-build.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ajapopaja-build

echo "Deployment complete!"
echo "To start the service: sudo systemctl start ajapopaja-build"
echo "To check status: sudo systemctl status ajapopaja-build"
echo "To view logs: sudo journalctl -u ajapopaja-build -f"
