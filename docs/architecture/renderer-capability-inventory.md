# Renderer Capability Inventory

- 生成日期：2026-01-21
- 统计范围：`src/renderer/src/stores/*.ts` 与 `src/renderer/src/composables/**/*.ts`
- 方法：扫描 `@/` 别名的静态 import（包含动态 `import()`），未解析相对路径导入。

## 摘要

- 文件总数：140
- Store 数量：31
- StoreService 数量：24
- Adapter 数量：35
- Lifecycle 数量：11
- 可能未被引用（import_count=0）：8

## 按域统计（初步推断）

| 域 | 数量 |
| --- | --- |
| chat | 23 |
| settings | 17 |
| model | 13 |
| mcp | 10 |
| search | 9 |
| misc | 8 |
| artifact | 6 |
| dialog | 5 |
| provider | 5 |
| floating-button | 4 |
| navigation | 4 |
| ollama | 4 |
| sync | 4 |
| upgrade | 4 |
| window | 4 |
| workspace | 4 |
| yo-browser | 4 |
| notification | 3 |
| skills | 3 |
| config | 2 |
| acp | 1 |
| file | 1 |
| rate-limit | 1 |
| reference | 1 |

## 未被引用文件（前 30 个）

说明：以下清单仅基于 `@/` 别名 import 的静态扫描，可能存在误报。

- `stores/prompts.ts`
- `stores/shortcutKey.ts`
- `stores/systemPromptStore.ts`
- `composables/message/types.ts`
- `composables/notifications/types.ts`
- `composables/useFloatingButtonStoreLifecycle.ts`
- `composables/useFontManager.ts`
- `composables/useSyncStoreLifecycle.ts`

## 能力清单（待确认）

以下为基于当前域划分的候选能力集合，请标记“必须保留/可选/删除”：

- Chat & Message
- Chat Input & Composer
- Model & Provider
- MCP & Tools
- Workspace & Artifacts
- Search & Retrieval
- Navigation & Layout
- Settings & Preferences
- Shell & Windowing
- Sync & Upgrade
- Notifications & Dialogs
- Skills
- Others (yo-browser / floating-button / rate-limit / file)

## 明细文件

详见：`docs/architecture/renderer-capability-inventory.csv`
