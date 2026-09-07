# Windows Agent Command Shell Plan

## Approach

Introduce one typed command-shell domain shared by the main process and RPC contracts. Resolve a
preference into an immutable `ResolvedCommandShell` before prompt assembly, then carry that value
through every execution consumer. Keep preference resolution in the main process and make the
utility process a strict executor of the supplied spec.

Implementation is divided into reviewable slices so that configuration and prompt behavior land
before the deeper authorization and execution changes.

## Shared Domain And Resolver

1. Add shared closed types and schemas for configuration, profiles, dialects, path styles, and the
   serializable resolved spec.
2. Replace direct Windows `getUserShell()` consumption in agent execution with a resolver that:
   - preserves the current Auto branch;
   - resolves explicit Windows PowerShell without fallback;
   - discovers and validates Git Bash asynchronously;
   - wraps current POSIX `$SHELL -c` behavior without changing it;
   - can resolve a stored profile independently of the current preference for deferred execution.
   Git Bash validation checks both GNU Bash identity and MSYS path semantics so WSL/Cygwin do not
   enter the profile through an override. The complete candidate search shares one monotonic
   deadline so damaged installations cannot multiply the per-process timeout across every path.
3. Cache successful Git Bash validation in memory by canonical path and effective configuration.
   Briefly cache failed discovery and validation so repeated turn preparation does not rerun the
   complete bounded search; invalidate both caches on settings changes and explicit refresh without
   persisting discovery results.
4. Keep bootstrap-environment behavior compatible. Git Bash-specific environment adjustments are
   added only if Windows validation demonstrates a requirement.

## Settings And Discovery

1. Store `agentCommandShell` as one settings value with a default `auto` preference.
2. Extend the typed settings route and renderer client with validated reads and atomic updates.
3. Add a typed asynchronous availability route for effective Git Bash discovery and validation.
4. Add a Windows-only common-settings section using existing select, input, status, and file-picker
   primitives with vue-i18n copy.
5. Generalize the sync exclusion list to machine-local application settings, remove the setting
   from exported backups, and preserve the receiving setting during import.

## Turn And Prompt Data Flow

```text
device setting
     |
     v
command-shell resolver ---- stored profile for deferred execution
     |
     v
ResolvedCommandShell (once per turn)
     |
     +--> base prompt assembly
     +--> LoopRunResources
             |
             +--> ToolCallOptions / precheck
             +--> permission analysis and path conversion
             +--> skill execution
             +--> background exec RPC --> utility spawn
```

1. Resolve the shell in `TurnCoordinator.prepareTurnResources` before system-prompt assembly.
2. Add the spec to base-prompt input and derive the environment shell guidance from it.
3. Add the same object to `LoopRunResources` and construct `ToolCallOptions` from that resource in
   both normal and deferred execution.
4. Require the spec in background-exec start RPC messages and use it directly at managed and
   detached spawn points. Add `windowsHide: true` to Windows-capable shell spawns.

The utility RPC validates the incoming discriminated schema and rejects missing or contradictory
profile fields. It does not call the preference resolver.

## Permission And Deferred Execution

1. Refactor command parsing and risk classification to take an explicit dialect/profile.
2. Namespace the existing signature with `profile` at the command permission boundary.
3. Persist `shellProfile` and the already-namespaced signature in pending interactions.
4. Remove signature reconstruction fallbacks from the interaction coordinator and composition
   approval adapter. Missing fields fail closed with a diagnostic error.
5. For deferred execution, resolve the persisted profile and rebuild `ToolCallOptions` with that
   spec instead of the current preference.
6. Give each in-memory one-shot authorization an ephemeral lease ID and carry it only through the
   approved tool invocation. Permission checks and pre-dispatch cleanup consume or revoke that exact
   lease so concurrent grants with the same session/signature cannot interfere.

Session-scoped approvals, where present, remain namespaced. Conversation cloning keeps its existing
session-only behavior.

## Paths And Skills

1. Thread `pathStyle` into filesystem handler operations and permission prechecks.
2. Normalize supported Git Bash drive paths before path resolution, containment checks, and
   allowed-directory authorization. Reject malformed or unsupported MSYS forms conservatively.
3. Pass the shell spec into skill run options.
4. Permit Windows `runtime: shell` only for Git Bash, and derive shell quoting from dialect.
5. Preserve direct foreground and background executable/script spawning with executable/argv where
   no shell interpretation is needed.
6. Let the bundled POSIX CLI launcher resolve the packaged Windows `node.exe` layout under Git
   Bash.

## Compatibility And Failure Semantics

- Missing settings resolve to `auto`; existing Windows behavior remains the compatibility baseline.
- `auto` keeps using the existing `PSModulePath` proxy and never probes `pwsh`.
- Explicit profile resolution fails visibly and does not silently downgrade.
- Stored invalid settings are normalized to the safe default at the settings boundary, while a
  malformed RPC or pending permission payload is rejected.
- Existing POSIX resolution remains byte-for-byte compatible where practical; its profile records
  the current permission-analysis policy rather than claiming strict interpreter identity.
- Pending command approvals created before this feature cannot prove a shell identity and therefore
  fail closed after upgrade.
- No persisted executable path migration is required because pending approvals store only profile.

## Test Strategy

### Resolver And Settings

- Auto PowerShell/CMD branches and explicit Windows PowerShell.
- Git Bash precedence, executable validation, timeout, override failure, and no fallback.
- POSIX resolver compatibility.
- settings schema/default/atomic update and Windows-only renderer states.
- backup exclusion and import preservation.

### Prompt And Propagation

- exact profile-specific shell guidance for all four profiles.
- one turn spec reaches LoopRun, tool options, managed execution, detached execution, and skills.
- utility RPC rejects a missing or inconsistent spec.

### Permission And Paths

- signature namespaces differ for identical commands under different profiles.
- PowerShell quote/control syntax and destructive command coverage.
- conservative CMD/unknown syntax behavior.
- malformed legacy payload fail-closed behavior.
- settings switch and restart between request and delayed approval.
- exact one-shot lease consumption and revocation on every pre-dispatch failure path, including
  concurrent identical signatures.
- `/c/...` conversion before containment and allowed-directory checks, including traversal and
  unsupported forms.
- bundled CLI launcher resolution under the Windows Git Bash runtime layout.

### Validation

Run the smallest focused Vitest suites after each slice. Before handoff run:

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- all related main and renderer tests

Complete the Windows manual-validation matrix in the spec before claiming packaged Windows
interoperability. Tests on a non-Windows development host do not replace those checks.

## Rollback

The default remains `auto`, so disabling the UI is sufficient to stop new explicit selections.
Source rollback does not require data migration: older versions ignore the unknown device-local
setting. Pending approvals from the new version already fail closed when required metadata is not
understood or available.
