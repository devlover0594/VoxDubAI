# Changelog

## Build 0.0.0 - 2026-11-26

- Moved uploaded video/audio transcription and analysis to the Python worker in `server/analyze_media.py`. Existing AI providers, fallback behavior, translations, and segment response format are retained; microphone transcription and dubbing remain unchanged.
- Python 3 must be available to run the server. Set `PYTHON_EXECUTABLE` when the Python command is not `python` on Windows or `python3` on other platforms.
- Added a Docker Compose deployment with Node.js, Python 3, and runtime-only environment configuration for straightforward self-hosting.
- Added GitHub Actions publishing to Docker Hub (`teknisionline/voxdub`) with a unique SHA tag on branch pushes and `latest` only for the default branch.
