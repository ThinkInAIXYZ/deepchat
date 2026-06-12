# Import Recipes

Use this reference when turning DeepChat data into an importer or migration tool.

## Minimal Read-Only Export

1. Locate and snapshot `agent.db`.
2. Open it with the flow in `sqlite-access.md`.
3. Read provider config from `providers`, `provider_models`, `model_status`, and `model_configs`.
4. Read sessions with:

```sql
SELECT ns.*, ds.*
FROM new_sessions ns
LEFT JOIN deepchat_sessions ds ON ds.id = ns.id
WHERE ns.session_kind = 'regular'
ORDER BY ns.updated_at DESC, ns.id DESC;
```

5. Read messages per session:

```sql
SELECT *
FROM deepchat_messages
WHERE session_id = ?
ORDER BY order_seq ASC, id ASC;
```

6. Hydrate user messages from `deepchat_user_messages`, `deepchat_user_message_files`, and
   `deepchat_user_message_links`.
7. Hydrate assistant messages from `deepchat_assistant_blocks`; fall back to parsing
   `deepchat_messages.content`.
8. Export to the target app's format, redacting secrets unless the user explicitly chooses to
   include them.

## Provider Config Import

When importing providers into another tool, preserve:

- provider id, name, API type, base URL, enabled flag, custom flag.
- API key and OAuth token only with explicit user consent.
- capability provider id for model capability lookup.
- model rows from `provider_models`, split by `source`.
- enabled/disabled state from `model_status`.
- model config from `model_configs.config_json`.

Do not rely only on `provider_json`; DeepChat deliberately stores common scalar fields in columns
for queryability and migration.

## Session And Message Import

Recommended target shape:

```json
{
  "session": {
    "id": "session-id",
    "title": "Session title",
    "agentId": "deepchat",
    "projectDir": "/path/to/project",
    "providerId": "openai",
    "modelId": "gpt-4.1",
    "createdAt": 1770000000000,
    "updatedAt": 1770000000000
  },
  "messages": [
    {
      "id": "message-id",
      "orderSeq": 1,
      "role": "user",
      "status": "sent",
      "content": {
        "text": "hello",
        "files": [],
        "links": [],
        "search": false,
        "think": false
      },
      "metadata": {},
      "createdAt": 1770000000000,
      "updatedAt": 1770000000000
    }
  ]
}
```

For assistant messages, keep the assistant block array when possible instead of flattening to text.
Tool calls, tool responses, reasoning blocks, image data, action prompts, and error blocks may all
be represented as assistant blocks.

## Handling Partial Or Old Rows

- If structured user rows are missing, parse `deepchat_messages.content`.
- If structured assistant blocks are missing, parse `deepchat_messages.content`.
- If `new_sessions` is missing but `conversations` exists, import through the legacy path.
- If `agent.db` is missing and `chat.db` exists, open `chat.db` as legacy data.
- If a column is missing, check `schema_versions` and use the nearest fallback rather than failing
  the whole import.

## Writing Back Into DeepChat

Avoid third-party direct writes to a user's live DeepChat database.

If a tool must generate data for DeepChat:

- Prefer creating an export file or backup package that DeepChat can import through its own code.
- If implementing inside DeepChat, use Presenter/table helpers instead of raw SQL.
- If writing a copied database for controlled migration tests, use one transaction per session and
  keep table groups consistent:
  - `new_sessions`
  - `deepchat_sessions`
  - `deepchat_messages`
  - structured user or assistant tables
  - optional search, trace, usage, pending input, and tape rows
- Keep `deepchat_messages.content` compatible even when structured tables are populated, because it
  remains the fallback path.
- Do not update `database-security.json` manually after rekeying; use DeepChat's migration flow.

## Secret Handling Checklist

Redact or require explicit opt-in for:

- `providers.api_key`
- OAuth tokens in `providers.provider_json`
- MCP server `env` and custom headers
- `app_settings` rows marked `sensitive = 1`
- `deepchat_message_traces.headers_json` and `body_json`
- file paths in user message files
- chat content, system prompts, summaries, and project paths

## Useful Consistency Checks

Run these after import from a copied database:

```sql
PRAGMA quick_check;

SELECT COUNT(*) FROM new_sessions;
SELECT COUNT(*) FROM deepchat_sessions;
SELECT COUNT(*) FROM deepchat_messages;

SELECT m.session_id
FROM deepchat_messages m
LEFT JOIN new_sessions s ON s.id = m.session_id
WHERE s.id IS NULL
LIMIT 20;
```

For encrypted databases, validate the password before any import work:

```sql
SELECT name FROM sqlite_master LIMIT 1;
```
