# Provider configuration convergence plan

- [x] Centralize default reset URLs at the existing default-provider projection; reuse it in
  Ollama. Review P0–P3, remove unnecessary layers, verify and commit this slice.
- [x] Derive catalog membership from registry strategies for runtime/model facts and renderer
  metadata. Preserve specialized refresh semantics. Review, ablate, verify and commit.
- [x] Restore Fireworks using confirmed transport/discovery contracts and protect the complete
  default-provider instantiation boundary. Review, ablate, verify and commit.
- [x] Review the full branch, run format/i18n/lint/typecheck and relevant suites, update maintained
  contracts and record verification. Leave local commits unpushed.

Implementation precedes new regression tests. Ablation means trying the smaller alternative
against the relevant contract, retaining complexity only when its removal loses behavior.

## Default URL slice verification

- All 75 exported default DTOs compare exactly equal to the pre-change revision.
- Removing override support in an in-memory variant changes Vertex, MiniMax and Azure; retain
  the existing override expression. No new reset helper, schema or IPC route was needed.
- DOM tests cover delayed defaults, built-in/custom Ollama reset and no implicit user URL write.
- Focused main tests: 15 passed. Renderer tests: 23 passed.
- Format, i18n, lint and both typechecks passed. P0–P3 self-review found no unresolved defect.

## Catalog slice verification

- Compared old/new membership over every registered profile: only the three Xiaomi token plans
  change. Removing specialized source handling loses Kimi/Codex, so retain those strategies.
- Removed the redundant renderer computed wrapper and store type assertion; inferred route
  types and direct prop consumption pass the same checks. No new route or persisted field.
- Focused main tests: 50 passed. Renderer tests: 37 passed. Both typechecks passed.
- P0–P3 self-review covered failure propagation, background single-flight, Codex exclusion,
  transport/profile separation and model-fact mutation. No unresolved findings.

## Fireworks and final verification

- Reused the existing OpenAI-compatible transport and `fireworks-ai` catalog. No new SDK,
  provider class, route or storage migration. The real instance manager covers all 75 defaults.
- Request tests exercise the actual AI SDK against mocked HTTP and check endpoint, Bearer auth,
  full model ID, missing/invalid keys and preservation of saved URLs and custom proxies.
- Ablation removed legacy URL normalization: both old official URL cases failed because `/v1`
  was missing; already-versioned and custom-proxy cases passed. Restored the necessary handling.
- Format, i18n, lint and both typechecks passed. All 72 provider test files passed (856 tests),
  plus six relevant renderer test files (52 tests). Renderer changes were checked through DOM
  interactions; no layout or styling changed.
- Final P0–P3 self-review found no unresolved defect. Maintained runtime contracts and the
  add-provider workflow now reference registry-derived catalog membership.
- No live API-key or paid Fireworks inference request was made; upstream availability and
  account entitlement remain outside local verification. No push or remote PR was performed.
