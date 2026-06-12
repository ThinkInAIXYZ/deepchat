# FFF Packaged Native Loading

## Problem

Packaged DeepChat can show `Error: FFF native library is not available` when agent `glob`
or `grep` runs. The packaged app contains `@ff-labs/fff-node`, `ffi-rs`, and the platform
native packages under `app.asar.unpacked`, but the main process resolves
`@ff-labs/fff-node` from `app.asar`.

`@ff-labs/fff-node` resolves its platform library with `createRequire()` from its package
root. When that root is inside `app.asar`, the manually copied `@ff-labs/fff-bin-*`
package in `app.asar.unpacked` is outside the module resolution tree and `findBinary()`
returns `null`.

## Acceptance Criteria

- Packaged agent `glob` and `grep` load FFF from `app.asar.unpacked` when the unpacked
  package exists.
- Development and test environments keep using the normal `@ff-labs/fff-node` import.
- FFF native availability failures still surface as `FffSearchUnavailableError`.
- The fix stays scoped to FFF loading and packaging behavior.

## Non-Goals

- Replacing FFF search behavior.
- Changing tool schemas or renderer UI.
- Reworking Electron Builder packaging for all native dependencies.

## Constraints

- Keep `@ff-labs/fff-node` isolated behind `FffSearchService`.
- Avoid depending on Electron imports in this low-level service.
