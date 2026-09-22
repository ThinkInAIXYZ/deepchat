# Runtime artifact catalog execution

See [spec.md](spec.md) for scope and compatibility constraints.

## 1. Managed artifact facts

- [x] Move Node/uv archive metadata into the existing manifest and consume it in the TS catalog.
- [x] Verify all twelve old/new artifact results, unsupported targets and checksum separation.
- [x] Review P0–P3 findings, fix demonstrated defects, run negative mutations and commit this slice.

Validation: 100 focused tests passed and Node typecheck passed. An in-memory differential probe
confirmed all twelve artifact outputs match the baseline. Review found a P2 loss of pin-to-artifact
binding; `artifactVersions` restores it. Removing the version guard reproduced both Node and uv pin
drift, and substituting the executable hash failed the differential oracle. No probe files retained.

## 2. Installer and delivery contracts

- [x] Derive installer targets from the manifest while retaining legacy schema compatibility.
- [x] Add a contract for manifest, package/OCR targets and all four workflow matrices.
- [x] Review the full branch, resolve findings and run ablation checks.
- [x] Run format, i18n, lint, typecheck and relevant tests; record unavailable platform validation.
- [x] Remove temporary probes, commit the second slice, and leave the branch unpushed.

Validation: 161 tests across 14 relevant files passed (toolchains, installer, runtime delivery,
afterPack, package contract and OCR runtime asset resolution). Repository format, format check,
i18n, lint, both typechecks and the normal build passed. The built main bundle contains the
manifest archive metadata and version guard; no additional runtime file loader is required.

Actual temporary-root macOS ARM64 installs passed for uv/uvx 0.9.18 and Node v24.18.0, including
the installer's executable checksum, companion completeness and version verification. Temporary
installation roots were removed. Windows ARM64 default and Linux explicit-Node CLI dry runs
retained their expected commands.

Ablation: removing pin binding and exact target-pair validation caused exactly three regression
tests to fail (Node pin, uv pin, missing Windows ARM64 pair); restoring them returned the relevant
suite to 161 passing tests. Final architecture and four adversarial review passes found no remaining
P0–P3 issues. Actual Windows/Linux packages and six-platform offline OCR smoke were not run locally;
they remain platform-CI verification, not evidence supplied by the matrix contract tests.
