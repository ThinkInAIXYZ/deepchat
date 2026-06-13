# Plan

## Diagnosis

Bundled RTK `0.42.4` returns `code=3`, stdout `rtk ls -la ...`, and empty stderr for a valid `ls`
rewrite. `RtkRuntimeService` only accepts `code=3` when stderr contains `No hook installed`, so it
logs `[RtkRuntimeService] RTK execution failed` with the valid rewritten command as the failure
message.

## Design

- Add a conservative parser for rewritten stdout that only accepts commands whose first token is
  `rtk` or `rtk.exe`.
- Treat `code=3` with valid rewritten stdout as a successful rewrite, with or without the old
  `No hook installed` stderr.
- Keep `code=1` as bypass and other invalid outputs as failures.

## Validation

- Add focused Vitest coverage for `code=3` with stdout and empty stderr.
- Run the RTK runtime service test suite.
