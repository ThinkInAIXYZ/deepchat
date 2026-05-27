# DeepChat Data Import Skill Specification

## Goal

Create a repository-local Codex skill that helps third-party developers import DeepChat data safely
and accurately.

## User Stories

- As an integration developer, I can locate DeepChat's SQLite database and configuration metadata
  across supported platforms.
- As an integration developer, I can read provider, model, session, and message data from the
  current `agent.db` schema.
- As an integration developer, I can handle both unencrypted SQLite databases and SQLCipher
  encrypted databases.
- As an integration developer, I can decide whether to use Electron safeStorage, a user-provided
  SQLite password, or a platform-native credential path.

## Acceptance Criteria

- The skill is stored under `.agents/skills/` with valid `SKILL.md` frontmatter and
  `agents/openai.yaml` metadata.
- The skill links to focused reference files instead of embedding all schema and platform details in
  `SKILL.md`.
- The references cover provider config, model config, MCP/app settings, current session/message
  tables, legacy compatibility tables, and optional database encryption.
- The security guidance explains Electron, Tauri, and native macOS/Windows/Linux import options.
- The guidance favors read-only import, user consent, WAL-safe copies, and redaction of secrets.

## Non-Goals

- Do not add runtime import/export code to DeepChat in this change.
- Do not create sample applications for every framework.
- Do not define a stable public API beyond documenting the current database contract.

## Open Questions

None.
