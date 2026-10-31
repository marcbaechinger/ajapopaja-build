#!/bin/bash
# Deploy Ajapopaja Build for a named environment.
#
# Usage:
#   ./deploy-local.sh            # production  -> /etc/ajapopaja-build.env, :8081
#   ./deploy-local.sh staging    # staging     -> /etc/ajapopaja-build-staging.env, :8082
#
# Both environments share the same Docker image and tarball; only the env file,
# data directory, systemd unit and compose project differ.
set -e

ENV_NAME="${1:-prod}"

# Per-environment mapping. Keep the production values identical to the historic
# single-instance setup so an existing deployment keeps working unchanged.
case "$ENV_NAME" in
  prod)
    ENV_FILE="/etc/ajapopaja-build.env"
    ENV_TEMPLATE="deploy/prod.env.example"
    SERVICE="ajapopaja-build"
    SERVICE_TEMPLATE="ajapopaja-build.service"
    DATA_DIR="/data/ajapopaja"
    ;;
  staging)
    ENV_FILE="/etc/ajapopaja-build-staging.env"
    ENV_TEMPLATE="deploy/staging.env.example"
    SERVICE="ajapopaja-build-staging"
    SERVICE_TEMPLATE="ajapopaja-build-staging.service"
    DATA_DIR="/data/ajapopaja/staging"
    ;;
  *)
    echo "Unknown environment '$ENV_NAME' (supported: prod, staging)" >&2
    exit 1
    ;;
esac

# Configuration shared by every environment.
DEST_DIR="/data/ajapopaja/docker"
IMAGE_NAME="ajapopaja-build"
VERSION="latest"

echo "1. Building Docker image (shared by all environments)..."
./docker-build.sh "$VERSION"

echo "2. Ensuring destination directory $DEST_DIR exists..."
sudo mkdir -p "$DEST_DIR"

# Copy the docker-compose.yml and its scoped bubblewrap seccomp profile to the
# stable location used by the systemd unit. Both production and staging have
# their own DATA_DIR, so each instance gets its own copy.
echo "2b. Copying docker-compose.yml and seccomp profile to $DATA_DIR/..."
sudo mkdir -p "$DATA_DIR"
sudo cp docker-compose.yml "$DATA_DIR/docker-compose.yml"
sudo cp deploy/seccomp-bwrap.json "$DATA_DIR/seccomp-bwrap.json"
sudo chmod 644 "$DATA_DIR/docker-compose.yml" "$DATA_DIR/seccomp-bwrap.json"

echo "2c. Setting up environment file at $ENV_FILE..."
if [ ! -f "$ENV_FILE" ]; then
  sudo cp "$ENV_TEMPLATE" "$ENV_FILE"
  # Every instance must have its own JWT secret so tokens cannot be replayed
  # across production and staging. Replace the placeholder with a freshly
  # generated random value on first deploy.
  SECRET=$(openssl rand -hex 32 2>/dev/null \
    || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  sudo sed -i "s/^AUTH_SECRET_KEY=.*/AUTH_SECRET_KEY=$SECRET/" "$ENV_FILE"
  echo "Created environment file from $ENV_TEMPLATE."
else
  echo "Environment file already exists, skipping."
fi

# Create the per-instance writable roots declared by the env file. Host and
# container paths are identical (mounted 1:1), so creating them on the host is
# enough. The env file is trusted system configuration owned by root. The
# defaults mirror docker-compose.yml so an older env file that predates
# SANDBOX_ROOT/REMOTE_WORKSPACES_ROOT keeps working.
echo "2d. Creating writable roots for '$ENV_NAME'..."
sudo bash -c "set -a; . '$ENV_FILE'; set +a; \
  mkdir -p \"\${PI_SESSIONS_ROOT:-/data/ajapopaja/pi_sessions}\" \
           \"\${SANDBOX_ROOT:-/data/ajapopaja/sandboxes}\" \
           \"\${REMOTE_WORKSPACES_ROOT:-/data/ajapopaja/remote_workspaces}\" \
           \"\${WORKSPACES_ROOT:-/home/marc-baechinger/monolit/code}\""

echo "3. Exporting shared image to $DEST_DIR/$IMAGE_NAME.tar..."
docker save -o "$DEST_DIR/$IMAGE_NAME.tar" "$IMAGE_NAME:$VERSION"
sudo chmod 644 "$DEST_DIR/$IMAGE_NAME.tar"

echo "2e. Installing friendly hostnames (ajapopaja / ajapopaja.stage)..."
sudo cp scripts/setup-hostnames.sh /usr/local/bin/setup-hostnames.sh
sudo chmod 755 /usr/local/bin/setup-hostnames.sh
# Best effort: the service unit also runs this on every start via
# ExecStartPost, so a failure here must not abort an otherwise valid deploy.
sudo /usr/local/bin/setup-hostnames.sh \
  || echo "WARNING: could not install hostname entries (fix with: sudo /usr/local/bin/setup-hostnames.sh)" >&2

echo "4. Installing systemd service..."
sudo cp "$SERVICE_TEMPLATE" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE"

echo "Deployment complete for '$ENV_NAME'!"
echo "To start the service: sudo systemctl start $SERVICE"
echo "To check status: sudo systemctl status $SERVICE"
echo "To view logs: sudo journalctl -u $SERVICE -f"
