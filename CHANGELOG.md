# Changelog

Each major milestone is committed and pushed separately under the repository
owner's configured Git identity. Unreleased work is described honestly; feature
designs are not treated as completed runtime features.

## 0.1.0 - In progress

### Architecture and foundation
- Established universal accounts and a game-independent competition model.
- Selected PostgreSQL plus private object storage; OMV is an optional backup target.
- Preserved scribble.rs as the authoritative game engine.
- Added local development and production configuration boundaries.

### Deployment
- Deployment is pending owner review. Target: Cloudflare Pages frontend plus
  a separate long-running Go engine, platform service, and PostgreSQL.
