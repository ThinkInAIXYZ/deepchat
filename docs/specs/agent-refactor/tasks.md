# Agent Refactor Tasks

- [x] Add default self-based `explorer`, `implementer`, and `reviewer` subagent slots.
- [x] Enable subagents by default for DeepChat configs unless explicitly disabled.
- [x] Update DeepChat agent settings defaults to use the new slot set.
- [x] Compose one system prompt with stable section ordering.
- [x] Add permission and verification policy prompt sections.
- [x] Add a session tool-profile cache in the main runtime.
- [x] Parallelize all-read-only canonical Agent tool batches.
- [x] Keep mixed or mutating tool batches serialized.
- [x] Document the tool-result envelope before implementation.
- [x] Add UI labeling for weak legacy-only tool-calling models.
- [x] Implement the tool-result envelope after protocol review.
- [x] Extend background subagent lifecycle operations.
