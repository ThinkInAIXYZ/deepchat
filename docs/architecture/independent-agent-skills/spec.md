# Independent Agent Skills

Status: active.

## User Need

DeepChat currently gives the built-in `deepchat` Agent two unrelated roles: it is a protected
first-party Agent, and it is also the configuration inheritance root for every manual DeepChat
Agent. Skills add a second hidden coupling because all Agents read and mutate the same
`~/.deepchat/skills` directory while Agent configuration only filters that global catalog.

Users need Agents to be peers. The built-in DeepChat Agent should remain available as a protected
first-party Agent, but changing it must not change another Agent. Each Agent must own its Skill
files and settings, and users must be able to copy selected Skills from another Agent explicitly.

## Goal

- Remove built-in Agent configuration inheritance without changing existing upgraded Agents'
  effective behavior.
- Give every DeepChat Agent an independent Skill root, catalog, mutable content and enablement
  state.
- Keep `deepchat` as a protected built-in Agent, not a parent or template relationship.
- Add previewed, one-time Skill import from another internal DeepChat Agent.
- Preserve external Agent discovery/import while making the target DeepChat Agent explicit.

## User Stories

- As a user, I can edit the built-in DeepChat Agent without changing another Agent.
- As a user, I can install, edit, disable or delete a Skill for one Agent without changing another
  Agent.
- As a user, I can import selected Skills from another Agent and then evolve either copy
  independently.
- As an existing user, I retain the effective Agent configuration and Skills I had before the
  migration.
- As a session user, I can activate only Skills owned and enabled by the Session's current Agent.

## Acceptance Criteria

1. `DeepChatAgentRepository.resolveConfig()` and bulk resolution never read another Agent's row.
2. The built-in `deepchat` row remains `source=builtin`, protected, enabled and non-deletable, but
   has no inheritance or fan-out behavior.
3. Upgrade migration materializes every manual Agent's pre-migration effective config before
   independent resolution becomes authoritative. Corrupt rows are recovered from the built-in
   config plus the previous fail-closed fallback, preserving permission, MCP, disabled-tool and
   Subagent restrictions instead of resolving with broader defaults.
4. App-level default model and auto-compaction settings are stored as app settings, not aliases for
   built-in Agent configuration.
5. Built-in Agent Memory configuration changes invalidate only the built-in Agent.
6. The built-in Agent keeps the configured legacy Skill root. Every other DeepChat Agent uses a
   canonical directory below `<skillsRoot>/.agent-scopes/<agentId>/`.
7. Skill discovery, content, extension settings, scripts, install, edit, enable/disable and delete
   operations are scoped by `agentId`; equal Skill names may have different contents in two Agents.
8. Missing Agent Skill scope resolves to an empty catalog. It never falls back to `deepchat`.
9. A Session's effective Skills are its persisted selection intersected with the current Agent's
   valid, enabled catalog. Transfer, rebind and subagent execution recompute that intersection.
10. Internal import offers a source Agent, selected Skills and per-conflict `skip`, `rename` or
    `overwrite` behavior. It previews before committing.
11. Import re-resolves and validates source paths in main at execution time, copies files without
    following symlinks, and never creates a live link to the source.
12. External Agent imports require an explicit target DeepChat Agent and use the same target-root,
    validation and conflict contract.
13. Import success refreshes only the target catalog. Cancellation and validation failure leave the
    target unchanged; partial file failures are reported per Skill.
14. Plugin-owned Skills remain runtime contributions owned by the Plugin and are not copied as
    ordinary Agent files in this increment.
15. Agent deletion removes its private Skill root through the existing cleanup workflow. Deleting a
    source Agent never changes previously imported target copies.
16. All user-facing strings use i18n and loading, empty, conflict, error and partial-success states
    are covered.
17. Startup completes Skill migration before a chat window or background Session runtime can use
    the catalog, and shutdown drains in-flight Skill initialization and scans before teardown.
18. Agent file tools treat private Agent Skill scopes as protected paths even in `full_access`;
    only the current message's active Skill roots are exceptions.
19. Agent deletion records durable private-Skill cleanup debt before deleting the Agent row and
    retries debt after startup, so a failed filesystem cleanup does not become permanent residue.
20. External Skill import rejects oversized manifests and enforces one shared 50 MiB budget across
    the manifest, `references` and `scripts` before loading their contents.
21. Session creation, transfer and fork share an Agent lifecycle gate with Agent deletion. Deletion
    fences new assignments, drains admitted assignments and then rechecks Session references, so a
    Session cannot persist an `agentId` whose Agent row was concurrently deleted.

## Product Semantics

### Built-in, Default and Parent

These are separate concepts:

- `builtin` is lifecycle metadata. The built-in DeepChat Agent cannot be deleted and can be reset.
- A default Agent is only the Agent selected when an entry point has no explicit selection.
- There is no parent Agent and no `inheritsFrom` relationship.

Hard-coded `deepchat` fallbacks may remain where they mean first-run/default selection. They must
not be used to resolve another Agent's configuration or Skill catalog.

### Skill Ownership

An Agent owns mutable Skill files under its canonical Skill root. Import is a snapshot copy. Source
provenance is informational and does not create update propagation.

The global Skill setting remains a product-level master switch and Plugin contributions remain
Plugin-owned runtime resources. Neither grants one Agent access to another Agent's files.

### Conflict Semantics

- `skip`: leave the target Skill unchanged.
- `rename`: copy to the first available validated name derived from the requested target name.
- `overwrite`: stage and validate the copy, then atomically replace the target Skill while retaining
  a recoverable backup until commit succeeds.

## Constraints

- Preserve path confinement, archive limits, draft validation, script policy and permission checks.
- Renderer never receives authority to provide arbitrary source or target paths.
- Do not add a generic Presenter or restore legacy IPC.
- Keep Session transcript Skill names compatible; migration may filter invalid selections but does
  not rewrite historical message content.
- Do not create or sync a GitHub issue unless the developer separately approves it.

## Non-goals

- Continuous Agent-to-Agent Skill synchronization.
- Parent/child Agent templates or inherited configuration.
- Copying Plugin-owned Skill packages outside their Plugin lifecycle.
- Making direct ACP runtimes execute DeepChat-managed Skills.
- Replacing the external Skill format adapters or marketplace/install mechanisms.
- A broad redesign of the Agent or Plugins navigation.

## Validation

- Repository and migration tests cover legacy config materialization and post-migration isolation.
- Skill service tests cover same-name isolation, path confinement, CRUD isolation and migration.
- Import tests cover preview/execute drift, conflicts, symlinks, partial failure and idempotence.
- Runtime tests cover Session/Agent intersection, transfer and subagent boundaries, including
  assignment/deletion interleavings.
- Renderer tests cover source selection, preview, conflict resolution, stale requests and refresh.
- The planned packaged two-Agent same-name Skill E2E has not been run in this worktree.
