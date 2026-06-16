# 侧边栏历史会话分页加载卡死

> Issue: [#1762](https://github.com/ThinkInAIXYZ/deepchat/issues/1762) `[BUG] 对话历史无法加载`
> 环境: Windows 11 / DeepChat v1.0.6-beta.5

## 背景

用户的数据库中存在 100+ 个 regular 会话（已用数据库修复功能确认数据完整、schema 正常），
但侧边栏只显示最近十几个会话，滚动到底部不触发"加载更多"，侧边栏搜索也找不到未加载的旧会话。
用户进一步反馈：在同一个 agent 下新建几个对话后，更早的旧对话也会从侧边栏消失。

## 根因

侧边栏分页存在两个相互叠加的缺陷：

1. **页槽被子代理会话浪费**
   侧边栏首屏与翻页请求 `listLightweight` 时传入 `includeSubagents: true`
   (`src/renderer/src/stores/ui/session.ts:512`、`:551`)，使后端一页 30 条结果里混入
   `session_kind = 'subagent'` 的会话；但显示层只渲染 regular 会话
   (`isRegularSession`，`session.ts:918`/`:930`)。一页 30 条里被子代理占用的名额会被直接过滤掉，
   导致界面可见的 regular 会话远少于 30。

2. **首屏未填满视口 → 无滚动条 → 永不触发加载更多**
   `performSessionListScrollCheck` 仅在 `scroll` 事件中调用
   (`src/renderer/src/components/WindowSideBar.vue:1102-1125`)。当首屏可见 regular 会话过少、
   列表内容高度 < 容器高度时，不存在可滚动空间，`scroll` 事件永不触发，
   `loadNextPage()` 永远不会被调用。缺少"加载后检测视口是否填满、未满则继续加载"的自动填充逻辑。

此外，侧边栏搜索 (`WindowSideBar.vue` `matchesSessionSearch`) 仅在已加载的 `sessions.value`
内存数组中按标题过滤，未接入后端 FTS 搜索，因此未加载的旧会话搜不到。

## 用户故事

- 作为用户，当我有上百个历史会话时，**滚动侧边栏应能持续加载更早的会话**，直到全部可见。
- 作为用户，**首屏应尽量填满可视区域**，而不是只显示十几条后就停住、且没有滚动条。
- 作为用户，在侧边栏搜索框输入关键词时，**应能命中未加载到前端的历史会话**（次要目标）。

## 验收标准

1. 数据库有 100+ regular 会话时，侧边栏首屏加载后内容高度应填满（或超过）列表容器高度，
   存在可滚动空间。
2. 滚动到列表底部（距底 ≤ 96px）时触发 `loadNextPage`，可持续翻页直到 `hasMore = false`，
   最终能展示数据库中的全部 regular 会话。
3. 当首屏返回的 regular 会话不足以填满视口、且 `hasMore = true` 时，应自动继续加载下一页，
   直到填满视口或无更多数据，无需用户手动滚动。
4. 侧边栏分页请求不再因子代理会话占用页槽而减少可见 regular 会话数量。
5. （次要）侧边栏搜索能命中数据库中未加载到前端的会话标题。
6. 现有 Vitest 套件（`test/main/**`、`test/renderer/**`）全部通过；新增针对分页/自动填充的回归用例。

## 非目标

- 不改动子代理会话本身的存储、级联删除、agent 迁移等业务逻辑
  （主进程 4 处 `includeSubagents: true` 走 `.list()`，与本修复无关，保持不变）。
- 不重构 cursor 分页协议（`updatedAt + id` 游标语义保持不变）。
- 不改变会话分组（time / project）与置顶逻辑。

## 约束

- 遵循 typed route / `renderer/api/*Client` 现有路径，不引入 legacy presenter 调用。
- 用户可见文案使用 i18n key。
- 兼容性：分页协议与已存储数据均不变，纯前端/查询行为修正，无数据迁移。

## 影响面评估（已核实）

- `isRegularSession`：仅 `session.ts` 3 处，全部用于侧边栏显示过滤，证明 store 无需子代理数据。
- `includeSubagents: true`：侧边栏分页 2 处需改；主进程 4 处（agent 迁移/删除/级联删/子会话判断）
  走 `.list()`，独立且必须保留；DB/契约/类型层为透传，改前端传 `false` 后 DB 正确启用
  `WHERE session_kind = 'regular'`。
- 其它 renderer 消费方（`spotlight.ts` 自身已 `.filter(sessionKind !== 'subagent')`）不依赖
  侧边栏 store 包含子代理会话。
- 现有测试无断言依赖侧边栏 `listLightweight` 携带子代理，改动安全。
