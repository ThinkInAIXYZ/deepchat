# DeepChat Data Import Skill Plan

## Skill Shape

- Create `.agents/skills/deepchat-data-import/`.
- Keep `SKILL.md` as the trigger and workflow guide.
- Put detailed data and encryption documentation in one-level `references/` files:
  - `data-locations.md`
  - `sqlite-access.md`
  - `schema-reference.md`
  - `import-recipes.md`

## Source Of Truth

Derive the documented schema from:

- `src/main/presenter/sqlitePresenter/index.ts`
- `src/main/presenter/sqlitePresenter/connectionConfig.ts`
- `src/main/presenter/databaseSecurityPresenter/index.ts`
- `src/main/presenter/sqlitePresenter/tables/*.ts`
- `src/main/presenter/agentRuntimePresenter/messageStore.ts`
- `src/main/presenter/agentRuntimePresenter/sessionStore.ts`
- `src/main/presenter/configPresenter/**`

## Compatibility

- Treat `agent.db` as the primary database.
- Mention legacy `chat.db` and `conversations/messages` only as compatibility paths.
- Avoid promising that internal table schemas are permanent; tell developers to inspect
  `schema_versions` and `sqlite_master`.

## Validation

- Run the skill creator quick validator.
- Run repository formatting, i18n check, and lint after editing.
