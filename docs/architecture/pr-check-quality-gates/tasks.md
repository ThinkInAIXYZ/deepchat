# PR Check Quality Gates — Tasks

> Requirements are defined in [spec.md](./spec.md), and the implementation design is described in
> [plan.md](./plan.md).

## Architecture Record

- [x] Define the quality-gate responsibilities and always-on topology.
- [x] Define one-shot test command and Native ABI ownership contracts.
- [x] Define fail-closed aggregate semantics.
- [x] Record deferred caching, filtering, sharding, and branch-protection work.
- [x] Record the decision not to create or sync a GitHub issue.

## Light OCR Compatibility

- [x] Limit only actual OCR candidates to eight images.
- [x] Preserve unrestricted image representation for vision-routed attachments.
- [x] Add pure-vision and mixed vision/OCR boundary tests.
- [x] Update the retained Light OCR compatibility documentation.

## Test Entrypoints

- [x] Make default, main, renderer, and coverage commands explicitly one-shot.
- [x] Preserve the explicit watch command.
- [x] Remove the obsolete local Native SQLite entrypoint.
- [x] Repair the Windows ARM64 Native Memory test path.
- [x] Update test documentation.
- [x] Add a static entrypoint and workflow-path contract test.

## PR Workflow

- [x] Add read-only permissions, PR concurrency cancellation, and job timeouts.
- [x] Split static, main, renderer, Native Memory, and build responsibilities.
- [x] Remove the single-element matrix, ineffective Sharp step, redundant Agent evaluation, and
  duplicated Memory scope step.
- [x] Add a fail-closed `pr-required` aggregate job.
- [x] Add the parsed-YAML workflow contract test.
- [x] Update maintained Native Memory architecture references to the new job name.

## Validation

- [x] Run focused Light OCR routing tests.
- [x] Run the entrypoint contract tests.
- [x] Run the workflow contract tests.
- [x] Run default, main, and renderer test commands.
- [x] Run portable Memory tests without a local Node ABI rebuild.
- [x] Run format, localization, lint, architecture, icon, and type checks.
- [x] Run the canonical build and review generated registry changes.
- [ ] Verify Native Memory and Windows ARM64 workflows after a future push.
