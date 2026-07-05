# Skill Adopt Name Mismatch

## User Need

Adopting an agent-owned skill should work when the skill folder name differs from the
`name` field inside `SKILL.md`, including when that frontmatter name is not a valid DeepChat slug.

## Goal

Allow agent skill adoption to use the agent entry name as the DeepChat target name and rewrite the
copied `SKILL.md` frontmatter during adoption.

## Acceptance Criteria

- Previewing adoption no longer fails only because `SKILL.md` `name` differs from the agent skill
  directory name.
- Previewing adoption no longer fails only because the unused `SKILL.md` `name` is not a valid
  DeepChat target name.
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

## Fix Plan

- Treat the scanned agent entry name as the source of truth for adoption target naming.
- Validate only the target name that DeepChat will write.
- Keep requiring a description in `SKILL.md`.

## Tasks

- [x] Stop validating the unused source frontmatter name.
- [x] Cover invalid source frontmatter names in adoption preview tests.

## Validation

- `pnpm vitest run test/main/presenter/skillSyncPresenter/index.test.ts`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
