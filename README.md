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

GitHub Actions publishes `teknisionline/voxdub:sha-<commit>` for each pushed branch commit. Commits on the repository's default branch also update `teknisionline/voxdub:latest`; the Compose file tracks this tag.

For publishing, add the Docker Hub account's `DOCKERHUB_USERNAME` and an access token as repository Actions secrets named `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` in GitHub Settings. The workflow does not change Docker Hub repository visibility. If the repository is private, users need to authenticate with `docker login`; the repository owner can make it public in Docker Hub settings to allow anonymous pulls.
