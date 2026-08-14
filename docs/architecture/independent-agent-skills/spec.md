# Independent Agent Skills (Historical)

Status: superseded by [Shared Skills](../shared-skills/spec.md).

The former design gave each manual DeepChat Agent a physical package root under
`<skillsRoot>/.agent-scopes/<agentId>/` and copied Skills between Agents. That model is no longer a
runtime or product contract.

Current behavior stores mutable packages once in the global Skills set and gives each Agent logical
bindings and extension state. Internal Agent-to-Agent import, private-root CRUD, and link-repair
management surfaces have been removed. External Agent interoperability remains a validated
one-time snapshot import into global Skills.

Legacy private roots are retained only as version 2 migration evidence. Version 3 migration
deduplicates equal packages, gives different same-name variants globally unique names, preserves
per-Agent extension configuration, remaps Session selections, and excludes `.agent-scopes` from
runtime discovery.

The independent parts of the wider Agent architecture remain current: Agents do not inherit
configuration from the built-in Agent, Sessions are bound to explicit Agent IDs, and transfer,
fork, or Subagent creation recomputes the destination Agent's effective capabilities.
