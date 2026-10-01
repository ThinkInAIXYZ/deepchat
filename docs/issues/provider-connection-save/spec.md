# Provider connection saving and verification

## Problem and evidence

Replacing a nonempty API key currently validates a transient configuration with the provider's
fixed check model before saving. Alibaba Token Plan returns 403 for `deepseek-v4-flash` with a key
that successfully calls `qwen3.8-flash`. The replacement is rejected, but the input retains the new
key while the model-check dialog uses the old persisted key and returns 401.

The model-check dialog also offers non-chat models even though it always calls text completions.
Catalog refresh is not proof of account authentication or model entitlement.

## Design

Connection editing and remote model verification have separate responsibilities. Existing provider
settings show a read-only connection summary. An Edit connection dialog owns the explicit
Save/Cancel draft for API key and URL. Save commits the pair in one existing atomic provider update
without a remote probe. The dialog shows the masked current key separately from the empty replacement
field; a blank replacement key preserves the stored key.
The persisted configuration is the source of truth; changing it invalidates previously verified
health through the existing configuration fingerprint. Save never asserts successful connectivity.

Verification is unavailable while the connection editor is open or saving. Model refresh belongs
only to the Models section, outside the modal editor.
Persistence errors retain the draft with an inline error. Cancel restores the persisted values.
Switching providers creates a new editor; an in-flight save retains its original provider ID.
Custom-header saving follows the same persistence-versus-verification separation while preserving
its existing local validation. Creation via Connect and load models remains unchanged.

The model-check picker includes text-chat models, including custom models, using the existing
resolved model type. Video/image/audio generation, embedding, rerank and judgment models are not
text probes. Users can select another model after a failed test. Late results from a closed dialog
must not appear in a later check. Remote errors remain errors, not heuristic evidence of success.

No database migration, credential logging, real-account mutation, new service, or provider-specific
fallback loop is introduced. The UI retains the existing settings primitives and visual styling.
Existing OAuth flows remain separate and do not expose an API-key replacement field. Editing a
connection does not change the provider's enablement or run a setup wizard. Test health records the
selected model ID when known and labels success as the last test, not blanket model entitlement.
Older health records without a model ID remain readable.

## Acceptance

- A valid replacement key is saved even if the provider's default probe model is unavailable.
- The subsequent selected-model request uses the saved replacement key and endpoint.
- Dirty, saving, saved/unverified, and save-failure states cannot be mistaken for one another.
- No remote validation runs merely because a connection field loses focus or is saved.
- Cancel and persistence failure do not replace the stored configuration.
- Non-chat models cannot be selected in the text-check dialog.
- Existing custom-provider creation validation is unchanged.

## Implementation and validation

- [x] Separate connection persistence from verification, including custom headers.
- [x] Add explicit atomic connection editing and prevent old-configuration checks.
- [x] Restrict text model checks and allow retry without reopening the dialog.
- [x] Add durable regression coverage and run focused tests.
- [x] Render saved, dirty and model-failure states in an isolated profile; inspect screenshots.
- [x] Run formatting, i18n, lint and type checks; review the final diff.

Validation uses disposable Electron profiles and a local HTTP fixture, not account credentials.
The fixture rejects the old key with 401, rejects the fixed probe model with 403, and accepts the
replacement key on the selected text model. It asserts the actual Authorization header, no model
request during Save, saved/unverified health, non-chat exclusion, custom-model availability and retry.
Renderer tests cover persistence failure, cancellation and late responses. Focused verification:
62 renderer tests, 92 main-process tests and two Electron smoke tests passed; build, formatting,
i18n, lint and type checks passed.

The old source fails the explicit-save and custom-header regression tests. Removing the dialog
result-version check or the store's latest-request check independently reproduces stale-result
failures; removing model-type filtering reintroduces media models into the text picker. These guards
remain. The staged-validation queue and duplicate blur handlers were removed, and a redundant child
component key was dropped because the settings page already keys the provider detail.

## Connection editor follow-up

- [x] Replace inline drafts with a masked summary and a scoped connection dialog.
- [x] Keep refresh in Models and record the model associated with the last test.
- [x] Verify cancel, failed persistence, blank replacement, OAuth and immediate post-save testing.
- [x] Inspect default, editing, failure and compact renders; run quality gates and review.

The follow-up passes 51 renderer tests, 92 main-process tests and two Electron smoke tests, plus
build, type checks, lint, formatting and i18n validation across all 23 localized language packs.
Electron exercises Escape/focus restoration, save without a model request, immediate testing with
the saved key, model-specific health and retained drafts after a rejected persistence IPC call.
Connection summaries and dialogs were inspected at normal size and down to 900×640, including
independent narrow and short window states. The existing model-list toolbar can overflow at the
minimum width; its unrelated layout is unchanged by this connection-editor work.

The dialog reuses the existing primitives and persistence callback. The URL-unlock allowlist,
separate key-editing flag and duplicate refresh path are removed. Two additional ablation runs
confirm that removing the pending-save dismissal guard closes a still-saving dialog, and removing
the blank-key fallback clears the credential during URL-only saves. Both regression tests fail
under the respective mutation and pass with the protections restored.
