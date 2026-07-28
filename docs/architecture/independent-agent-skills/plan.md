# Plan: Independent Agent Skills

## Architecture Decisions

### Independent Agent Configuration

`DeepChatAgentRepository` keeps one deterministic code-default normalizer and two temporary
resolution paths during migration:

```text
legacy effective config = builtin raw config + manual raw overrides + code defaults
new effective config    = current Agent raw config + code defaults
```

Startup performs existing legacy repair first, then materializes every manual Agent's legacy
effective config under `unifiedAgentsMigrationVersion=3`. The normal runtime resolver only uses the
new path. For corrupt JSON, migration reproduces the previous resolver's effective value by merging
the built-in config with the fail-closed fallback, logs the row as recovered, and persists that
result. This preserves existing permission mode, MCP allow-list, disabled tools and fail-closed
Subagent behavior instead of widening access under independent defaults.

App default model reads/writes the existing `defaultModel` setting. App auto-compaction controls
read/write their existing settings keys. Agent-specific values remain in each Agent config. The
built-in Memory update callback uses the same single-Agent path as every other Agent.

### Agent Skill Roots

The configured root remains the compatibility location for the built-in Agent:

```text
<skillsRoot>/                              # built-in deepchat Agent
<skillsRoot>/.agent-scopes/<agentId>/      # manual DeepChat Agent
```

`agentId` must resolve to an existing DeepChat Agent and pass the existing safe identifier rules.
The `.agent-scopes` directory is excluded from built-in recursive discovery.

The Skill service moves from one cache to a scoped catalog:

```text
Map<agentId, AgentSkillCatalog>
AgentSkillCatalog = {
  root,
  metadataByName,
  contentByName,
  watcher,
  discoveryPromise
}
```

Public Agent catalog/content/write operations take `agentId`. Session operations take `sessionId`
and resolve its Agent through a narrow injected port. Compatibility wrappers are allowed only for
global administration that explicitly targets the built-in Agent; runtime code must be scoped.

### Management State

`SkillManagementState` advances to version 2 and stores per-Agent entries. Sync-directory settings
remain global because they describe an external backup root, not runtime ownership.

```ts
interface SkillManagementStateV2 {
  version: 2
  agents: Record<string, { skills: Record<string, SkillManagementItem> }>
  sync?: SkillSyncDirectoryConfig
}
```

The old `deepchat.disabled` field becomes Agent-entry `disabled`. Legacy v1 data migrates into the
built-in Agent scope before manual scopes are seeded.

### Migration

Migration is split because Agent settings initialize synchronously while Skill discovery is async:

1. Agent startup v3 materializes non-Skill config using legacy effective resolution and preserves
   the legacy `enabledSkillNames` policy for the Skill migration.
2. Skill startup migrates management state v1 to built-in scope.
3. It discovers the built-in catalog and computes each existing Agent's legacy effective Skill set:
   explicit legacy allow-list, otherwise all valid non-disabled built-in Skills.
4. For every manual Agent, files are copied into a private staging root with symlinks rejected.
5. Each staged catalog is validated, renamed into place, and recorded in management state v2.
6. Session active Skill rows are filtered against their Agent catalog.
7. A durable migration marker is written only after all required Agent roots commit. Re-entry
   resumes missing scopes and does not overwrite a committed private scope.

The app awaits this migration attempt before creating or restoring a chat window. A snapshot
migration failure is logged but does not block startup; committed Agent roots remain available,
missing roots stay empty and the unset completion marker causes another attempt on the next launch.
macOS activation is ignored while startup is still in progress. Shutdown fences new Skill
operations and drains both initialization and the background external-Agent scan before destroying
Skill services.

Plugin-owned Skills are skipped when seeding manual roots because they remain Plugin contributions.

### Import Flow

```text
Renderer source/selection
  -> typed preview route
  -> main resolves source Agent and target Agent
  -> main scans source catalog and target conflicts
  -> renderer chooses conflict strategies
  -> typed execute route with IDs/names/strategies only
  -> main re-scans and revalidates
  -> stage copies under target root
  -> validate all staged Skills
  -> atomic per-Skill commit + target catalog invalidation
  -> typed result and catalog event
```

The execution request never contains filesystem paths or serialized preview contents.

External imports use a discriminated source `{ kind: 'external', toolId }`; internal imports use
`{ kind: 'internal', agentId }`. Existing format adapters perform conversion where required, but
the final write always goes through the target Agent Skill root.

## Interfaces

### Shared Types

- Add scoped Skill catalog and management-state v2 types.
- Add `AgentSkillImportSource`, preview item, conflict strategy and result types.
- Remove `enabledSkillNames` as an authoritative new-write policy after migration; retain decode
  compatibility for one release.

### Main Ports

- Skill catalog/write methods accept an explicit `agentId`.
- Skill Session state port resolves `sessionId -> agentId`.
- Agent deletion cleanup receives a Skill-root cleanup operation.
- Agent deletion and Session assignment share one process-level per-Agent lifecycle gate. Session
  create, detached create, Subagent create, transfer and fork hold an operation lease; deletion
  fences new leases, drains admitted work and then rechecks repository references.
- Agent settings exposes only narrow catalog/config queries required by migration/import.

### Typed Routes and Events

- Existing Skill CRUD routes gain required Agent scope where they are Agent-owned operations.
- Add `skills.listImportSources`, `skills.previewAgentImport` and `skills.executeAgentImport`.
- `skills.catalog.changed` includes affected Agent IDs so unrelated pages do not refresh.

### Renderer

- The Agent-scoped Skills page always has an explicit target Agent.
- Add a focused `ImportSkillsFromAgentDialog.vue` with source, selection, conflicts and result steps.
- Global Skills settings explicitly manages the built-in Agent for compatibility.
- Existing external Agents view becomes an import-source view; live link/adopt remains visible only
  for legacy link repair/removal until removed by a later goal.

## Compatibility and Rollback

- Existing built-in Skill paths do not move.
- Existing manual Agents receive private copies matching their effective pre-upgrade Skill set.
- Existing Session rows retain names and are filtered after migration.
- Downgrading after private scopes are created leaves the legacy built-in root intact, but the older
  application cannot see manual Agent private roots. This limitation is documented; migration does
  not delete source data.
- Failed migration keeps the completion marker unset and preserves staging/backup evidence for a
  retry. It never switches a Session to another Agent's root.

## Security

- Canonicalize source and target roots and require containment on every filesystem operation.
- Reject source symlinks for snapshot import/migration.
- Revalidate names, sizes, manifests and allowed top-level folders at commit time.
- Enforce the existing 50 MiB Skill-folder budget cumulatively across an external manifest and all
  traversed `references`/`scripts` entries before format conversion reads their contents.
- Never trust renderer-provided paths or prior preview results.
- Keep script execution scoped to the resolved Session Agent root.
- Treat `<skillsRoot>/.agent-scopes` as a protected filesystem namespace. File-tool external-access
  modes and remembered approvals cannot grant another Agent's private scope; current active Skill
  roots remain usable.
- Persist deleted-Agent Skill cleanup debt before removing the Agent row. Clear it after successful
  cleanup, or retry it after the next startup when the Agent row is confirmed absent.

## Test Strategy

- Repository unit tests for config independence and v3 materialization.
- Settings/default tests for app-level storage and migration order.
- Skill unit tests for scoped caches, roots, state v2 and CRUD isolation.
- Filesystem tests for migration/import staging, conflicts and symlink rejection.
- Runtime tests for Session/Agent catalog intersection and transfer.
- Interleaving tests for Session assignment/fork versus Agent deletion lifecycle fencing.
- Renderer tests for dialog workflow, target stability and typed client calls.
- E2E smoke for two Agents with same-name different-content Skills (planned, not run in this
  worktree).

## Validation Commands

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:main
pnpm run test:renderer
```
