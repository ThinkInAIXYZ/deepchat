# Execution plan

- [x] Replace the inline algorithm with a bundled entry using ToolScanner; share discovery
  comparison without changing public contracts.
- [x] Verify real Worker/fallback parity, built entry loading and existing fallback tests.
- [x] Review the full change for P0–P3 defects; separately fix confirmed scanning defects
  and demonstrate regression tests fail when the fix is removed.
- [x] Run formatting, i18n, lint, typechecks and relevant tests; commit coherent local changes.

No push or GitHub mutation is authorized. This refactor is independently usable and reversible.

## Validation outcome

- Skill and inline-runner suites: 28 files, 571 tests passed. Provider catalog checks: 69 passed.
- Containment ablation: replacing the final realpath check with the original path exposes both
  sibling-folder and outside-root descriptions; the regression fails. Restoring the check passes.
- Format check, i18n, lint, both typechecks and full app/CLI build passed.
- Real electron-vite bundle and Electron ASAR smoke returned non-empty metadata with Date values.
- Review covered security, architecture and four adversarial angles. Fixed the test CLI's Windows
  shim dependency and the pre-existing final-file symlink escape. No remaining confirmed P0–P3
  finding in the change. Windows/Linux runtime and signed installer testing were not performed.
- Normal prebuild Provider DB refresh is retained separately as required by repository guidance.
