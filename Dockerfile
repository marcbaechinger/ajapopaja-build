# Stage 1: Build the frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and final image
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS final
WORKDIR /app

# Install system dependencies (if any)
RUN apt-get update && apt-get install -y --no-install-recommends     git     && rm -rf /var/lib/apt/lists/*

# Copy backend workspace definition
COPY backend/pyproject.toml backend/uv.lock ./backend/
COPY backend/api/pyproject.toml ./backend/api/
COPY backend/core/pyproject.toml ./backend/core/
COPY backend/mcp/pyproject.toml ./backend/mcp/

# To satisfy uv sync for workspace members, we need the source code
# before we sync because they are installed as editables/local members.
COPY backend/api/src ./backend/api/src
COPY backend/core/src ./backend/core/src
COPY backend/mcp/src ./backend/mcp/src

# Install dependencies and the project
WORKDIR /app/backend
RUN uv sync --frozen --no-dev

# Copy frontend build artifacts
WORKDIR /app
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Environment variables
ENV MONGODB_URI=mongodb://host.docker.internal:27017/
ENV DATABASE_NAME=ajapopaja
ENV PORT=8000
ENV FRONTEND_DIST_PATH=/app/frontend/dist
ENV PYTHONPATH=/app/backend/api/src:/app/backend/core/src:/app/backend/mcp/src

EXPOSE 8000

# Start command
CMD ["sh", "-c", "uv run --package api uvicorn api.main:app --host 0.0.0.0 --port ${PORT}"]
