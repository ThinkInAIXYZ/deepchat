# Skill Progressive Disclosure Specification

## Status

Implemented. This specification governs the bounded Skill catalog, deterministic discovery, scoped
activation projection, and Tape-backed Skill context materialization described below.

## User Need

DeepChat already lazy-loads full `SKILL.md` bodies, but it unconditionally places every enabled
Skill's complete frontmatter description in the leading system prompt. Neither one description nor
the complete catalog has a prompt budget. The current `skill_list` tool repeats the same problem by
returning the complete catalog, including arbitrary metadata objects, in one unbounded tool result.

Users need Skills to remain easy to discover without making every first request scale with the
number or verbosity of installed Skills. Selecting or viewing a Skill must also preserve its exact
runtime instructions without duplicating the full body, destabilizing the system-prompt prefix, or
creating content outside Tape's append-only fact lineage.

## Decision

DeepChat will use three progressive-disclosure layers:

1. **Route**: a bounded, deterministic routing catalog in the leading system prompt;
2. **Discover**: bounded local search and cursor pagination through `skill_list`;
3. **Activate**: one effective-content builder whose output is projected according to activation
   scope and backed by the appropriate Tape fact.

`contextCoordinator` remains the only authoritative request-admission gate. The Route budget is a
local invariant on DeepChat-generated catalog metadata, not a second global prompt allocator.

## Domain Model

### Enabled

Application and per-Skill settings determine whether a Skill is visible in Route and Discover.
Enablement does not activate the Skill body.

### Message Skill Reference

A Skill selected through an `@skill` mention or the Skills panel applies to the current execution.
The message stores a bounded Skill reference. Its full effective content is materialized into the
Session Tape and expanded only in the active-turn provider projection. Later history projections
retain a bounded marker, not the instruction body.

The first message of a new Session follows the same message-scoped rule. It must not silently
promote the selection into persistent Session state.

### Runtime Skill View

A model-initiated root `skill_view` returns the full effective content in the tool result and may
activate its tools for the current tool loop only after that exact result is durably recorded.
Supporting-file views remain read-only and do not activate the root Skill.

### Session Active Skill

Existing persistent Session Skill selections remain a compatibility contract. They are rebuilt in
the stable Active Skills system section for every new execution, from Tape-materialized content.
They must be visible and removable to the user, but this increment does not add a new Pin action or
another way to create persistent selections.

Direct ACP compatibility requests retain bounded Route metadata but never project local full
Skill bodies. ACP bypasses DeepChat's materialization and authoritative context-admission path, so
injecting mutable local bodies there would create provider-visible instructions without Tape
authority. ACP-backed subagents retain their existing configured-prompt-only behavior.

## Route Contract

### Canonical Routing Card

Route and Discover share a canonical, whitelisted semantic card:

```ts
interface SkillRoutingCard {
  name: string
  summary: string
  category?: string
  platforms?: string[]
  sessionActive: boolean
}
```

The canonical card never exposes Skill paths, unrestricted frontmatter metadata, script details,
or the complete description. System-prompt text and tool-result JSON use separate renderers so one
wire format does not constrain the other. Route uses only `sessionActive`; Discover may decorate
its JSON card with `activeForExecution` without changing the canonical card or Route bytes.
Catalog-producing parsers enforce the public 255-character Skill-name boundary, and the routing
projection rejects invalid external entries defensively so every accepted name-only card fits.
For model-tool compatibility, Discover temporarily emits deprecated `isPinned`/`active` and
`pinnedCount`/`activeCount` aliases beside the accurately named fields. These aliases carry no
additional state and must remain derived from the canonical values until a later versioned removal.

### Budget

The complete `<available_skills>` catalog block, including its wrapper and omission marker, has an
approximate-token budget:

```text
catalogBudget = min(floor(effectiveContextLength * 0.02), 2,000)
```

The Route budget uses the configured model context window even when an endpoint such as ACP bypasses
DeepChat's local context admission. When that configured window is unknown or invalid, the budget is
2,000 approximate tokens. Descriptions are first capped at 1,024 Unicode code points as a defensive
input bound (and therefore at most 4,096 UTF-8 bytes). Normalization inspects only a bounded source
prefix before applying that output cap. Categories are capped at 128 code points, and at most eight
platform labels of 64 code points each are kept, so no whitelisted auxiliary field can become an
unbounded alternate description. The final bound uses the same `tokenx` approximate-token
estimator used by request preflight.

If the computed budget cannot fit the minimum wrapper and omission marker, the catalog block is
absent. The constant-size usage instructions still direct the model to `skill_list`, and the render
report records every card as omitted, and prompt provenance records `skill_catalog_omitted`. A
zero-token budget therefore never produces an over-budget wrapper.

The fixed, constant-size Skills usage instructions are outside the catalog budget. They remain
bounded independently of catalog size.

### Determinism And Degradation

Card strings are normalized to Unicode NFC. Ordering compares normalized category and name by
binary UTF-8 bytes, not locale-sensitive collation. The allocator does not use recency, embeddings,
provider calls, or model-generated summaries. It applies these deterministic stages:

1. name, capped summary, category, and platform;
2. name and a fairly allocated short summary, using a shared summary code-point cap selected by
   bounded binary search plus a fixed local scan for the estimator's non-monotonic Unicode edges;
   shorter summaries remain unchanged and leftover space is not redistributed. The selected result
   is always checked against the final token bound but is not claimed to be the global maximum for
   adversarial Unicode. Candidate rendering stops as soon as its line-level token sum exceeds the
   budget so failed probes never materialize an unbounded catalog string;
3. name only;
4. a stable fitting prefix plus an omission marker that names the omitted count and points to
   `skill_list`.

Prompt provenance records `skill_catalog_shortened` for summary or name-only stages and
`skill_catalog_omitted` when cards are omitted. The render report remains an execution-local
diagnostic and is not persisted as section identity.

Session-active Skills may be represented name-only in Route because their complete body already
has a stable system projection. Message-scoped selections and runtime views never mutate the
catalog representation; this keeps the leading system prefix stable across turns.

Omission is enabled only when bounded, searchable, paginated `skill_list` ships in the same
release. The same input catalog, active state, context length, and builder version must produce
byte-identical Route output and the same report.

## Discover Contract

`skill_list` accepts:

```ts
interface SkillListInput {
  query?: string
  cursor?: string
  limit?: number
}
```

- No query performs bounded browsing in stable catalog order.
- A query performs local deterministic lexical matching over the canonical bounded summary and
  bounded normalized Skill metadata.
- Ranking is exact name, normalized name/prefix, existing aliases or keywords when present,
  category, then bounded summary text; ties use stable category/name order.
- The default page size is 10 and the hard maximum is 20.
- `skill_list` is a system-model discovery capability while Skills are enabled; per-tool user
  configuration cannot remove the only recovery path for omitted Route cards.
- Query input is limited to 256 Unicode code points and 1,024 UTF-8 bytes. Cursor input is limited
  to 1,024 UTF-8 bytes.
- Cursor decoding is validated and bound to the normalized-query hash, routing projection version,
  and a SHA-256 fingerprint of the normalized catalog snapshot. The complete cursor payload,
  including its offset, is authenticated with a process-scoped HMAC and must use canonical
  base64url encoding. A catalog change, tampering, or process restart invalidates the cursor instead
  of silently duplicating or skipping cards.
- Each response has a 2,000 approximate-token ceiling and may return fewer than `limit`.
- The response contains whitelisted routing cards, `nextCursor`, total match count, and omitted
  count. It never returns arbitrary metadata or an unbounded full description.

Local matching never builds or retains a second normalized description corpus. It searches the
same bounded summary used by the canonical routing card. Aliases, keywords, and tags are inspected
under fixed candidate and per-value bounds. Raw query bytes are bounded before normalization, and
the normalized query is checked again because NFC may expand input. Changes outside the searchable
projection do not invalidate a cursor because they cannot change matching, ordering, or output.
Every Skill omitted from Route remains discoverable through bounded browsing even when its search
terms are outside the routing summary.

## Activate Contract

### Effective Content

One canonical builder produces:

```text
effective Skill content = rendered SKILL.md body + DeepChat runtime instructions
```

Runtime instructions include the resolved Skill root, relative-path semantics, `skill_run`
preference, enabled script inventory, and path-safety guidance. Root `skill_view`, message Skill
projection, and Session-active projection must use this same builder and builder version.

The execution snapshot freezes the scoped Agent/Skill identity, rendered manifest hash,
provider-visible script inventory, and a bounded private package of authorized runtime files with
their bytes and hashes. `skill_run` must retain live permission and cancellation checks, but execute
only a verified copy extracted from the exact request-bound package. A changed environment binding
or missing/corrupt package fails closed and requires a new execution rather than silently running
code different from the provider-visible contract.

### Projection By Scope

| Activation source | Lifetime | Provider-visible projection |
| --- | --- | --- |
| Message `@skill` or panel selection | Current execution | Active-turn user context from a materialization fact |
| Root `skill_view` | Current tool loop | Exact tool result fact |
| Existing Session active state | Session, until removed | Stable Active Skills system section from a materialization fact |

Within one provider request, one Skill's complete effective body appears at most once. The
deduplication precedence is Session-active system body, then message active-turn body, then runtime
view tool-result body. Routing cards and bounded historical markers are not complete-body
projections.

Every Run owns an execution-local Skill projection registry keyed by canonical Agent/Skill identity.
It records selected source, content hash, authoritative entry ref, precedence, and whether a full
body is already provider-visible. `skill_view` consults this registry before reading content. A
root view of a Skill already projected from Session, message, or an earlier root view returns a
bounded confirmation instead of the body. A supporting-file view remains available because
supporting files are not part of the root effective body.

After the owning execution, historical provider projection replaces a successful root-view result
with a bounded `[Viewed skill: ...]` marker. Permission resume for that assistant-message execution
continues to project the exact result. The ordinary `tool_result` Tape entry remains unchanged and
authoritative; supporting-file and unrelated MCP results are never collapsed by this rule.

## Tape Semantics

### Authority

- Tape entry payloads are content facts.
- ViewManifest records which entry-backed content was selected and proves the exact projection.
- Schema-7 runtime Skill occurrences bind the provider-visible tool-result fact and executable
  materialization fact to the same Run/request/Tape incarnation; schema 6 remains a readable legacy
  occurrence without executable authority.
- ExecutionContract freezes its existing contract-bearing execution boundary; ordinary
  interactive chat does not gain a mandatory ExecutionContract in this increment.
- Provider-attempt facts describe actual attempts and never replace ViewManifest selection facts.

A hash proves identity or drift but cannot recover content. Provider-visible Skill instructions
must never be reconstructed from a mutable disk file during continuation of an existing execution.

### Materialization Fact

Message and Session-active effective content is stored as a Session-local, content-addressed
materialization fact with physical Tape kind `context` and name `skill/materialized`. Agent runtime
receives only narrow materialization read/write capabilities, never generic append or raw-store
access. Existing readers select only message, tool, anchor, and known event semantics, so the new
physical kind is non-effective by default even when an older reader opens the Tape. New readers
also exclude it explicitly from every ordinary projection.

The canonical payload includes a schema version, Skill identity, effective content, effective
content hash, builder version, Agent/source identity, rendered manifest hash, script inventory
hash, and a bounded execution package. The provenance key hashes the Session scope and complete
canonical payload so every current or future evidence field participates in identity.

The execution package snapshots the existing `skill_run` authority namespace under `scripts/` plus
at most 16 explicit `executionSupportPaths` declared by the Skill. Supporting paths are
non-executable and exist for runtime imports, templates, and schemas that cannot be colocated under
`scripts/`; the rest of the Skill root is never silently archived. Hidden paths, symlinks, hard
links, special files, non-portable paths, overlapping roots, and case-fold collisions fail closed.
Canonical decoded and encoded byte limits cover each file, package, and execution batch before
persistence. Fresh resolution is sequential and directory enumeration is bounded so rejected input
cannot first allocate an unbounded candidate batch. One bounded traversal is the source for both
executable inventory and packaged files; stable file-handle reads never allocate beyond the size
already admitted.

Supporting files are introduced by `skill/materialized` schema 3. Schema 2 remains readable with
its original scripts-only invariant; new writers never place support files under the older schema.

Existing bundled `docx` and `pptx` installations predate the support-path declaration. Startup may
add that declaration only when a bounded fingerprint proves the complete installed tree is the
exact known legacy bundle. Any changed manifest, script, support file, extra path, symlink, or
special file disables migration; the proof is repeated before the permission-preserving atomic
write. The same migration runs before discovering existing Agent-private copies. Builtin
installation never overwrites the customized tree. Legacy Skill Sync conversion fails explicitly
for support-bearing Skills until that subsystem can preserve arbitrary support trees. A known
legacy bundle that still has its runtime support tree but cannot be migrated fails materialization
with an actionable declaration error instead of producing a knowingly incomplete package.

Runtime policy is part of the package. Raw extension environment values may contain credentials and
must never enter Tape. The package records only an opaque environment binding revision; the later
execution path may resolve values through a narrow main-process capability only when the current
revision matches exactly, and otherwise fails closed. This is the same intentional limited external
boundary used for other secret-bearing configuration: Tape proves the binding selected for an
execution without becoming another credential store. The opaque revision changes only when the
sanitized environment key/value map changes; content, policy, and script-override edits preserve it.
Legacy environment state without a revision receives a one-time management-state migration before
it can be materialized.

Existing provenance-key idempotency is insufficient by itself. Every reuse parses and validates
the canonical payload, schema, Skill identity, builder version, content hash, and full canonical
payload equality. Lookup, payload validation, Tape-incarnation validation, and append execute in
one synchronous SQLite transaction. A mismatch is corruption and fails closed.

One effective body is limited to 512 KiB UTF-8. One execution is limited to 64 complete Skill
bodies and 2 MiB aggregate effective content. An execution package is limited to 256 files, 256
directories, 16 directory levels, 512 KiB per file, 4 MiB decoded and 7 MiB canonical encoded; one
execution is limited to 16 MiB decoded and 28 MiB encoded package data. Oversized input fails before
provider dispatch and is never truncated or replaced with an offload marker. Facts are
Session-scoped, may be reused by equal identity and content in that Session, and expire with Session
Tape reset or deletion. They do not receive independent garbage collection.

Schema 2 is the first shipped form of `skill/materialized`; schema 1 existed only on the unmerged
feature branch and is intentionally rejected rather than being reinterpreted with an invented empty
execution package.

### Two-Phase Admission

The ordered path is:

```text
fresh source resolve
  -> canonical in-memory effective content
  -> physical per-body/count/aggregate-byte validation
  -> non-admitting candidate context assembly
  -> strict materialize or verified reuse
  -> narrow-reader round-trip validation
  -> fact-derived provider projection
  -> authoritative contextCoordinator preflight
  -> strict Skill-bearing ViewManifest commit
  -> authority, cancellation, Tape-incarnation, ref, and hash recheck
  -> provider dispatch
```

Physical validation rejects only complete Skill bodies that violate the per-body, count, or
aggregate byte limits. It never estimates request-token admission, constructs a Provider
projection, mutates runtime contributions, or admits a request. Candidates that successfully pass
the remaining fail-closed assembly and Tape steps are rebuilt from facts before
`contextCoordinator` performs the sole authoritative preflight. Races after materialization may
leave bounded, content-addressed facts that a later execution can strictly reuse; the design does
not claim zero orphan facts.

If materialization, verified reuse, round-trip validation, or strict Skill-bearing ViewManifest
commit fails, no provider call occurs. The design does not claim provider exactly-once after the
external call starts.

### ViewManifest Evolution

Message and Session Skill contexts without runtime executable authority use ViewManifest schema 6
and hash version 4. Requests that carry runtime `skill_view` execution authority use schema 7 and
hash version 5, binding the provider-visible `tool_result` and exact execution package in one
occurrence. Both schemas require `runId` and non-empty `skillContexts` when full Skill content is
projected. Each Skill context records activation scope, canonical Agent/Skill identity,
authoritative materialization or strict `tool_result` entry ref, triggering message entry ref where
applicable, role, exact projected-effective-content hash, projection version, and selected
deduplication source. That hash must equal the authoritative materialization or tool-result content
hash; provider-message wrappers remain covered by the whole-prompt hash instead of creating an
unbacked second content identity. An `ExecutionContract` is optional in schemas 6 and 7 but, when
present, must satisfy the same immutable request/provenance checks as schema 5.

Schemas 1–4 retain hash version 2 behavior. Schema 5 retains hash version 3 and its mandatory
ExecutionContract. Schema 6 uses hash version 4; schema 7 uses hash version 5 and adds executable
Skill evidence. Each version keeps its own exact hash recipe. Manifest assembly receives a
separate `requireDurableManifest` flag whenever full Skill content is projected; it is independent
from `strictViewContract`. Duplicate, missing, or conflicting schema-6/schema-7 manifests for one
`(sessionId, tapeIncarnation, runId, requestSeq)` binding fail closed. Existing schemas and hash
recipes remain readable and are never reinterpreted under the new semantics.

Request-occurrence recovery uses the manifest bound to the exact Run and request, never a
Session-global or message-global "latest manifest" lookup. Runtime-view continuation across a
permission pause instead intersects the current assistant message's persisted root-view blocks
with its provider projection, then restores identity and content authority from matching strict
tool-result facts. The replay service remains an evidence-slice validator; runtime continuation
receives a separate narrow, hash-validating Skill-context reader rather than assuming replay
already reconstructs provider messages.

### Continuation And New Execution

`runId` identifies one provider-loop attempt and its request occurrences. Transient retry,
context-pressure recovery, strict overflow retry, and ordinary tool-loop rounds keep that Run and
reuse its original references. Permission resume starts a new Run for the same assistant-message
execution and must rebuild its registry from the exact Tape-backed references selected before the
pause. Neither path may reread mutable Skill files. Missing entries, physical-envelope drift, Tape
incarnation changes, scope conflicts, or hash drift fail closed.

The current Execution Journal does not resurrect an old Run after process restart. Resuming the
same pending assistant message creates a new Run but remains a continuation and restores its exact
Tape-backed Skill content. Regenerate, edit-and-resend, or a newly submitted message creates a new
Skill execution. It fresh-resolves the current Skill source by bypassing or validating the content
cache, then strictly reuses equal materialized content or appends a new version. Version drift
remains visible through entry and projection hashes.

Root `skill_view` keeps `execution/tool_outcome` as the strict operation-settlement fact; that fact
contains the response hash, not the response body. A narrow strict Skill-view writer therefore
persists the canonical ordinary `tool_result` fact as the exact content authority after Journal
outcome commit and before activation. It validates operation identity and response hash against the
Journal fact, prohibits truncation/offload, and reads the content fact back before activation. The
later transcript settlement reuses the same tool-result provenance key and must verify canonical
payload equality instead of appending another copy. No separate `skill/activated` or Skill-specific
result fact is added.

### Isolation

Materialization facts are behavioral context, not transcript. They are excluded explicitly from:

- normal effective message views and transcript rendering;
- FTS and fallback search;
- `tape_search` and `tape_context`;
- Memory ingestion and recall;
- ordinary context renderer projection;
- generic fork merge.

Fork merge must not copy materialization facts by entry count. A downgraded reader may copy an
unknown `context` row during fork merge, but the row remains non-effective and unusable because its
Session/Tape/source identity does not validate in the destination. Files outside the private,
bounded `scripts/` execution package are recorded only through normal `skill_view(file_path)` tool
results. Logs and default audit views expose only Skill name, hash, byte count, schema, and builder
version; full content and package bytes require an explicit controlled inspection path.

## Context Governance

Prompt sections remain the content provenance source. Approximate token costs and breakdowns are
derived for the current request and are not persisted as section identity fields.

On a final preflight failure, diagnostics will attribute approximate costs to system sections,
tools, current user content, message Skills, Session Skills, history, Memory, and output reserve.
Unattributed or opaque projection cost is reported honestly. Protected configured instructions,
project instructions, current input, required tool protocol state, and complete activated Skill
contracts are never silently truncated.

Provider overflow parsing records structured observations. Only an explicit provider-reported
limit may establish a model-scoped, runtime-only Session ceiling. Generic overflow marks configured
metadata suspect but establishes no numeric limit. A second Provider call occurs only when recovery
materially changes the final messages or effective output limit; unchanged and locally inadmissible
projections fail with actionable diagnostics. Derived estimates and a single rejected request never
overwrite provider configuration or become Tape facts.

## Acceptance Criteria

1. Arbitrary enabled Skill counts and description lengths cannot make the Route catalog exceed its
   computed approximate-token budget; when the minimum representation cannot fit, the block is
   absent and the report records the omission.
2. Route output is deterministic, Unicode-safe, and stable across message-scoped activation.
3. Omitted Skills are always discoverable through the concurrently shipped bounded `skill_list`.
4. `skill_list` validates query, cursor, and limit, has a hard result budget, and exposes only
   whitelisted routing-card fields.
5. Small catalogs preserve useful summaries without an extra provider round trip.
6. Root `skill_view` returns the canonical effective content, including runtime instructions.
7. Root view activation occurs only after exact result validation and strict Tape settlement;
   failures do not activate the Skill or continue the run.
8. Message selection, root view, and Session-active state project complete bodies according to
   their declared lifetimes, with at most one body per Skill per request.
9. The first message of a Session does not persist its message Skill selection as Session state.
10. Existing Session active Skills remain visible and removable, while no new Pin entry point is
    introduced.
11. Every message or Session Skill body sent to a provider is read back from a validated Tape
    materialization fact; continuation in one Run or across permission resume never rereads mutable
    disk.
12. New executions fresh-resolve Skill source content and record or strictly reuse the resulting
    version.
13. Skill-bearing ViewManifest persistence and all pre-provider fact/ref/hash checks fail closed.
14. Existing ViewManifest versions and hashes remain readable without semantic reinterpretation.
15. Materialization facts cannot enter transcript, search, Memory, ordinary rendering, or fork
    merge paths.
16. Pre-persistence validation enforces only physical Skill-body limits; token admission
    remains exclusively owned by the final fact-derived `contextCoordinator` preflight.
17. Diagnostics derive from the exact current projection and do not promote estimates to durable
    facts.
18. Existing Agent scoping, Plugin-contributed Skills, supporting-file access, permission checks,
    cancellation, and context isolation remain intact.
19. No generic Tape writer, Skill sidecar store, embedding/LLM router, silent body truncation, or
    user-input summarization is added.
20. No remote Git operation is performed.
21. Direct ACP compatibility never projects a local full Skill body without DeepChat Tape
    materialization authority.

## Constraints

- Use the existing `tokenx` estimator for catalog and request estimates.
- Use NFC normalization and binary UTF-8 comparison for persisted or cursor-bound ordering.
- Keep Oxfmt style and existing typed main/preload/renderer boundaries.
- New Tape facts use existing Session Tape storage and narrow capability composition.
- Security-sensitive exact content and raw provider errors are not logged.
- Each implementation commit receives a full risk-oriented diff review and relevant validation
  before commit.
- SDD artifacts in this directory use English prose.

## Non-Goals

- Pure search-first Skill routing with an empty initial catalog.
- Embedding or LLM-based Skill routing.
- Automatic description summarization.
- A global prompt-budget broker or a second preflight coordinator.
- A new user-facing Pin feature in this increment.
- Silent truncation of configured prompts, project instructions, current input, or activated Skill
  contracts.
- Provider window calibration from local estimates or generic errors.
- Provider exactly-once guarantees.
- A GitHub issue, pull request, push, or other remote mutation.

## Open Questions

None. Product semantics, budget constants, Tape authority, migration order, and delivery slices are
fixed by this specification and the accompanying plan.
