# Plan: Shared Skills

## Objective

Store one global set of Skills, derive per-Agent availability through logical bindings, and expose
one Skills list whose preview owns enabled-Agent management.

The normative design is [spec.md](./spec.md). This is the only execution tracker for the goal.

## Ownership Boundary

- `src/main/skill/` owns canonical packages, discovery, bindings, migration, mutation
  serialization, external import, and catalog events.
- `src/shared/contracts/` and `src/shared/types/` own global Skill, binding, import, and result
  contracts.
- `src/renderer/api/` owns the typed bridge client.
- `src/renderer/src/pages/plugins/` owns the sole global list, preview, external import, and
  sync-directory secondary view.
- Session and Agent services provide identity, lifecycle, and persisted-selection ports without
  gaining package ownership.
- `src/main/tool/agentTools/` owns filesystem protection derived from active Skill roots.

## 1. Contracts and persisted state

- [x] Define version 3 global Skill metadata, Agent bindings, migration journal state, deletion
  impact, and external-only import contracts.
- [x] Store global package metadata under `skills`; decode the former development-only `library`
  field for compatibility.
- [x] Keep `agentId` required for derived runtime catalogs and extension policy without making it
  package ownership.
- [x] Expose `skills.listAll`, Agent-derived `skills.listCatalog`, and acknowledged global
  `skills.delete` routes.
- [x] Preserve version 1 and version 2 decoding and sync export compatibility.

## 2. Canonical catalog and bindings

- [x] Collapse mutable discovery, metadata/content caches, and watching into the configured global
  Skills root.
- [x] Derive Agent catalogs by intersecting available Skills with enabled bindings.
- [x] Keep extension and script overrides in Agent bindings.
- [x] Reuse staging, backup, manifest validation, containment, and one mutation gate.
- [x] Preserve bundled and Plugin ownership and provider-default bindings.

## 3. Restartable migration

- [x] Build a deterministic plan from existing roots, management state, DeepChat Agents, and
  Sessions before committing version 3.
- [x] Deduplicate equal packages and generate validated names for different same-name variants.
- [x] Journal and validate staged copies before canonical renames.
- [x] Translate disabled state and extensions into bindings and remap DeepChat Agent Sessions.
- [x] Skip ACP and orphaned Sessions and retain legacy roots as recovery evidence.
- [x] Resume or roll back an interrupted journal without overwriting canonical packages.

## 4. Package and binding mutations

- [x] Validate binding targets through Agent existence, DeepChat type, and lifecycle gates.
- [x] Retain extension state when an Agent is removed and revalidate affected Session selections.
- [x] Keep Agent-scoped compatibility install and uninstall entry points mapped to global packages
  and bindings.
- [x] Implement recoverable shared deletion with acknowledged enabled-Agent impact.
- [x] Keep shared content and per-Agent extension ownership distinct.

## 5. External Agent import

- [x] Restrict source discovery to supported external Agents.
- [x] Preview `ready`, `same`, `conflict`, and `unavailable` against global Skills.
- [x] Re-scan and revalidate at execution and return per-Skill partial results.
- [x] Remove target Agent IDs from preview and execute; imports do not enable an Agent.
- [x] Remove internal DeepChat Agent copy/import and legacy link-repair surfaces.
- [x] Keep sync-directory backup separate from Agent bindings.

## 6. Runtime and filesystem authorization

- [x] Resolve Session, transfer, fork, and Subagent Skills as persisted selection intersected with
  the destination Agent catalog.
- [x] Feed only the derived Agent catalog into bounded Route and Discover projections.
- [x] Preserve Tape-backed effective content, request-bound execution packages, and opaque
  per-binding runtime environment revisions.
- [x] Use the derived catalog for prompts, allowed tools, Skill tools, scripts, and Run snapshots.
- [x] Protect the entire configured Skills root and allow only active concrete package roots.
- [x] Stop creating or deleting private roots for new Agent lifecycle operations.

## 7. Renderer interaction

- [x] Render every Skill in one searchable two-column list with equal-height name-and-description
  cards whose whole surface opens Preview.
- [x] Keep the task-completion Skill Draft suggestion setting above search and actions.
- [x] Remove Agent-assignment tabs, Agent picker, switches, counters, and
  assigned/unassigned copy.
- [x] Put enabled Agent names, Add Agent, and remove actions inside the Skill preview.
- [x] Filter the preview target list to DeepChat Agents and keep one binding mutation pending at a
  time.
- [x] Offer only `Import from external Agent` as the primary add action.
- [x] Move sync directory behind a secondary action with an explicit return to the Skills list.
- [x] Render the same global Skills surface in the Plugins hub without an Agent scope prop.
- [x] Remove the Settings navigation item and route so the Plugins hub is the sole Skills surface.
- [x] Keep shared edit/delete impact, stale confirmation, loading, empty, retry, keyboard,
  accessibility, dirty-close, and pending-operation route-leave behavior on existing primitives.
- [x] Update all locale contracts and remove visible Library and assignment terminology.

## 8. Whole-change review

- [x] Review package ownership, enabled-Agent impact, migration interruption, Plugin lifecycle,
  Agent deletion, Session transfer, stale renderer requests, and partial imports.
- [x] Review watcher count, derived catalog cost, event fan-out, and mutation latency without
  adding a cache or index without evidence.
- [x] Confirm the renderer adds no store, watcher, IPC loop, or per-card Agent state.
- [x] Confirm development states using the former version 3 `library` field remain readable.

## 9. Validation and durable regression protection

- [x] Keep durable tests for migration, authorization, binding lifecycle, global import, and the
  user-visible list/preview interaction.
- [x] Remove tests that preserve the deleted Agent assignment page or runtime configuration dialog.
- [x] Keep external import tests independent of ACP or target Agent lookup.
- [x] Run focused main and renderer Vitest suites.
- [x] Run typed-route and settings-navigation Playwright smoke tests.
- [x] Inspect the final UI at desktop and constrained widths.

## 10. Quality gates

- [x] Update maintained Skills and tool-system documentation.
- [x] Keep this plan as the only tracker.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run `pnpm run build`.

## 11. Runtime and interaction hardening

- [x] Commit the migration recovery journal by atomic replacement before package renames.
- [x] Treat watcher deletion as an exact-path cache invalidation and preserve persisted bindings
  through transient atomic-save events.
- [x] Keep `skill_view` authorized by the current Run snapshot after a concurrent unassignment.
- [x] Remove the unused DeepChat duplicate route and catalog reasons with no producers.
- [x] Fence late preview mutations and route background close requests through the dirty-draft
  guard.
- [x] Show Agent display names in external-import impact copy and guard historical settings routes.
- [x] Replace the Settings-to-main onboarding `sessionStorage` handoff with typed IPC.
- [x] Remove unused locale keys and localize the remaining Skills page and external-import copy.
- [x] Run focused regressions and the repository quality gates.

## Validation Record

- `pnpm run format`: passed for 2,756 files.
- `pnpm run i18n`: passed for 20 locales and 4,125 source message contracts.
- `pnpm run lint`: passed the Agent cleanup guard, alert-dialog contract guard, and Oxlint.
- `pnpm run typecheck`: passed Main and renderer projects.
- Main Vitest: 561 files and 7,167 tests passed; 29 files and 417 tests skipped.
- Renderer Vitest: 254 files and 2,118 tests passed.
- Focused regression suites: 5 Main files and 268 tests; 9 renderer files and 117 tests passed.
- Playwright settings navigation, IPC boundary, Skills route, and Skill sync smoke: 4 tests passed.
- `pnpm run build`: Main, preload, renderer, and CLI production builds passed.
- Visual inspection: the top Skill Draft setting, global list, and Skill preview passed at
  1,280 × 900 and 760 × 720 without clipped controls or horizontal overflow.
