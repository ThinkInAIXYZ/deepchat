# Browser Website Data and Session Import Tasks

## Status

V1 cookie-backed session import implemented. Packaged macOS/Arc fixture validation and deferred
data categories remain open.

## Completed Discovery

- [x] Trace the current `persist:yo-browser` session ownership and clear-data flow.
- [x] Confirm that Agent and standalone DeepChat browser views share the target session.
- [x] Inspect the current local Chrome Cookies schema without reading or recording secret values.
- [x] Verify current Electron public Session, Cookies, `safeStorage`, View, and CDP constraints.
- [x] Record Chrome App-Bound Encryption and remote-debugging restrictions.
- [x] Evaluate the referenced Chrome 130 `SYSTEM`/hard-coded-key proof of concept and reject its
      App-Bound bypass while retaining only neutral schema and snapshot lessons.
- [x] Separate cookies, `localStorage`, `sessionStorage`, passwords, and non-transferable credentials
      into honest capability categories.
- [x] Write the proposal, implementation plan, risks, acceptance criteria, and decision gates.

## Product Decisions Required Before Implementation

- [x] Keep current Windows Chrome/Arc App-Bound data unsupported; do not build a companion extension
      or privileged/reverse-engineered decryption path.
- [x] Confirm V1 session portability is cookie-backed, subject to feasibility proofs.
- [x] Keep passwords in the roadmap through a separate credential-vault proposal.
- [x] Confirm Arc is labeled experimental until fixture validation passes.
- [x] Keep synchronization explicitly user-triggered, not scheduled/background.
- [x] Require OS/source-browser authorization and prohibit encryption bypasses.
- [x] Decide whether target scope is always the entire global YoBrowser session or may be limited to
      selected domains in a later release.

## Feasibility Gates

- [ ] Build sanitized Chrome cookie fixtures for each supported source schema.
- [ ] Prove consistent SQLite snapshot behavior with Chrome open and closed.
- [ ] Prove packaged macOS Chrome system-owned authorization, key access, decryption, and denial
      handling without DeepChat receiving the authorization password.
- [ ] Prove CDP target set/readback for all supported cookie attributes.
- [ ] Prove partitioned-cookie round trip for the bundled Electron Chromium version.
- [ ] Prove full target-cookie rollback after injected failures.
- [ ] Collect and validate sanitized Arc fixtures on every proposed Arc platform.
- [ ] If `localStorage` remains proposed, prove inactive-origin clear/write/readback before adding it
      to the release scope.

## Phase 1: Main-Process Cookie Core

- [x] Add deterministic known-location browser/profile discovery.
- [x] Add canonical path and source-profile validation.
- [ ] Add a private snapshot workspace with crash/startup cleanup.
- [x] Add the selected Chrome source schema reader.
- [x] Add the selected OS key-access/decryption adapter.
- [x] Ensure protected authorization is rendered by the OS/source browser, never a DeepChat
      password form.
- [x] Add versioned cookie normalization and validation.
- [x] Add stable, redacted error codes.
- [x] Add one target mutation coordinator shared with clear-sandbox data.
- [x] Add target snapshot, clear, batch apply, readback, and normalized comparison for
      non-partitioned cookies.
- [x] Add rollback handling.
- [x] Flush the target cookie store and reload open YoBrowser tabs only after verified success.
- [x] Add unit and main-process integration tests for decryption, replacement, verification, and
      rollback.

## Phase 2: Contracts and Settings UX

- [x] Add shared schemas for scan, preview, and apply.
- [x] Add main routes and client exposure through existing patterns.
- [ ] Extend the YoBrowser settings card with last-sync metadata.
- [x] Add the source/profile/category selection dialog using existing shadcn-vue primitives.
- [x] Add preview counts and capability reasons.
- [x] Add source-authoritative replacement confirmation.
- [ ] Add apply/verify/rollback progress and final result UX.
- [ ] Prevent cancellation after target mutation starts.
- [x] Add accessible labels, keyboard behavior, and i18n strings.
- [ ] Add renderer tests for state, stale tokens, failures, and secret redaction.

## Phase 3: Platform and Release Validation

- [ ] Test signed/notarized application builds on every advertised platform.
- [ ] Test multiple source profiles and browser-running states.
- [ ] Test source schema/version rejection with actionable UI.
- [ ] Test import/clear contention and app shutdown during apply.
- [ ] Test temporary-data removal after success, failure, crash, and restart.
- [ ] Audit logs, telemetry, renderer state, crash reports, and errors for secret leakage.
- [ ] Verify authorization passwords never enter DeepChat IPC, memory fields, logs, or telemetry.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run typecheck, build, focused suites, and the full main/renderer test suite.
- [ ] Update user documentation with the exact support matrix and limitations.

## Deferred, Separately Approved Work

- [ ] Add `localStorage` only after its feasibility gate passes.
- [ ] Design live-tab `sessionStorage` handoff as a separate flow.
- [ ] Write a separate SDD for an origin-bound credential vault if password autofill is approved.
- [ ] Evaluate additional browsers only with explicit discovery, crypto, schema, and fixture support.
