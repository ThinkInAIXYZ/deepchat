# Provider configuration convergence plan

- [x] Centralize default reset URLs at the existing default-provider projection; reuse it in
  Ollama. Review P0–P3, remove unnecessary layers, verify and commit this slice.
- [ ] Derive catalog membership from registry strategies for runtime/model facts and renderer
  metadata. Preserve specialized refresh semantics. Review, ablate, verify and commit.
- [ ] Restore Fireworks using confirmed transport/discovery contracts and protect the complete
  default-provider instantiation boundary. Review, ablate, verify and commit.
- [ ] Review the full branch, run format/i18n/lint/typecheck and relevant suites, update maintained
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
