# Windows Agent Command Shell Tasks

## Specification

- [x] Define the feature as a command-interpreter contract rather than terminal selection.
- [x] Define the closed profile, dialect, path-style, and device-local configuration models.
- [x] Preserve Auto and POSIX compatibility boundaries.
- [x] Define delayed approval identity, fail-closed behavior, and one-shot revocation.
- [x] Exclude PowerShell 7 auto-selection and WSL from the first phase.
- [x] Define automated and Windows manual-validation requirements.

## Configuration And Resolution

- [x] Add shared schemas and the command-shell resolver.
- [x] Add atomic settings routes, renderer client support, and Git Bash availability checks.
- [x] Add the Windows common-settings UI and translations.
- [x] Exclude the setting from backup and preserve it on import.
- [x] Add focused resolver, settings, UI, and backup tests.

## Turn And Execution Propagation

- [x] Resolve one immutable spec before prompt assembly.
- [x] Generate profile-specific system-prompt guidance.
- [x] Carry the spec through LoopRun, tool options, precheck, and deferred execution.
- [x] Require the spec in background execution RPC and remove utility-side selection.
- [x] Use the spec in managed and detached spawn paths with hidden Windows windows.
- [x] Add focused prompt, propagation, RPC, and spawn tests.

## Permission, Paths, And Skills

- [x] Make command permission parsing and risk analysis dialect-aware.
- [x] Namespace command authorizations by profile.
- [x] Persist profile identity in pending interactions and remove signature fallbacks.
- [x] Fail closed for legacy or malformed pending command approvals.
- [x] Revoke the exact one-shot grant after pre-dispatch failure.
- [x] Convert supported Git Bash paths before filesystem authorization checks.
- [x] Enable Windows shell skills only for Git Bash and use dialect-aware quoting.
- [x] Add focused permission, deferred execution, path, and skill tests.

## Validation

- [x] Run all focused main and renderer tests.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [ ] Complete the Windows manual-validation matrix or document the remaining external validation.
