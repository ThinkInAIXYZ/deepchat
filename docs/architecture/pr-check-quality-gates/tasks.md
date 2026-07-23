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

- [ ] Make default, main, renderer, and coverage commands explicitly one-shot.
- [ ] Preserve the explicit watch command.
- [ ] Remove the obsolete local Native SQLite entrypoint.
- [ ] Repair the Windows ARM64 Native Memory test path.
- [ ] Update test documentation.
- [ ] Add a static entrypoint and workflow-path contract test.

## PR Workflow

- [ ] Add read-only permissions, PR concurrency cancellation, and job timeouts.
- [ ] Split static, main, renderer, Native Memory, and build responsibilities.
- [ ] Remove the single-element matrix, ineffective Sharp step, redundant Agent evaluation, and
  duplicated Memory scope step.
- [ ] Add a fail-closed `pr-required` aggregate job.
- [ ] Add the parsed-YAML workflow contract test.
- [ ] Update maintained Native Memory architecture references to the new job name.

## Validation

- [x] Run focused Light OCR routing tests.
- [ ] Run entrypoint and workflow contract tests.
- [ ] Run default, main, and renderer test commands.
- [ ] Run portable Memory tests without a local Node ABI rebuild.
- [ ] Run format, localization, lint, architecture, icon, and type checks.
- [ ] Run the canonical build and review generated registry changes.
- [ ] Verify Native Memory and Windows ARM64 workflows after a future push.
