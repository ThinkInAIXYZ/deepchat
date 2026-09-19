---
name: feishu-tools
description: Use the Feishu/Lark plugin MCP tools for Feishu documents, spreadsheets, knowledge content, and other matching workspace operations.
metadata:
  deepchatFeature: feishu-integration
---

# feishu-tools

This plugin is an MCP server tool surface exposed by DeepChat's Feishu plugin. Do not ask the user to classify the plugin as an MCP server, a CLI tool, or another plugin type. When a request is about Feishu/Lark content and matching tools are available, invoke the relevant tool directly.

## Runtime Context

- Plugin id: `${OWNER_PLUGIN_ID}`.
- Plugin root: `${PLUGIN_ROOT}`.
- Server id: `feishu-tools`.

## When To Use

- The user asks to read, summarize, search, create, update, append to, or organize Feishu/Lark
  documents.
- The user asks to inspect or edit Feishu/Lark spreadsheets, sheets, tables, or similar structured
  workspace data.
- The user asks to operate on another Feishu/Lark artifact and the current tool list exposes a
  matching tool by name or description.

## Required Behavior

1. Treat the currently exposed `feishu-tools` MCP tools as the primary action surface for Feishu/Lark requests.
2. Use the live tool names and descriptions in the current session as the source of truth for what
   the server supports.
3. Prefer the matching tool directly instead of asking the user how to call the plugin or what kind
   of plugin it is.
4. When the user provides a Feishu/Lark URL, extract the relevant document, sheet, spreadsheet, or
   workspace identifier when the target tool expects an id or token.
5. For write operations that could overwrite or append content, confirm intent only when the target
   artifact or requested mutation is ambiguous or destructive.
6. If the requested operation has no matching currently exposed tool, explain that the active
   Feishu preset may not include it and describe the gap.
7. If a tool call returns an authentication or configuration error, tell the user to open the
   Feishu plugin settings and verify App ID, App Secret, brand, and preset.

## Routing Hints

- For documents, prefer tools whose names or descriptions reference docs, docx, wiki, or knowledge.
- For spreadsheets or tables, prefer tools whose names or descriptions reference sheets,
  spreadsheets, tables, or bitable-like structures.
- For task, calendar, or IM requests, prefer the matching domain-specific Feishu/Lark tools when
  they are exposed by the current preset.

## Important Constraint

Tool availability depends on the current Feishu preset. The skill should guide tool choice, not
invent unsupported tool names.
