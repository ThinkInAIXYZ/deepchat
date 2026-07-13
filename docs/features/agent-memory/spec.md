# Agent Memory & Persona — Maintained Feature Contract

> Status: implemented and retained as the user-facing feature contract.
> Current runtime, storage, privacy, performance, and lifecycle details are canonical in
> [Agent Memory System](../../architecture/agent-memory-system/spec.md) and
> [Memory Integration](../../architecture/agent-system-layered-runtime/modules/memory-integration.md).

## User Need

Long-running collaboration should not require users to repeat stable preferences and useful facts in
every new session. Users also need to see, control, and delete what a DeepChat agent remembers.

Agent Memory provides opt-in long-term memory scoped to one DeepChat agent. Persona evolution is a
separate opt-in capability built on the same memory data; it never rewrites the user's configured
system prompt.

## Product Contract

- Long-term memory is disabled by default and can be enabled per DeepChat agent.
- Memory is isolated by agent identity. One agent's remembered data is never injected into another
  agent's prompt.
- The prompt path contributes a sanitized, read-only, hard-budgeted memory section through the
  awaited `MemoryPromptContributor` seam. Disabled or failed contribution is fail-open and leaves
  the rest of the prompt unchanged.
- Background ingestion is serialized and fenced outside the interactive hot path. It does not delay
  the terminal turn response.
- Retrieval combines the maintained lexical and vector paths and degrades safely when embedding is
  unavailable or unhealthy.
- Users can inspect remembered items, provenance, status, persona history, and health information in
  the Memory settings surface.
- Users can remember, recall, forget, edit, delete, clear, and retry supported memory operations
  through the maintained UI and agent-tool boundaries.
- Persona evolution requires both Memory and the separate persona-evolution opt-in. Generated persona
  records remain reviewable and reversible, and the configured system prompt remains authoritative.
- Semantic Tape anchors record memory views and extraction provenance without becoming context
  reconstruction anchors.
- Stored content remains in the application SQLite database and follows its configured encryption
  boundary; no separate plaintext Memory content file is added. The DuckDB sidecar stores vector
  data under the maintained embedding identity and lifecycle rules.

## User Stories And Acceptance Criteria

### US-1: Cross-session recall

As a user of one agent, I want stable preferences and useful facts from earlier work to be available
in a later session.

- AC-1.1: An eligible fact committed in session A can be recalled for a relevant request in a new
  session B owned by the same agent.
- AC-1.2: Memory written for agent X is not returned or contributed for agent Y.
- AC-1.3: When Memory is disabled, automatic contribution and ingestion perform no user-content
  write and the prompt remains otherwise unchanged.

### US-2: Responsive and failure-tolerant interaction

As a user, I want Memory to improve continuity without making normal turns noticeably slower or
fragile.

- AC-2.1: Memory does not change the compaction summary prompt or output contract.
- AC-2.2: Prompt contribution is awaited but bounded and fail-open; retrieval failure cannot fail the
  whole turn.
- AC-2.3: Extraction and embedding work run in the background, use cursor/provenance idempotency, and
  do not block the terminal turn path.
- AC-2.4: Session rewind, clear, delete, agent deletion, disable, and app shutdown fence stale work so
  it cannot commit into a newer lineage or a closed database.

### US-3: Controlled persona evolution

As a user, I want an agent to develop a useful working style while my explicit instructions remain
in control.

- AC-3.1: Persona evolution never edits or replaces `DeepChatAgentConfig.systemPrompt`.
- AC-3.2: Persona changes preserve version/provenance history and support the maintained rollback
  operation.
- AC-3.3: Disabling persona evolution prevents automatic persona mutation without disabling ordinary
  Memory when Memory itself remains enabled.

### US-4: Relevant and explainable recall

As a user, I want relevant memories rather than an unbounded dump of historical content.

- AC-4.1: The final context assembler enforces the configured hard budget and prioritizes maintained
  persona, working-memory, recalled-memory, and episodic sections according to the current contract.
- AC-4.2: Lexical recall remains available when vector recall is unavailable; vector identity or
  dimension mismatch fails closed to the maintained fallback instead of returning incompatible
  vectors.
- AC-4.3: Remembered items retain source and audit provenance that the management UI can display
  without exposing hidden reasoning as durable memory content.

### US-5: Privacy and user control

As a user, I want to know and control what an agent remembers.

- AC-5.1: Memory and persona evolution are explicit per-agent settings and default to disabled.
- AC-5.2: The UI supports paged inspection, single-item mutation, clear, persona history, and
  operational health without loading an unbounded agent history.
- AC-5.3: Forget/delete/clear operations prevent affected content from future recall and invalidate
  stale in-flight work.
- AC-5.4: Automatic extraction excludes assistant reasoning content and stores only the eligible
  user-visible span defined by the current privacy contract.
- AC-5.5: Provider credentials, raw prompts, and raw model responses do not enter content-free
  operational audit records.

### US-6: Observable but non-interfering lifecycle

As a maintainer, I need Memory activity to be observable without changing Tape reconstruction or
agent behavior.

- AC-6.1: Prompt contribution can record the maintained `memory/view_assembled` manifest anchor.
- AC-6.2: Successful ingestion can record the maintained `memory/extract` anchor with provenance.
- AC-6.3: Memory anchors remain outside reconstruction-anchor selection and do not change the
  effective conversation view.
- AC-6.4: Shutdown reports a typed bounded-drain outcome and fences late writes even when background
  work does not settle before the timeout.

## Non-Goals

- Cross-agent memory sharing or implicit global user profiles.
- Replacing the user's system prompt with a generated persona.
- Persisting hidden chain-of-thought as long-term memory.
- Running extraction on every streamed token or turning Memory into a synchronous tool-loop stage.
- Using Memory as a second transcript, event store, or Tape reconstruction source.
- Export/import or multi-user relationship partitioning beyond the currently maintained scope.
- Duplicating Memory storage, retrieval, or maintenance logic inside `AgentManager`,
  `DeepChatAgentInstance`, or `LoopEngine`.

## Maintained Boundaries

- `MemoryPresenter` owns Memory data, retrieval, writes, vectors, maintenance, and management APIs.
- `MemoryRuntimeCoordinator` owns DeepChat runtime queues, epochs, cursor orchestration, prompt
  contribution, ingestion observation, and shutdown admission fencing.
- A `DeepChatAgentInstance` keeps only a stable session handle for Memory collaboration.
- Exact trigger matrices, schema identifiers, operation fences, budgets, performance gates, and
  recovery behavior belong to the linked architecture documents and their tests rather than being
  duplicated here.
