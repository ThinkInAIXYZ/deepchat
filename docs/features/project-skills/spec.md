# Project Skills

## Contract

DeepChat discovers skills in the current workspace without importing them into the shared skill
library. Composer suggestions, the skill picker, system prompt routing, `skill_list`, `skill_view`,
active skill validation, and execution snapshots use the same workspace scope. Sessions without a
project keep their existing behavior. ACP agents continue to own their external command catalogs.

## Discovery and precedence

Only the selected workspace is searched, under `.agents/skills`, `.deepchat/skills`, `.claude/skills`,
`.codex/skills`, and `.cursor/skills`, in that order. The existing SKILL.md parser and bounded folder
traversal are reused. No ancestor search, arbitrary repository crawl, or external-agent import occurs.
Missing roots and malformed skills are skipped. Symbolic links cannot escape the selected workspace
or a skill package. The first project skill with a given name wins; project skills override shared
skills of the same name within that workspace only.

Project catalogs are read on workspace selection, window focus, and runtime resolution. Requests
carry explicit scope; no process-wide current project is mutated. Late UI responses cannot replace
the catalog for another workspace. Project skills are never added to global assignments, exported,
uninstalled, or edited by skill-management operations. Switching workspace clears pending composer
skill selection.

## Ownership and interfaces

SkillService owns discovery and composition. Its catalog APIs accept optional workspace context;
runtime callers pass a session ID and resolve the persisted project directory through the main
process session port. The renderer catalog route accepts an optional absolute workspace path for
composers that do not yet have a session. ChatInputBox shares useSkillsData's effective catalog with
both the picker and slash suggestions. Existing IPC and presentation primitives remain in place.

A project skill carries its project root and `project` source type. Its immutable materialization
records its actual skill root, content, and script package using existing Tape contracts. Project
skills use default runtime configuration and never inherit a same-named shared skill's environment,
script overrides, or plugin ownership. Existing execution permission checks remain authoritative.

## Acceptance

- A valid project SKILL.md appears in both composer entry points and can be selected and loaded.
- Two workspaces may contain different skills with the same name without mixing content.
- A project skill can override a shared name without changing shared assignments or credentials.
- Runtime routing, skill views, support files, and script snapshots resolve the project source.
- Removing a skill or changing workspace is reflected on refresh; malformed files and escaping
  symlinks do not expose arbitrary files or prevent valid skills from being listed.
- Global skill management and sessions without a workspace retain their existing behavior.

## Non-goals

Recursive ancestor discovery, additional settings, project skill editing/import/export, and new
filesystem watchers are outside this capability.
