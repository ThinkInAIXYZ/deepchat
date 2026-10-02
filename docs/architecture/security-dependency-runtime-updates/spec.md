# Security dependency and runtime updates

## Context and scope

The October 2026 dependency audit identifies vulnerable transitive packages and stale security
overrides. Electron and the managed Node runtime also contain separate copies of Undici that cannot
be replaced by pnpm overrides. Update these components without changing their major release lines,
application data formats, provider contracts, or the app release version.

## Design and ownership

- Resolve brace-expansion 1.x, 2.x, and 5.x to 1.1.21, 2.1.7, and 5.0.12; Undici 6.x and 7.x to
  6.28.1 and 7.29.1; ip-address to 10.7.1. Keep direct Undici 8.10.2.
- Advance existing fast-uri, Hono, and Monaco DOMPurify overrides to 3.1.8, 4.13.7, and 3.4.16.
  Mermaid's independently resolved DOMPurify must also receive 3.4.16.
- Prefer compatible lockfile resolutions over permanent new overrides. Do not migrate parent SDKs
  or flatten different dependency majors to make the audit pass.
- Update Electron to 43.7.0 and the managed/development Node line to 24.21.0. Both include the
  Undici 7.29.1 security fixes. Keep pnpm unchanged.
- `resources/runtime-versions.json` owns runtime artifact identities. Verify all six official Node
  archives against upstream checksums and derive executable hashes from those verified archives.
  Move CI pins, toolchain requirements, and runtime-dependent assertions together.

## Compatibility

The selected npm updates retain existing exports and APIs. Security fixes intentionally change
pathological brace expansion, URI normalization, address classification, and network error handling.
Normal file matching, schema validation, proxying, and rendered-content sanitization must remain
usable. Glob exclusion patterns are a security-sensitive regression surface even when the primary
pattern is bounded.

Glob 13.0.6 embeds stale brace-expansion code in its default minified entry point. The application's
sole glob import must use the public `glob/raw` entry so the patched lockfile resolution takes
effect. There is no newer 13.x release at implementation time. Regression tests cover both nested
and comma-separated adversarial exclusions alongside a valid exclusion and an actual matching file.

Electron 43.7.0 tightens permission attribution and frame isolation. Existing download listeners may
ignore its additional trailing argument. Review MCP App permission handlers, embedded browser
behavior, worker settings, and capture APIs before treating the runtime update as compatible. Do not
weaken permission checks to retain behavior disallowed by the security fixes.

Managed Node and the minimum accepted custom/system Node both move to 24.21.0, while the maximum
remains below 25. Existing custom paths with older Node must be upgraded; OCR still requires the
official pinned artifact and standalone Node ABI 137. Electron's distinct ABI is not this OCR ABI.
Keep the toolchain/OCR version guidance consistent across locales. No database migration is needed.

Upstream compatibility references:

- [Electron 43.7.0 release](https://github.com/electron/electron/releases/tag/v43.7.0)
- [Node 24.21.0 artifacts and checksums](https://nodejs.org/dist/v24.21.0/)
- [Glob's bundled brace-expansion issue](https://github.com/isaacs/node-glob/issues/657)

## Acceptance and rollback

- The current audit has no remaining known advisories in the selected dependency graph.
- Frozen installation, static checks, relevant existing suites, native smoke checks, and Electron
  launch smoke succeed, with any unavailable cross-platform validation stated explicitly.
- Valid glob/include/exclude behavior remains correct, and adversarial nesting no longer exhausts
  the parser stack.
- Runtime manifests, CI versions, archive hashes, and executable hashes agree. The installed
  Electron and Node report patched built-in Undici versions.
- Commit dependency and runtime updates independently. Neither requires a data migration; rollback
  reverts the corresponding commit and restores its frozen dependency/runtime artifacts, but also
  restores the documented security exposure.

## Non-goals

No broad dependency refresh, new infrastructure, automated alert dismissal, release, or remote Git
actions. Existing normal-build provider/ACP registry refreshes remain tracked.
