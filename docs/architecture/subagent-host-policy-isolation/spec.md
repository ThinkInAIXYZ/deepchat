# Subagent Host Policy Isolation

## User Need

When a parent DeepChat agent delegates work to a configured slot that targets another host agent,
the child session must not silently inherit the parent's full capability surface while writing
Memory and skills under the target agent identity.

## Goal

Make cross-agent subagent sessions resolve security-relevant policy from the **target host agent**,
while keeping intentional parent inheritance for workspace and model selection.

## Inheritance Matrix

| Field | `self` slot | Other target agent |
| --- | --- | --- |
| `agentId` / Memory | parent | target |
| `projectDir` | parent (same workdir rule) | parent (same workdir rule) |
| `providerId` / `modelId` | parent session | parent session |
| `permissionMode` | parent session | **target agent config** |
| `disabledAgentTools` | parent session | **target agent config** |
| `systemPrompt` | parent generation settings | **target agent config** |
| `activeSkills` | parent session pins | parent pins **∩ target `enabledSkillNames`** |
| Permission approvals | inherit non-MCP session approvals | **start clean** |
| MCP / plugins | runtime host policy (agentId) | runtime host policy (target agentId) |

## Acceptance Criteria

1. Self-target subagent sessions keep parent permissionMode, disabled tools, skills, and generation
   settings.
2. Cross-agent subagent sessions apply target permissionMode, disabled tools, and system prompt.
3. Cross-agent active skills are filtered by the target agent allow-list (`[]` means none).
4. Workdir remains the parent session workdir for both cases.
5. ACP subagent targets remain ACP-shaped (no DeepChat tool/skill inheritance).
6. Only self-target children inherit parent session approvals. Cross-agent children start with
   empty approval caches, and MCP temporary approvals are never cloned.

## Constraints

- No renderer/IPC schema change required beyond existing createSubagentSession fields.
- Do not enable nested subagents.
- Do not change run timeout / concurrency guardrails.

## Non-goals

- Bubbling child permission UI into the parent interaction queue (later UX slice).
- Per-child model overrides from target default model.
- Process-level isolation of MCP/plugin runtimes.
