# Windows Agent Command Shell Tasks

## Specification

- [x] Define the feature as a command-interpreter contract rather than terminal selection.
- [x] Define the closed profile, dialect, path-style, and device-local configuration models.
- [x] Preserve Auto and POSIX compatibility boundaries.
- [x] Define delayed approval identity, fail-closed behavior, and one-shot revocation.
- [x] Exclude PowerShell 7 auto-selection and WSL from the first phase.
- [x] Define automated and Windows manual-validation requirements.

## Configuration And Resolution

- [ ] Add shared schemas and the command-shell resolver.
- [ ] Add atomic settings routes, renderer client support, and Git Bash availability checks.
- [ ] Add the Windows common-settings UI and translations.
- [ ] Exclude the setting from backup and preserve it on import.
- [ ] Add focused resolver, settings, UI, and backup tests.

## Turn And Execution Propagation

- [ ] Resolve one immutable spec before prompt assembly.
- [ ] Generate profile-specific system-prompt guidance.
- [ ] Carry the spec through LoopRun, tool options, precheck, and deferred execution.
- [ ] Require the spec in background execution RPC and remove utility-side selection.
- [ ] Use the spec in managed and detached spawn paths with hidden Windows windows.
- [ ] Add focused prompt, propagation, RPC, and spawn tests.

## Permission, Paths, And Skills

- [ ] Make command permission parsing and risk analysis dialect-aware.
- [ ] Namespace command authorizations by profile.
- [ ] Persist profile identity in pending interactions and remove signature fallbacks.
- [ ] Fail closed for legacy or malformed pending command approvals.
- [ ] Revoke the exact one-shot grant after pre-dispatch failure.
- [ ] Convert supported Git Bash paths before filesystem authorization checks.
- [ ] Enable Windows shell skills only for Git Bash and use dialect-aware quoting.
- [ ] Add focused permission, deferred execution, path, and skill tests.

## Validation

- [ ] Run all focused main and renderer tests.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Complete the Windows manual-validation matrix or document the remaining external validation.
