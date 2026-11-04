# Remaining Workflow Validation

The maintained workflow topology and fail-closed gates are in [spec.md](./spec.md).

- [ ] Execute the Windows ARM64 workflow and verify its maintained Native Memory test path on
  that target.

Linux Native Memory, artifact upload, and standalone Node Harness are required PR gates; their
successful runs do not establish Windows ARM64 behavior.
