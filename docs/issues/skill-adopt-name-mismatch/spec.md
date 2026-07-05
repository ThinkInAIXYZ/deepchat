# Skill Adopt Name Mismatch

## User Need

Adopting an agent-owned skill should work when the skill folder name differs from the
`name` field inside `SKILL.md`.

## Goal

Allow agent skill adoption to use the agent entry name as the DeepChat target name and rewrite the
copied `SKILL.md` frontmatter during adoption.

## Acceptance Criteria

- Previewing adoption no longer fails only because `SKILL.md` `name` differs from the agent skill
  directory name.
- Adoption keeps the agent-facing entry name as the default DeepChat target name.
- The copied DeepChat skill remains valid by rewriting `SKILL.md` `name` to the target name.
- Existing conflict rename behavior still works.

## Constraints

- Keep skill name safety validation.
- Do not change agent scan display behavior.
- Do not add new dependencies.

## Non-Goals

- Redesigning the skills settings UI.
- Changing external tool scan identity rules.
