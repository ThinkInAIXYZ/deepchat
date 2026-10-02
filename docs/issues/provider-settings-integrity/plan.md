# Execution

- [x] Revalidate findings against current source, callers, storage and rendered UI.
- [x] Preserve custom models/configuration on failed edits; protect model identity/status.
- [x] Preserve VoiceAI updates and report failed saves.
- [x] Correct provider health invalidation and preserve explicit provider ordering.
- [x] Repair onboarding targets/readiness and failed model-toggle outcomes.
- [x] Separate test/enable and save/probe; provide explicit credential removal.
- [x] Remove ineffective Vertex controls and expose required connection fields.
- [x] Fit model actions at supported sizes, expose filtered batches and localize copy.
- [x] Review and ablate each slice, commit independently, then run combined quality gates.
- [x] Inspect actual rendered states and prepare reviewed commits for the authorized push.

Remote delivery and CI results are recorded on PR #2386 after pushing this tracker.

## Evidence and decisions

Baseline: fix/provider-connection-save, 001691a8; PR #2386 is open against dev.
The previous review's claim that configured/health metadata failures duplicate creation was
retracted: those metadata writers already catch their failures. It is not a repair target.
The current request authorizes the previously identified lifecycle improvements as well as bugs.

Integration checks caught and resolved three additional failures: the atomic model-save response
needed a default group; wrapping batch controls could not fit in fixed-height virtual rows; and
opening a newly saved provider before its state arrived accidentally triggered model discovery.
Passive discovery now requires a known enabled provider; explicit refresh remains available.

Simplification removed the automatic reorder path, ineffective Vertex endpoint-mode selector,
duplicate Vertex verification control, and virtual-list action/sticky-header machinery. The
onboarding readiness helper replaces repeated checks across four consumers. No new dependency,
service or generic settings framework was introduced. Guard-removal experiments demonstrated
the need for transaction rollback, legacy-status tombstones, VoiceAI partial-update merging,
connection fingerprint fields and filtered batch scoping. The unknown-provider discovery test
failed on the previous default before passing on the corrected condition.

Validation: the provider/settings/sync main-process slice (962 tests) and the full renderer suite
(2,624 tests) passed. The three Electron scenarios passed three consecutive runs (9 passes),
using fake keys and disposable
profiles. Build/typecheck, format, lint, 23-locale i18n validation, icons and renderer architecture
checks passed. Screenshots were inspected at normal and compact sizes, including retained drafts,
failed saves, key-removal confirmation, filtered actions and visible Vertex connection fields.
