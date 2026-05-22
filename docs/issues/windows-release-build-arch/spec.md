# Windows Release Build Architecture

## User Story

Maintainers need Windows CI and release jobs to build separate x64 and arm64 packages while keeping GitHub Actions job names concise and stable.

## Acceptance Criteria

- Windows build jobs display as one x64 job and one arm64 job, without extra matrix metadata in the job name.
- Windows x64 build jobs no longer use the moving `windows-latest` runner label.
- Release builds include Windows arm64 artifacts alongside Windows x64 artifacts.
- Bundled plugin verification uses the correct unpacked output directory for each Windows architecture.

## Non-goals

- Do not change release version metadata.
- Do not remove existing macOS or Linux release behavior.
- Do not change installer naming.

## Constraints

- Keep workflow changes minimal.
- Preserve existing Windows x64 behavior except for the explicit runner label.
- Use the existing `windows-11-arm` runner for Windows arm64.
