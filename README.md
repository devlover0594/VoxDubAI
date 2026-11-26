# VoxDub AI

## Run with Docker Compose

Requirements: Docker Desktop (or Docker Engine) with the Compose plugin.

1. Copy `.env.example` to `.env`.
2. Optionally add your `GEMINI_API_KEY` to `.env` to use the server-side Gemini provider. Other supported AI providers can be configured in the app.
3. Run `docker compose pull` and then `docker compose up -d`.
4. Open [http://localhost:3000](http://localhost:3000).

To use a different host port, set `HOST_PORT` in `.env` (for example, `HOST_PORT=8080`); the container continues to listen on port 3000. Stop the app with `docker compose down`.

The image includes Node.js and Python 3; Python's standard library is used by the uploaded-media analysis worker, so no Python packages need to be installed. The `.env` file is supplied to Compose at runtime and excluded from the Docker build context and image.

Project persistence continues to use the Firebase configuration already included with the app; the container does not provide a local database or persistent media storage.

## Published images

GitHub Actions publishes `ghcr.io/devlover0594/voxdubai:sha-<commit>` for each pushed branch commit. Commits on the repository's default branch also update `ghcr.io/devlover0594/voxdubai:latest`; the Compose file tracks this tag.

The workflow publishes to GitHub Container Registry (GHCR) using the repository-provided `GITHUB_TOKEN` with `packages: write`; no registry credentials need to be added as Actions secrets. The workflow does not change package visibility. If the GHCR package is private, users need to authenticate with `docker login ghcr.io`; the package owner can make it public in the package settings to allow anonymous pulls.
