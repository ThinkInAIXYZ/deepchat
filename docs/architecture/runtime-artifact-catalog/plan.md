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

- [ ] Derive installer targets from the manifest while retaining legacy schema compatibility.
- [ ] Add a contract for manifest, package/OCR targets and all four workflow matrices.
- [ ] Review the full branch, resolve findings and run ablation checks.
- [ ] Run format, i18n, lint, typecheck and relevant tests; record unavailable platform validation.
- [ ] Remove temporary probes, commit the second slice, and leave the branch unpushed.
