# Runtime artifact catalog

## Decision

Keep runtime artifact facts in `resources/runtime-versions.json`. Managed Node/uv downloads,
the build-time installer and OCR packaging consume that manifest through their existing adapters.
Do not introduce a shared runtime service or change toolchain source selection.

The original PR5 proposal overestimated duplication: version pins and OCR native package names
already have one source, and the installer delegates archive selection to tiny-runtime-injector.
The remaining application-owned duplicate is the Node/uv archive table in `catalog.ts`.

## Contract

- Extend `nodeArtifacts[target]` with `filename` and `archiveSha256`; retain
  `executableSha256`. Add `uvArtifacts[target]` with `filename` and `archiveSha256`.
- Keep schema version 3. These are additive fields, not a change to the OCR manifest schema.
  The installer continues reading historical v2/v3 executable-only manifests. Managed downloads
  require archive metadata from the compiled-in current manifest and fail closed when absent.
- Version pins remain `node` and `uv`. URLs retain their official upstream bases and mirror rules.
- `artifactVersions` records the release each archive table was verified against, not a second
  selectable pin. Resolution rejects a mismatch with the selected pin before any network access.
  Update a pin, its artifact version and all target metadata together; this retains the old
  version-keyed catalog's fail-closed behavior, including uv's versionless filenames.
- Node and uv artifact targets must match the six package targets and OCR native package targets.
  Workflow coverage is checked against the existing package contract, without generating YAML.
- The installer derives supported platform/architecture sets from manifest Node targets and checks
  the exact target pair. Default installation remains uv + RTK (uv only on Windows ARM64).
  Explicit Node installation remains available. The RTK exception is installer policy, not a new
  managed toolchain capability.
- Archive checksums verify compressed downloads; executable checksums verify installed Node.
  They are not interchangeable. Extraction, activation and persistence are unchanged.

## Ownership and data flow

```text
runtime-versions.json
  ├── toolchains/catalog.ts → managed downloader
  ├── install-runtime.mjs → tiny-runtime-injector → executable verification
  └── afterPack.js → OCR package selection / executable verification

Vitest contract → manifest targets ↔ package contract ↔ workflow matrices
```

## Non-goals

No new commands, dependencies, settings, services or external credentials. No changes to RTK,
OCR, CUA or DuckDB lifecycles, user toolchain state, CI runners, download implementations or pins.
Do not replace tiny-runtime-injector merely to share a table: that would change installation,
extraction and mirror behavior far beyond this refactor.

## Acceptance and rollback

All twelve managed artifacts retain their version, filename, URL and archive checksum. Unknown
targets and incomplete archive metadata must fail before download. Installer defaults, explicit
Node plans and executable verification remain compatible. The four packaging workflow matrices,
package target definitions and OCR native target map must agree, including Windows ARM64.

Run focused toolchain, installer, packaging and OCR tests plus repository quality gates. Negative
mutations must demonstrate that target omissions and checksum-layer confusion are detected.
Actual non-host package/offline smoke remains a CI validation layer, not something target-table
tests prove. Reverting the commits restores the old catalog without a data migration.

## Open questions

None blocking implementation.
