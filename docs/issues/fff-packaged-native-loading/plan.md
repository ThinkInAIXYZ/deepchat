# FFF Packaged Native Loading Plan

## Approach

- Detect the packaged FFF entry at
  `process.resourcesPath/app.asar.unpacked/node_modules/@ff-labs/fff-node/dist/src/index.js`.
- Make the default `FffSearchService` module loader import that file URL when present.
- Fall back to the bare `@ff-labs/fff-node` import for dev, tests, and unpackaged runs.
- Leave explicit test-injected `moduleLoader` behavior unchanged.

## Validation

- Add a focused unit test that sets a temporary `process.resourcesPath` and verifies the
  default loader uses the unpacked FFF entry.
- Run focused FFF service tests.
- Run required project checks after implementation.

## Risks

- A malformed unpacked package would fail during import. That failure remains wrapped by
  `FffSearchUnavailableError` through the existing loader error path.
- Dynamic file URL imports are cached by URL, so tests use unique temp directories.
