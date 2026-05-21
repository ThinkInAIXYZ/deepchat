# Windows ARM64 Support Tasks

- [x] Add SDD spec, plan, and task tracking.
- [x] Verify Windows ARM64 runtime artifact availability.
- [x] Wire `installRuntime:win:arm64` to explicit `uv`, `node`, and `ripgrep` installation.
- [x] Add CI E2E support for non-provider smoke tests.
- [x] Keep E2E on the default runner profile.
- [x] Add packaged executable process smoke.
- [x] Split interactive E2E from packaged executable process smoke.
- [x] Add Windows ARM64 manual GitHub Actions workflow.
- [x] Enable Windows ARM64 in the manual build workflow.
- [x] Limit Windows ARM64 E2E artifacts to diagnostics.
- [x] Upload app logs, event logs, and native module inventory for Windows ARM64 failures.
- [x] Attach main-process logs directly to E2E test results.
- [x] Upgrade `sharp` to a version with Windows ARM64 optional dependency support.
- [x] Add targeted unit coverage for runtime fallback paths.
- [ ] Enable Windows ARM64 in the release workflow after the manual workflow passes on GitHub.
