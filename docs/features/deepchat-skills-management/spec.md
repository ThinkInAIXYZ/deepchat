# DeepChat Skills Management Contract

Status: implemented and maintained.

## Ownership

`src/main/skill/` owns Skill files, validation, discovery, scan cache, enablement and Plugin contributions.
`src/main/skill/sync/` owns import/export/adoption from supported external agent directories. Session stores
only selected Skill IDs. Tool/Agent consume a closed Skill snapshot; they do not scan files themselves.

## Skill format and safety

- A Skill has a stable name, validated metadata and a readable instruction body under an authorized root.
- Paths are canonicalized and confined to their selected root; unsafe names, traversal, oversized input and
  unsupported archives fail closed.
- New writes use the current DeepChat layout. Legacy metadata is migration input only.
- Plugin-provided Skills carry `ownerPluginId` and disappear when the contribution is disabled or removed.
- Scan/import work can fall back from worker execution, but fallback preserves validation and event semantics.

## Management UI

The Skills page supports list, enable/disable, details, install, remove, refresh and sync. Install accepts a
valid Skill folder or supported archive. Drag/drop resolves the real filesystem path through the dedicated
preload client; the renderer never reads arbitrary files directly.

External sync supports:

- discovery of conventional agent Skill roots;
- preview before import/export;
- explicit conflict strategy;
- empty-selection and partial-failure states;
- adopted-directory mapping and cache invalidation;
- progress/completion typed events.

## Draft confirmation

When an Agent proposes a Skill draft, runtime creates an ordered interaction instead of silently writing it.
The confirmation card can view, install or discard. Install revalidates the draft at commit time; completion
resumes the settled turn through a fresh Run. Draft interaction cannot bypass filesystem, name or owner rules.

## Runtime contract

- Skill selection is Agent/Session scoped and contributes to the tool-profile fingerprint.
- A Run uses its start snapshot; later configuration changes affect the next Run.
- Disabled, missing or invalid Skills are excluded before prompt/tool assembly.
- Subagent child resolves its own Skill capability and cannot inherit mutable parent cache.
- Skill execution uses explicit workspace/process ports and follows the same permission/cancellation policy as
  other Agent capabilities.

## Validation

Tests cover parsing/path safety, discovery/cache, import/export/conflicts, Plugin lifecycle, renderer install
and drag/drop, draft interaction and Agent snapshot invalidation.
