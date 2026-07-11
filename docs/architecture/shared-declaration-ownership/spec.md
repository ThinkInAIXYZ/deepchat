# Shared Declaration Ownership

Status: accepted for implementation

Tasks: `DCL-001`, then `DCL-002`

Finding: `A-03`

## 问题

`src/shared/types/presenters/core.presenter.d.ts` 是迁移期 compatibility quarantine，不是应立即拆掉的错误。
真实问题是仓库自己的 declaration 默认被 `skipLibCheck` 跳过，已经累积 44 个 strict diagnostics：错误相对
路径、未导入 symbol、不存在的 export，以及 shared declaration 反向导入 main implementation。

## 约束

- 保留 `@shared/presenter` 和现有 broad compatibility export；本任务不拆 2,500+ 行 barrel。
- 不创建第二个 compatibility barrel。
- runtime/domain type 放回 shared owner；main 可以为旧 import path 做直接 re-export，但 shared 不得依赖 main。
- node 配置中的 `@/*` 整体指向 main；architecture guard 必须拒绝 shared 下所有 `@/*` import，不能只识别 presenter alias。
- 只修 repo-owned declaration diagnostics，不顺手重构 presenter runtime。
- `DCL-001` 让独立 strict declaration probe 为零；`DCL-002` 再把同一 probe 固化为常规脚本/CI gate。

## Owner 决策

| Contract | Owner | 决策 |
| --- | --- | --- |
| shortcut defaults/types | `src/shared/shortcutKeySettings.ts` | main config/shortcut presenter 改从 shared 引用 |
| sync import mode | `src/shared/types/sync.ts` | shared 定义 runtime enum；SQLitePresenter 保留兼容 re-export |
| MCP prompt/resource entry | `src/shared/types/core/mcp.ts` | chat 与 presenter compatibility type 共同引用 |
| lifecycle phase | `src/shared/lifecycle.ts` | declaration 显式 type import |
| Electron tab view | Electron `WebContentsView` | 删除不存在的 `BrowserView` 名称 |
| legacy message/search types | 现有 shared chat/thread owner | compatibility declaration 只 import/re-export，不再依赖 ambient symbol |

strict resolution 还暴露了此前被坏 declaration 隐式 `any` 掩盖的 consumer 边界。对应修复保持局部：remote
attachment 在进入 Agent `MessageFile` 前把内部 `Date` metadata 转为 ISO string；legacy `agent/function` provider
message role 在 Tape view manifest 中归一为 `null`，不写入不支持的 role；缺 provider identity 时不渲染 model
icon；legacy tool call 缺 name 时保持可序列化的空字符串。这里不改变 presenter ownership 或 UI 布局。

## 验收

- `src/shared/**/*.d.ts` 作为 roots、`skipLibCheck=false`、`composite=false` 时 diagnostics 为 0；
- shared source/declaration 不再 import `@/presenter/*` 或其他 main path；
- `@shared/presenter` 的现有 Shortcut、MCP、thread/search type imports 保持可解析；
- node/web typecheck、format、i18n、lint、architecture guard、diff check 通过；
- targeted declaration/shortcut/sync tests 通过；不跑 full/E2E；
- 无 `[NEEDS CLARIFICATION]`。
