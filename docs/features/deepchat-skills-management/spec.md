# DeepChat Skills Management Contract

Status: implemented and maintained.

## Ownership

`src/main/skill/` owns Agent-scoped Skill files, validation, discovery, catalog caches, enablement and Plugin
contributions. Every DeepChat Agent owns a physical Skill root:

```text
<skillsRoot>/                              # built-in deepchat Agent
<skillsRoot>/.agent-scopes/<agentId>/      # manual DeepChat Agent
```

The built-in root remains at the configured legacy location for compatibility. `.agent-scopes` is excluded
from built-in discovery, and a missing manual Agent scope resolves to an empty catalog rather than falling
back to `deepchat`.

`src/main/skill/agentSkillImportService.ts` owns unified snapshot-import orchestration across internal
DeepChat Agents and supported external Agents. `src/main/skill/sync/` owns external Agent discovery,
parsing and format conversion, plus legacy sync-directory and link-repair compatibility. Session stores only
selected Skill names. Tool/Agent consume a closed scoped snapshot; they do not scan files themselves or read
another Agent's catalog.

Skill management state is versioned per Agent. Sync-directory settings remain application-level because
they describe an external backup location, not runtime Skill ownership.

## Skill format and safety

- A Skill has a stable name, validated metadata and a readable instruction body under an authorized root.
- Every operation resolves an existing DeepChat Agent, canonicalizes its root and confines paths to that
  root; unsafe names, traversal, oversized input and unsupported archives fail closed.
- External import applies a shared 50 MiB budget to the manifest plus traversed `references` and `scripts`
  before format conversion loads file contents.
- New writes use the current DeepChat layout. Legacy metadata is migration input only.
- Plugin-provided Skills carry `ownerPluginId`, remain Plugin-owned runtime contributions and disappear when
  the contribution is disabled or removed. They are not copied as ordinary Agent files.
- Scan/import work can fall back from worker execution, but fallback preserves validation and event semantics.
- Two Agents may own the same Skill name with different content, settings and scripts.

## Management UI

The Agent-scoped Skills page always has an explicit target Agent and supports list, enable/disable, details,
install, remove, refresh and import. Global Skills settings explicitly targets the built-in Agent for
compatibility. Install accepts a valid Skill folder or supported archive. Drag/drop resolves the real
filesystem path through the dedicated preload client; the renderer never reads arbitrary files directly.

Internal and external import supports:

- discovery of eligible source Agents and conventional external Agent Skill roots;
- an explicit target DeepChat Agent;
- preview before import;
- per-Skill `skip`, `rename` or `overwrite` conflict strategy;
- empty-selection and partial-failure states;
- main-process source and target revalidation at execution time;
- staged copies that do not follow symlinks or create live links to the source;
- target-only cache invalidation and progress/completion typed events.

Import is a one-time snapshot. Provenance is informational: later source edits, deletion or import from the
same source do not update an existing target copy automatically. External format adapters may convert the
source, but the final write always commits under the explicit target Agent root. Legacy adopted-directory and
link metadata remains available only for compatibility repair or removal; new imports never create live links.

## Draft confirmation

When an Agent proposes a Skill draft, runtime creates an ordered interaction instead of silently writing it.
The confirmation card can view, install or discard. Install re-resolves the Session Agent and revalidates the
draft against that Agent's root at commit time; completion resumes the settled turn through a fresh Run.
Draft interaction cannot bypass filesystem, name or owner rules.

## Runtime contract

- Effective Skills are `persisted Session selection ∩ current Agent's valid enabled catalog`.
- Transfer, rebind and Subagent creation recompute that intersection before prompt/tool/script assembly.
- A Run uses its start snapshot; later configuration changes affect the next Run.
- Disabled, missing, invalid or other-Agent Skills are excluded before prompt/tool assembly.
- Subagent child resolves its own Agent catalog and cannot inherit the parent Agent's files or mutable cache.
- Skill execution uses explicit workspace/process ports and follows the same permission/cancellation policy as
  other Agent capabilities.

The application-level Skill master switch can disable Skill functionality globally, but it does not grant
one Agent access to another Agent's files.

## Migration contract

- Legacy management state migrates into the built-in Agent scope.
- Each readable manual Agent receives private file copies matching its effective pre-upgrade Skill set.
- Plugin-owned contributions are excluded from private copies.
- Persisted Session selections are filtered against the owning Agent catalog without rewriting historical
  message content.
- Migration stages and validates copies before commit, is restartable, and records completion only after all
  required Agent scopes commit.

## Validation

Tests cover parsing/path safety, per-Agent discovery/cache and CRUD isolation, restartable migration,
snapshot import/conflicts, legacy sync-directory compatibility, symlink rejection, Plugin lifecycle,
renderer target stability and partial-success states, draft interaction, and Session/Agent intersection after
transfer and Subagent entry. The planned two-Agent same-name E2E smoke remains outstanding.
