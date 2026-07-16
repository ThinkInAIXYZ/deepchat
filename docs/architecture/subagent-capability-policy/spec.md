# Subagent Capability Policy - Specification

> Status: **implemented and validated**

## Problem

DeepChat currently models Subagent availability through several independent states:

1. `DeepChatAgentConfig.subagentEnabled` is the Agent-level default.
2. `new_sessions.subagent_enabled` is copied into each regular Session and can be toggled from the
   composer.
3. `DeepChatAgentConfig.subagents` must contain at least one valid slot before
   `subagent_orchestrator` can be exposed.
4. The runtime tool catalog is cached without the Agent Subagent policy or slot configuration in
   its fingerprint.

These states can disagree. The composer can report that Subagents are enabled while the model never
receives `subagent_orchestrator`, and Agent configuration changes can remain hidden behind a stale
tool catalog. The same capability is also controlled by both a dedicated boolean and the generic
disabled-Agent-tool mechanism.

## Decision

Agent configuration is the single persisted policy source for Subagent delegation. The policy is
enabled by default, and the model decides whether a particular task benefits from delegation. The
runtime remains the final authority for availability, slot selection, ownership, permissions,
timeouts, cancellation, and recursion prevention.

DeepChat keeps one advanced Agent-level opt-out. It removes the Session/Draft/composer toggle and
does not add a global user-facing switch.

## Capability Contract

Runtime availability is represented by a closed capability snapshot:

```ts
type DeepChatSubagentCapability =
  | {
      available: true
      slots: DeepChatSubagentSlot[]
      cacheKey: string
    }
  | {
      available: false
      reason: 'policy_disabled' | 'unsupported_session' | 'no_valid_slots'
      cacheKey: string
    }
```

The snapshot obeys these invariants:

1. Only a regular DeepChat parent Session can have an available capability.
2. A Subagent child Session always resolves `unsupported_session` and cannot recurse.
3. An Agent with `subagentEnabled === false` resolves `policy_disabled` even when slots remain
   configured.
4. An enabled Agent must have at least one structurally valid, normalized slot. Corrupt enabled
   configuration resolves `no_valid_slots` and fails closed.
5. `cacheKey` covers every field that changes the model-visible tool definition: policy state,
   slot ID, target type, target Agent ID, display name, and description.
6. Tool-definition construction uses one immutable capability snapshot. Tool execution resolves
   the current capability again so a policy disabled between definition and invocation cannot be
   bypassed.
7. A run that already passed admission keeps its start-time task and slot snapshot. Later policy
   changes affect future calls, not active runs; users cancel active runs through the existing run
   controls.

Target-Agent existence and host-policy validity remain call-time checks. A stale target fails before
the child Session is created and cannot create a Tape link.

## Agent Configuration and Migration

`DeepChatAgentConfig.subagentEnabled` and `DeepChatAgentConfig.subagents` remain compatible stored
fields. Their meaning is Agent delegation policy and reusable child slots, not Session state.

New built-in and custom Agent configurations default to `subagentEnabled = true` with Explorer,
Implementer, and Reviewer self-target slots.

A custom Agent with an absent config JSON keeps that implicit local Subagent default instead of
inheriting the built-in Agent's opt-out. Other unset configuration fields continue to inherit from
the built-in Agent, and raw catalog reads remain unchanged for compatibility.

A present but unreadable config JSON does not receive those implicit slots. It resolves as enabled
with zero valid slots so the runtime reports `no_valid_slots` until the configuration is repaired.

The unified Agent configuration migration advances to version 3 with this matrix:

| Stored configuration | Migration result |
| --- | --- |
| Built-in `deepchat`: `false` and zero valid slots | `true` plus default slots |
| Any Agent: enabled and zero valid slots | enabled plus default slots |
| Custom Agent: disabled and zero valid slots | unchanged |
| Any Agent: disabled with configured slots | unchanged; slots are retained |
| Missing policy or slots | existing default normalization remains `true` plus default slots |

The migration is idempotent and records version 3 only after all Agent updates succeed. A failure
leaves the version unchanged so startup can retry safely.

After migration, Agent writes enforce `enabled => at least one valid slot` at the main-process
repository boundary. The Settings UI restores defaults when enabling an empty legacy form and does
not allow the final slot to be removed while enabled. Disabling an Agent preserves its slots.

## Tool Exposure and Security

`subagent_orchestrator` is a dedicated system/model capability rather than an ordinary
user-configurable Agent tool:

- the Agent-level policy is its only user-controlled hard gate;
- generic `disabledAgentTools` cannot create a second policy source;
- it is absent from the generic tool toggle catalog;
- its name is reserved so an MCP server cannot shadow the privileged built-in orchestrator;
- tool-catalog resolution checks the persisted Agent kind instead of assuming every compatibility
  runtime Session is a DeepChat Agent;
- an Agent-kind lookup failure closes only the Subagent capability and does not suppress an
  independently resolved Skill or MCP extension policy;
- execution revalidates regular-parent ownership and the current Agent policy before admitting a
  new run.

Existing child permission inheritance, cross-Agent host-policy isolation, direct ACP target
behavior, maximum run count, task count, deadlines, cancellation settlement, and Tape link
finalization do not change.

## Session and UI Compatibility

The Session-level capability surface is retired:

- Session create, detached create, transfer, cron, remote, and draft inputs no longer accept or
  propagate `subagentEnabled`;
- `sessions.setSubagentEnabled` is removed;
- renderer Session/Draft stores and the synthetic composer `subagent` item are removed;
- Agent Settings remains the only configuration surface;
- Subagent progress cards, child navigation, logs, wait/kill controls, and cancellation remain.

The physical `new_sessions.subagent_enabled` column stays in the current database schema for
rollback and old-database compatibility. New code leaves it at the database default and never uses
it to authorize the capability. Legacy imports may contain the field; readers tolerate and ignore
it instead of reintroducing Session policy. Current exports and renderer contracts do not present
it as meaningful state.

Existing Sessions resolve the current Agent policy on the next tool-catalog resolution. They do not
need to be recreated. A legacy Session value of either `0` or `1` has no effect after retirement.

## Model Delegation Policy

When available, the model honors explicit user direction first. For proactive delegation, the
expected benefit must exceed the extra coordination, token, latency, and resource cost. Tool and
default system guidance must require:

- using Subagents when explicitly requested and available, and never using them when explicitly
  declined;
- limiting proactive delegation to genuinely independent, isolatable, or clearly parallel work;
- avoiding proactive delegation for simple, latency-sensitive, or strongly sequential tasks;
- avoiding concurrent write-heavy tasks that can modify overlapping files;
- preferring bounded prompts and observable validation results from each child.

The Agent-level switch is a hard policy. A one-turn natural-language instruction is model guidance
and does not create another persisted state source.

## Performance Constraints

- Capability resolution performs bounded Agent-kind/config point reads and one Session-kind lookup
  per tool profile resolution; it does not scan Sessions or Agents.
- Slot normalization remains bounded by `DEEPCHAT_SUBAGENT_SLOT_LIMIT`.
- A stable capability cache key invalidates only when model-visible policy changes.
- No event-only cache invalidation is relied upon for correctness.
- Default exposure adds only the existing orchestrator schema; no discovery tool or additional
  model round trip is introduced.

## Acceptance Criteria

1. A new or migrated built-in DeepChat Agent exposes `subagent_orchestrator` in a regular Session
   without a Session toggle.
2. An Agent-level disable removes the tool from existing Sessions on their next turn without an app
   restart.
3. Slot changes update the tool enum and description on the next turn despite a previously cached
   catalog.
4. Enabled configuration cannot persist with zero valid slots; disabled configuration retains its
   slots.
5. Legacy `subagent_enabled` values do not affect availability, and the physical column remains
   schema-compatible.
6. Child Sessions cannot receive or invoke `subagent_orchestrator`.
7. A policy change between tool definition and invocation fails closed, while an admitted active
   run is not silently cancelled.
8. An MCP server cannot shadow `subagent_orchestrator`, and generic disabled-tool state cannot
   override the dedicated policy.
9. Composer and New Thread UI contain no Subagent toggle; Agent Settings contains the default-on
   policy with cost guidance.
10. Existing run guardrails, host-policy isolation, Tape lineage, cross-Tape recall, ACP behavior,
    and child activity UI remain compatible.
11. Configless custom Agents retain their own default-on Subagent policy, and non-DeepChat
    compatibility Sessions never receive the orchestrator definition.

## Validation Evidence

The implementation was verified with targeted Agent migration/repository, tool catalog/runtime,
Session lifecycle/route, ACP, and renderer suites. The final branch validation also passed:

- full main-process tests: 372 files passed, 16 skipped; 4,300 tests passed, 207 skipped;
- full renderer tests: 168 files and 1,301 tests passed;
- the four native-SQLite suites under Electron's ABI: 4 files and 179 tests passed;
- node and renderer typechecks, repository formatting and format check, i18n validation, lint, and
  architecture guards.

The exact `pnpm run test:main:native-sqlite` shell command could not load the installed native
module because the shell Node runtime requires module ABI 137 while the workspace dependency was
built for Electron ABI 143. The same forced-native suites passed through the repository's Electron
runtime. A full build was intentionally not run because this goal does not refresh provider or ACP
registries.

## Non-goals

- A global or enterprise-managed Subagent policy.
- A per-turn hard-disable UI or a three-state automatic/explicit/off policy.
- Recursive Subagents or a change to concurrency, task, timeout, or permission limits.
- Changing slot target model selection or child workspace inheritance.
- Removing the legacy database column in this change.
- Adding a new model tool, lineage UI, or provider build refresh.
- Syncing a GitHub issue or creating a PR.

## Open Questions

None.
