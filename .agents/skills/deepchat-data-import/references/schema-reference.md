# Schema Reference

Use this reference when extracting provider config, settings, sessions, and messages from
`agent.db`. Verify against `sqlite_master` for user databases created by newer DeepChat versions.

## Core Version Tables

- `schema_versions`: applied migration versions. Read `MAX(version)` to understand how far the DB
  has migrated.
- `config_migrations`: config storage migrations, including the SQLite config migration marker.

## Provider And Config Tables

### providers

Primary provider rows.

Important columns:

- `id`: provider id.
- `name`: display name.
- `api_type`: provider API adapter type.
- `api_key`: sensitive API key. Redact by default.
- `base_url`: configured endpoint.
- `enabled`: `1` when provider is enabled.
- `custom`: `1` for custom providers.
- `capability_provider_id`: catalog provider used for capabilities, nullable.
- `sort_order`, `last_used_at`, `created_at`, `updated_at`: ordering and timestamps.
- `provider_json`: JSON for the rest of `LLM_PROVIDER`, excluding model arrays and enabled/disabled
  model lists.

To reconstruct a provider object, parse `provider_json`, then overlay scalar columns:

```ts
{
  ...JSON.parse(row.provider_json || '{}'),
  id: row.id,
  name: row.name,
  apiType: row.api_type,
  apiKey: row.api_key,
  baseUrl: row.base_url,
  enable: row.enabled === 1,
  custom: row.custom === 1,
  capabilityProviderId: row.capability_provider_id
}
```

### provider_models

Provider and custom model catalog rows.

- Primary key: `(provider_id, model_id, source)`.
- `source`: `provider` or `custom`.
- `model_json`: JSON for `MODEL_META`; overlay `model_id`, `provider_id`, `name`, `group_name`,
  and `isCustom`.

### model_status

Per-model enabled state. `status_key` is the primary key; rows also include `provider_id`,
`model_id`, `enabled`, and `updated_at`.

### model_configs

Per-model generation config.

- `cache_key`: primary key used by DeepChat config helpers.
- `provider_id`, `model_id`, `source`: denormalized lookup fields.
- `config_json`: JSON for model config values such as temperature, context length, reasoning,
  search, image generation, video generation, or TTS options.

### mcp_servers, mcp_settings, agent_settings, app_settings

- `mcp_servers`: MCP server configs by `name`, with `config_json`, `sort_order`, and timestamps.
- `mcp_settings`: JSON key/value settings for MCP behavior.
- `agent_settings`: JSON key/value settings for agent behavior.
- `app_settings`: JSON key/value settings, with `sensitive` flag. Current sensitive config such as
  prompts, knowledge config, hooks, remote control, and API-like settings may live here.

`mcp_servers.config_json`, MCP env values, and `app_settings.value_json` can contain secrets.

## Current Session And Message Tables

DeepChat's current mainline session model is split across a thin registry and agent-specific data.

### new_sessions

One row per visible session or subagent session.

Key columns:

- `id`: session id.
- `agent_id`: agent implementation id. DeepChat chat sessions normally use the DeepChat agent id;
  ACP sessions use ACP-oriented ids.
- `title`: sidebar title.
- `project_dir`: nullable project/workspace path.
- `is_pinned`, `is_draft`: booleans as integers.
- `active_skills`, `disabled_agent_tools`: JSON arrays retained for compatibility.
- `subagent_enabled`: boolean as integer.
- `session_kind`: `regular` or `subagent`.
- `parent_session_id`, `subagent_meta_json`: subagent relationship data.
- `created_at`, `updated_at`: epoch milliseconds.

Related tables:

- `new_projects`: project path, name, optional icon, last access timestamp.
- `new_session_active_skills`: structured active skill rows.
- `new_session_disabled_agent_tools`: structured disabled tool rows.

### deepchat_sessions

DeepChat-specific session config. `id` matches `new_sessions.id`.

Important columns:

- `provider_id`, `model_id`: selected model.
- `permission_mode`: `default` or `full_access`.
- `system_prompt`, `temperature`, `context_length`, `max_tokens`, `timeout_ms`.
- `thinking_budget`, `reasoning_effort`, `reasoning_visibility`, `verbosity`.
- `force_interleaved_thinking_compat`: nullable boolean as integer.
- `image_generation_options_json`, `video_generation_options_json`: nullable JSON.
- `summary_text`, `summary_cursor_order_seq`, `summary_updated_at`: compaction summary state.

### deepchat_messages

Message timeline for a session.

- `id`: message id.
- `session_id`: references the session id.
- `order_seq`: monotonic ordering within session. Sort ascending for conversation order.
- `role`: `user` or `assistant`.
- `content`: JSON string fallback/materialized content.
- `status`: `pending`, `sent`, or `error`.
- `is_context_edge`: boolean as integer.
- `metadata`: JSON string.
- `created_at`, `updated_at`: epoch milliseconds.

Basic query:

```sql
SELECT *
FROM deepchat_messages
WHERE session_id = ?
ORDER BY order_seq ASC;
```

### Structured User Message Tables

Use these first for current rows; fall back to `deepchat_messages.content` if missing.

- `deepchat_user_messages`: `message_id`, `text`, `search_enabled`, `think_enabled`.
- `deepchat_user_message_files`: `message_id`, `ordinal`, `name`, `path`, `mime_type`, `size`,
  `metadata_json`.
- `deepchat_user_message_links`: `message_id`, `ordinal`, `url`.

Materialized user content:

```json
{
  "text": "user text",
  "files": [],
  "links": [],
  "search": false,
  "think": false
}
```

### Structured Assistant Blocks

Use `deepchat_assistant_blocks` first for assistant messages. It is especially important for
pending or recently streamed messages.

Columns:

- `message_id`, `block_index`: primary key.
- `block_type`, `status`, `text_content`.
- `tool_call_id`, `tool_name`, `tool_params`, `tool_response`.
- `action_type`.
- `image_mime_type`.
- `reasoning_start_at`, `reasoning_end_at`.
- `extra_json`: includes block id, timestamp, image data, tool call extras, and reasoning time.
- `updated_at`.

Sort by `(message_id, block_index)`. If no structured blocks exist, parse
`deepchat_messages.content` as the fallback assistant block array.

### Event, Search, Trace, And Usage Tables

These are useful for richer import but optional for basic chat history.

- `deepchat_tape_entries`: append-only reconstruction/event facts per session.
- `deepchat_pending_inputs`: queued or steer-mode pending input payloads.
- `deepchat_search_documents` and FTS shadow tables: derived search index.
- `deepchat_message_search_results`: web/search results associated with messages.
- `deepchat_message_traces`: provider request traces. Treat as highly sensitive.
- `deepchat_usage_stats`: token/cost usage by message, provider, model, and date.

## Legacy Compatibility Tables

Current DeepChat keeps legacy tables for compatibility and import.

### conversations

Legacy conversation metadata. The business id is `conv_id`; `id` is an autoincrement row id.

Important columns include `title`, `provider_id`, `model_id`, generation settings, search settings,
`context_chain`, `active_skills`, parent fork fields, `created_at`, and `updated_at`.

### messages

Legacy message timeline.

- `msg_id`: business id.
- `conversation_id`: references `conversations.conv_id`.
- `parent_id`: tree/variant parent.
- `role`: `user`, `assistant`, `system`, or `function`.
- `content`: message content.
- `order_seq`: timeline order.
- `metadata`, `token_count`, `status`, `is_context_edge`, `is_variant`.

### message_attachments

Legacy attachments by `message_id`, `type`, and serialized `content`.

Prefer `new_sessions` and `deepchat_*` for current imports. Use legacy tables or `chat.db` only when
`agent.db` is missing, an old backup is imported, or the user explicitly wants legacy data.
