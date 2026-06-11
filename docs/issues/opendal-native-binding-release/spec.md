# OpenDAL native binding release crash

## User Story
Users installing `v1.0.6-beta.4` can launch DeepChat successfully on every packaged platform after the cloud sync migration to OpenDAL.

## Problem
The packaged app starts with `opendal/generated.js` but cannot resolve the platform native binding package such as `@opendal/lib-darwin-arm64`, causing a main-process crash before the UI loads.

## Acceptance Criteria
- Packaged builds include the platform-specific OpenDAL native binding package in the Electron app module resolution path.
- The native binding package files are unpacked so Electron can load the `.node` binary.
- Local release checks pass.

## Non-goals
- Change cloud sync behavior.
- Replace OpenDAL.
