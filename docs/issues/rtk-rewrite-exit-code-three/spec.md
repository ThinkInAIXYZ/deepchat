# RTK Rewrite Exit Code Three

## Summary

`rtk rewrite` can return exit code `3` with a valid rewritten command on stdout and no stderr. The
runtime service must treat that output as a successful rewrite instead of logging an execution
failure and bypassing RTK.

## User Story

As an agent user, I can run commands such as `ls -la /path` with RTK enabled without seeing false
RTK runtime failure logs when RTK returns a valid rewritten command.

## Acceptance Criteria

- `rtk rewrite` result `code=3`, non-empty stdout, and empty stderr is accepted when stdout is an
  `rtk` command.
- Existing `code=3` behavior with `No hook installed` remains accepted.
- Unsupported rewrite failures without a valid `rtk` stdout command still fall back without marking
  the command as rewritten.

## Non-Goals

- Changing RTK health-check runtime resolution.
- Changing shell execution, permissions, or fallback command execution.
