# Stage 1: Build the frontend
FROM node:24-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and final image
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS final
WORKDIR /app
# Install system dependencies. JDK 17 is required by Android Gradle Plugin 8.x;
# unzip is needed to install the Android command-line tools below.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    tree \
    curl \
    openjdk-17-jdk-headless \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# The container runs as root, but mounted workspaces (e.g. /home) may be owned
# by a different host uid. Git's dubious-ownership safety check would then
# refuse to read/operate on those repos. Trust all directories for git.
RUN git config --global --add safe.directory '*'

# Provide a git identity so `git commit` works inside the container (e.g. when
# accepting a pull request). Overridable at runtime via GIT_USER_NAME/GIT_USER_EMAIL.
RUN git config --global user.name "Ajapopaja Build" \
    && git config --global user.email "ajapopaja-build@localhost"

# Java and Android build toolchain.
#
# Android projects are built with their own Gradle wrapper, which downloads the
# matching Gradle distribution on first use. We only bake in the JDK and the
# Android command-line tools, accept the SDK licenses, and let AGP download the
# project-specific platform/build-tools on demand. This keeps the image much
# smaller than bundling a full SDK and works for any compileSdk version.
ARG ANDROID_CMDLINE_TOOLS_VERSION=11076708
ARG ANDROID_CMDLINE_TOOLS_URL=https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
    && curl -fsSL -o /tmp/android-cmdline-tools.zip "${ANDROID_CMDLINE_TOOLS_URL}" \
    && unzip -q /tmp/android-cmdline-tools.zip -d "${ANDROID_HOME}/cmdline-tools" \
    && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" \
    && rm /tmp/android-cmdline-tools.zip \
    && yes | sdkmanager --licenses > /dev/null \
    && sdkmanager --install "platform-tools"

# Install Node.js (pi requires Node >= 22.19.0) and the pi coding agent
ARG PI_VERSION=1.5.0
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${PI_VERSION} \
    && rm -rf /var/lib/apt/lists/*

# Provide pi's model configuration. The container runs as root, so pi reads
# ~/.pi/agent/models.json from /root/.pi/agent/. Only the models listed in
# docker/pi-agent/models.json (qwen3.6:27b, deepseek-v4.1-flash:cloud) are exposed.
RUN mkdir -p /root/.pi/agent
COPY docker/pi-agent/models.json /root/.pi/agent/models.json

# Bundle the Pi skill library into a stable, read-only image location. Skills
# are staged per session type (interactive vs. CoderBot) from here rather than
# installed into the global user skill root, so each session type can expose a
# different skill set. Models stay global (the single models.json above).
COPY .pi/skills /opt/ajapopaja/pi/skills
ENV PI_SKILLS_LIBRARY_DIR=/opt/ajapopaja/pi/skills
ENV INTERACTIVE_SKILLS="ajapopaja code-review"
# The bundled ajapopaja skill's mcp_client.py helper requires httpx.
RUN pip install --no-cache-dir httpx
# Copy backend workspace definition
COPY backend/pyproject.toml backend/uv.lock ./backend/
COPY backend/api/pyproject.toml ./backend/api/
COPY backend/core/pyproject.toml ./backend/core/
COPY backend/mcp/pyproject.toml ./backend/mcp/

# Copy backend source code
COPY backend/api/src ./backend/api/src
COPY backend/core/src ./backend/core/src
COPY backend/mcp/src ./backend/mcp/src

# Install dependencies and the project
WORKDIR /app/backend
RUN uv sync --frozen --no-dev

# Copy frontend build artifacts to a stable path
COPY --from=frontend-builder /app/frontend/dist /app/frontend_dist

# Versioning
ARG BUILD_VERSION=dev
ENV APP_VERSION=$BUILD_VERSION

# Environment variables
ENV MONGODB_URI=mongodb://host.docker.internal:27017/
ENV OLLAMA_HOST=http://host.docker.internal:11434
ENV DATABASE_NAME=ajapopaja_build_prod
ENV PORT=8081
# Port on which a user-started pipeline dev server listens. Published to the
# host by docker-compose.yml; overridable at runtime via the env file.
ENV DEV_SERVER_PORT=1224
ENV FRONTEND_DIST_PATH=/app/frontend_dist
ENV PYTHONPATH=/app/backend/api/src:/app/backend/core/src:/app/backend/mcp/src
ENV WORKSPACES_ROOT=/workspaces

# Persistent agent-session root. Mounted 1:1 from the host in docker-compose.yml
# so interactive and batch sessions survive container restarts.
ENV PI_SESSIONS_ROOT=/data/ajapopaja/pi_sessions
RUN mkdir -p /data/ajapopaja/pi_sessions

# Create default workspaces directory
RUN mkdir -p /workspaces

# Workdir MUST be the backend directory so uv can find pyproject.toml
WORKDIR /app/backend

EXPOSE 8000 1224

# Start command
CMD ["sh", "-c", "uv run --package api uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
