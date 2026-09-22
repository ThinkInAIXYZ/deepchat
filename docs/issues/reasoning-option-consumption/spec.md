# Reasoning option consumption

Issue: https://github.com/ThinkInAIXYZ/deepchat/issues/2339

## Problem and ownership

PublicProviderConf supplies effort tiers through `reasoning_options`, but both catalog importers
omit that field. Gemini level portraits survive import but are excluded from the model settings
and chat selectors and from session capability checks. The Grok request mapper additionally
restricts effort to the Grok Mini family.

The catalog import boundary owns compatibility with upstream metadata. Shared portrait helpers
own selectable tiers and validation. Main-process capability snapshots own defaults and session
support. Existing renderer selectors consume these facts; the AI SDK adapter owns wire encoding.

## Design and invariants

- Convert valid upstream effort values into missing `extra_capabilities.reasoning.effort_options`
  in both build-time and runtime ingestion. Explicit portrait options take precedence. Preserve
  level, budget, fixed, toggle, default, and continuation behavior; do not invent tiers or defaults.
- Version sanitized catalog caches so the first refresh after upgrade bypasses the old ETag;
  subsequent refreshes retain conditional requests. Preserve usable cached data on fetch failure.
- Share selectable-tier calculation between the model dialog, chat selector, and main process.
  Level portraits use their own `level_options` and `level` default, while retaining `mode: level`.
- Reuse the persisted `reasoningEffort` field for supported level values. Validate selections
  against the corresponding portrait, including after model switching and session restoration.
- Send Grok effort when its portrait declares supported tiers, retaining the legacy Mini fallback
  and protection for unsupported Grok models. Mark Grok Responses requests as reasoning-capable
  for the OpenAI SDK so serialization retains the effort without requesting an extra summary.
- Reuse Google/Vertex `thinkingConfig.thinkingLevel`. Do not send a stale thinking budget alongside
  a level selection. No database migration, IPC expansion, dependency, or new UI control is needed.

## User behavior

Both existing selectors offer the actual catalog tiers. Selecting a tier survives saving,
reopening a session, and generation. Toggle-only and fixed models acquire no fictitious tiers.

```text
BEFORE  GLM-5.3  Reasoning [On]
AFTER   GLM-5.3  Reasoning [On]  Effort [low / high / max]

BEFORE  Gemini 3 Flash  Reasoning [Enabled]
AFTER   Gemini 3 Flash  Reasoning [Enabled]  Level [minimal / low / medium / high]
```

## Implementation and validation

- [x] Normalize upstream options in both catalog importers.
- [x] Connect shared effort/level selection, defaults, and session validation.
- [x] Correct Grok mapping and preserve Google/Vertex level wire behavior.
- [x] Verify import compatibility, persistence, both UI consumers, and serialized requests.
- [x] Run formatting, i18n, lint, typecheck, and relevant tests.

Authenticated provider requests and desktop manual acceptance are separate from local request-body
capture tests. Manual acceptance covers the issue's GLM, DeepSeek, Grok, and Gemini models, plus
existing effort, budget, and fixed models.


## Verification results

- 305 tests passed across 13 relevant main-process and renderer suites, including both catalog
  importers, legacy cache recovery, model defaults, saved session levels, both selectors, and
  captured Chat Completions, Responses, Google, and Vertex request bodies.
- Formatting, i18n validation, lint, and main/renderer type checks passed.
- Production build passed. Normal prebuild provider and ACP registry refreshes are retained.
- Authenticated live-provider responses and desktop manual acceptance have not been executed.

## Manual acceptance

1. Run this branch with `pnpm dev` or install its build. In Settings → Data, use Update model
   configuration → Update now. Existing installs must obtain a fresh catalog once; subsequent
   updates may correctly report that the catalog is current.
2. Open Provider → Model settings and then the chat reasoning selector. Verify these choices:

   | Model | Choices |
   | --- | --- |
   | GLM-5.2 | high, max |
   | GLM-5.3 / GLM-5.3-flash | low, high, max |
   | deepseek-flash | low, high, max |
   | Grok 4.5 | low, medium, high |
   | Grok 4.6 | low, medium, high, xhigh |
   | Gemini 3 Flash Preview | minimal, low, medium, high |

3. Save a non-default model choice, reopen model settings, and create a chat to check the default.
   Change the chat choice, send a message, switch away and back, and restart the application.
   The saved session choice must remain selected. Switching models must not retain an unsupported
   choice; Gemini must not expose a budget input for a level portrait.
4. Before sending, enable Settings → General → Trace calls. Use the assistant message toolbar's
   View request parameters action, then inspect Request. For a selected value `low`, verify
   `reasoning_effort: "low"` for Chat Completions, `reasoning: { effort: "low" }` for Grok Responses,
   or `generationConfig.thinkingConfig.thinkingLevel: "low"` for Gemini/Vertex. Level requests must
   omit `thinkingBudget`. Choose `high` instead when testing GLM-5.2.
5. Check an existing GPT/Claude effort model, a Gemini budget model, and fixed/toggle-only models:
   existing controls remain usable, and fixed/toggle-only models gain no invented effort list.
   Confirm no unsupported-parameter errors with the configured provider credentials.
