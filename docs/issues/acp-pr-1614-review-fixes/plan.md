# Implementation Plan

## Change

- Update ACP process cwd resolution and initialization timeout cleanup in place.
- Harden ACP session cleanup paths with guarded cleanup and original-error rethrowing.
- Await ACP turn persistence in `AcpProvider.runPrompt`, using small helper methods to keep error handling explicit.
- Replace the duplicated ACP event union with the shared contract plus provider-only tool event variants.
- Update the reviewed locale entries for the lifecycle event kind.

## Validation

- Add focused test coverage for relative terminal cwd resolution.
- Run focused ACP tests where changed.
- Run repository-required `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`, plus
  `pnpm run typecheck`.
