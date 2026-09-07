# DeepChat Skills Management Contract

Status: implemented. The normative architecture is
[Shared Skills](../../architecture/shared-skills/spec.md).

## Product contract

DeepChat exposes one application-level `Skills` set. A Skill package exists once; each DeepChat
Agent can independently be enabled to use it, and each Session can independently activate an
enabled Skill for a Run.

The Plugins-hub Skills page defaults to every available Skill. A card contains only the Skill name
and a two-line description; the whole card opens Preview. It never displays source,
assigned/unassigned state, or Agent grouping.

Opening a Skill shows:

- its rendered content and source path;
- the DeepChat Agents currently enabled for it;
- `Add Agent`, listing only eligible Agents not already enabled;
- one remove action for every enabled Agent; and
- shared edit/delete actions when package ownership permits them.

Agent changes commit immediately. ACP and missing Agents never appear as targets.

## Storage and ownership

Mutable packages use one canonical directory:

```text
<skillsRoot>/<skillName>/
```

Read-only bundled and Plugin Skills remain in provider-owned roots and appear in the same global
list. Their provider retains content and lifecycle ownership.

Management state version 3 stores global provenance in `skills` and per-Agent
`assigned + extension` bindings in `agents`. `assigned` is internal terminology; UI describes the
Agent as enabled for the Skill. Per-Agent environment, runtime, and script override state remains
independent even when Agents share a package root. Secret-bearing environment values stay in the
binding; Tape records only its opaque `runtimeBindingId` revision.

Legacy `<skillsRoot>/.agent-scopes/<agentId>/` directories and the historically named
`.library-migration-v3` recovery directory are migration evidence only. Runtime discovery never
uses them after migration.

## Catalog and runtime

```text
AgentCatalog(agentId)
  = AvailableGlobalSkills intersect EnabledBindings(agentId)

EffectiveSessionSkills(sessionId)
  = PersistedSessionSelection intersect AgentCatalog(Session.agentId)
```

The derived Agent catalog authorizes Skill list/view/manage tools, prompt assembly, allowed tools,
scripts, and filesystem roots. The global `skills.listAll` management result never grants Agent
access.

The runtime applies the bounded progressive-disclosure contract from
[Skill Progressive Disclosure](../../architecture/skill-progressive-disclosure/spec.md) to that
derived catalog:

- Route renders bounded deterministic cards from enabled Skills only;
- Discover searches and paginates the same bounded catalog;
- message and Session activation materialize effective content into Tape; and
- `skill_view` and `skill_run` bind provider-visible content and execution to the same
  request-scoped package evidence.

A Run snapshots effective names, content identity, and executable package authority at start.
Transfer, rebind, fork, and Subagent creation recompute the destination Agent intersection. Direct
ACP compatibility receives bounded Route metadata but never local full Skill bodies without
DeepChat Tape authority.

An Agent-binding change affects later Runs. A Skill already authorized in the current Run remains
viewable and executable from that Run snapshot, even if the binding is removed concurrently.

## Operations

- Adding an Agent validates a live DeepChat Agent and available Skill.
- Removing an Agent retains extension state and filters affected persisted Session selections.
- Shared edits show currently enabled Agent impact.
- Shared deletion revalidates acknowledged Agent IDs, moves content to a recovery backup, removes
  bindings and Session selections, commits state, then removes the backup.
- Public and CLI Agent-scoped enable/disable or uninstall remain compatibility operations mapped to
  binding changes rather than package deletion.
- Agent deletion removes only that Agent's bindings.

All package and binding mutations pass through one main-process mutation gate. Package replacement
uses staging, validation, containment, recoverable rename, and rollback.

File-watcher deletion is not a package mutation. It only invalidates an exact cached manifest that
is still absent and retains provenance, bindings, extension configuration, and runtime binding
identity. This makes ordinary atomic editor saves transparent. Only the explicit delete operation
and startup reconciliation remove persistent state.

## Import and interoperability

The primary Skills action is `Import from external Agent`. Internal DeepChat Agents are not
sources because all DeepChat Agents already reference the same global Skills.

External import accepts a supported tool ID, selected Skill names, conflict strategies, and
acknowledged overwrite impact. It does not accept target Agent IDs and does not enable an Agent.
Main re-scans the source and recomputes conflicts at execution time; renderer paths are never
authoritative.

Conflict states are `ready`, `same`, `conflict`, and `unavailable`. Rename is the default. `same`
keeps existing content and Agent bindings. Overwrite requires the current enabled-Agent impact.
Partial failures are returned per Skill.

Sync directory is a secondary view reached from the Skills page. It imports and exports packages,
never Agent bindings, and provides an explicit return to the default Skills list. Pending writes
block both that return action and route navigation until their result is visible.

## Migration

Startup migration from versions 1 and 2:

1. treats existing global packages as canonical;
2. compares complete private-package snapshots;
3. deduplicates identical packages and renames different variants;
4. journals and validates copies before canonical renames;
5. translates disabled state and extensions into Agent bindings;
6. remaps DeepChat Agent Session selections;
7. leaves ACP and orphaned Sessions untouched; and
8. commits version 3 only after package commits succeed.

The journal itself is written to a sibling temporary file and atomically renamed into place before
canonical package renames begin.

Version 3 development state using the former `library` property is decoded into `skills` before it
is written again.

## UI contract

```text
Skills
+----------------------------------------------------------+
| Suggest Skill Drafts                               [off] |
+----------------------------------------------------------+
[Search] [Sync directory] [Import from external Agent]

[Skill card] [Skill card] [Skill card]

Open Skill
┌──────────────────────────────────────────────────────────┐
│ Enabled Agents                           [+ Add Agent]   │
│ [DeepChat ×] [Writer ×]                                 │
│                                                         │
│ Skill content preview                    [Edit] [Delete] │
└──────────────────────────────────────────────────────────┘
```

The Plugins-hub Skills route renders the same global surface. Loading, empty, error, retry,
stale-impact, partial-result, keyboard, focus, and dirty-close states use existing UI primitives
and vue-i18n copy. Unsaved preview edits require an explicit discard decision before route
navigation. Background catalog refreshes use that same decision before closing a removed Skill.
The Settings window has no Skills navigation item or route. Settings-to-main onboarding
continuation uses typed IPC and a typed runtime event rather than window-local storage.
