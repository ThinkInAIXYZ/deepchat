# Search FTS Fallback Contract

Status: accepted for implementation

Task: `SEA-001`

Finding: `P-09`

## 问题

`AgentSessionPresenter.searchHistory()` 当前把三种不同事实都压成 `[]`：

1. FTS 正常执行但没有命中；
2. FTS table/triggers 不可用；
3. FTS query 抛错。

caller 随后先扫 normalized search documents 的 `%LIKE%`，仍无 hit 时再扫 `new_sessions` 和
`deepchat_messages`。所以 FTS 健康、normalization 已完成的普通 negative query 反而走最重路径；真正的 FTS
throw 却直接向外抛错，没有进入历史设计要求的 fallback。

这不是“LIKE 一定不该存在”。normalization 未完成时，raw tables 仍是覆盖旧数据的正确性 fallback；FTS5
不可用时，complete normalized documents 上的 LIKE 也是必要兼容路径。问题是缺少状态和完成度判断。

## 已有真源

- FTS capability：`DeepChatSearchDocumentsTable` 已能检查 compatible external-content FTS table；本任务把
  trigger completeness 也纳入 availability。
- corpus completeness：`configTables` 已持久化
  `sqlite-mainline-normalization-v1.status = completed|running|failed`。Presenter 只缓存这份持久化状态，并在
  normalization owner 写入 running/completed/failed 时同步更新；不新增第二份 migration state，也不在每次
  Spotlight 输入时重复读取数据库。
- normalized documents：`deepchat_search_documents`。
- legacy correctness fallback：`new_sessions` + `deepchat_messages` raw LIKE。

数据库同步导入是同一进程内的额外状态边界：overwrite 会替换 active database；increment 可能只新增 raw
`new_sessions`/`deepchat_messages`，却保留旧的 `completed` key。后者必须由 import owner 删除现有 completion
marker 并同步 Presenter cache；只在 reopen 后重读旧 key 仍会把 incomplete corpus 误判为 complete。
数据库 close 前还必须 suspend 当前进程内的 normalization generation；旧 worker 在 yield/final write 前发现
generation 已变化就退出，不能在 reopen 后把旧库扫描结果写成新库的 `completed`。该 generation 只做进程内
stale-worker fence，不是第二份持久化真源。

## 状态契约

`searchFts()` 改为内部 discriminated result：

```ts
type DeepChatFtsSearchResult =
  | { kind: 'available'; rows: DeepChatFtsSearchRow[] }
  | { kind: 'unavailable' }
```

本地 SQLite query 真正 throw 时仍 throw；Presenter 在 owner 边界捕获并进入 structured LIKE。不得按 error
message 分类，不把错误字段跨 IPC。

### Corpus complete

| FTS state | FTS result | 行为 |
| --- | --- | --- |
| available | hits | 映射、去重、排序并返回 |
| available | zero | 直接返回 `[]`；不调用 structured/raw LIKE |
| unavailable | — | structured LIKE；zero 直接返回 `[]`，不扫 raw tables |
| query throws | — | structured LIKE；zero 直接返回 `[]`，不扫 raw tables |

complete normalized corpus 是 authority。structured rows 即使因 stale/corrupt reference 全被过滤，也不把普通
query 扩大成 raw scan；数据一致性修复另立任务。

### Corpus incomplete / missing / running / failed

| FTS state | Structured result | 行为 |
| --- | --- | --- |
| available | hits | 保持现有渐进可用行为，返回 structured hits |
| available | zero | 再试 structured LIKE；仍 zero 才扫 raw tables |
| unavailable | hits from structured LIKE | 返回 structured hits |
| unavailable | structured LIKE zero | 扫 raw tables |
| query throws | structured LIKE hit/zero | hit 返回；zero 扫 raw tables |

本任务不尝试 merge structured + raw ranking；这会改变已有排序/去重语义并扩大范围。normalization incomplete
时只保留现有“structured 有结果就先返回，否则 raw”的兼容行为。

## FTS availability

`isFtsAvailable()` 必须同时满足：

1. 没有被初始化流程标记 unavailable；
2. FTS table 是 compatible FTS5 external-content table；
3. insert/delete/update 三个同步 trigger 全部存在。

缺 trigger 不是“FTS 仍可用但稍旧”；继续把 zero 当 authority 会漏掉新写入，因此必须降级到 structured LIKE。

## 影响

| 维度 | Before | After |
| --- | --- | --- |
| 健康 negative query | FTS zero → structured LIKE → raw LIKE | FTS zero → `[]` |
| FTS unavailable | 被编码成空数组，caller 无法区分 | typed unavailable → structured LIKE |
| FTS query throw | 整个 search reject | owner 捕获 → structured LIKE |
| incomplete normalization | 重 fallback 仍存在 | 保留，直到 corpus completed |
| 用户结果 | 正常 hit/ranking 不变 | negative query 不再付出无意义全表扫描 |

## 非目标

- 不新增 cooldown、telemetry framework、background repair 或第二个 search service；
- 不修改 Spotlight debounce、route schema、renderer UI、ranking 或 snippet；
- 不把 raw LIKE 删除；
- 不修 FTS corruption/rebuild、normalization worker 或 search index schema；
- 不增加 E2E。准确性由 Presenter state matrix 和 real SQLite table tests 证明。

## 实施

1. `DeepChatSearchDocumentsTable.searchFts()` 返回 available/unavailable union。
2. `isFtsAvailable()` 同时检查 compatible table + triggers。
3. Presenter 读取现有 normalization status，按状态矩阵选择 FTS/structured LIKE/raw LIKE。
4. 保留现有 structured hit 映射、去重、rank/updatedAt 排序。
5. 补反例测试：complete zero 不调用任何 LIKE；unavailable/throw 进入 structured fallback；incomplete zero 才
   进入 raw；real SQLite 验证 available zero 与 missing trigger unavailable。
6. active database overwrite/reopen 后重读同一 completion key；increment/legacy import 新增 raw history 后删除该
   marker 并同步 cache。历史 raw fallback 立即保证正确性，normalization 由既有 backfill owner 后续重建。
   legacy import 已经 completed 时返回的是历史累计数，不代表本次新增数据，不得据此反复失效 marker。
7. close/reopen 前推进 process-local generation；旧 normalization worker 在 batch yield 和 terminal write 前检查
   generation，禁止跨 database identity 提交 completion。

## 验收

- complete + FTS available zero：`searchLike=0`、raw `prepare=0`；
- complete + FTS unavailable/throw：structured LIKE 调用 1 次，zero 时 raw `prepare=0`；
- incomplete + FTS zero：structured LIKE 1 次，zero 时 raw session/message 各 1 次；
- available/unavailable/hit output 是 exhaustive union，无 `as`/message substring 分支；
- real SQLite 缺任一 trigger 时 availability=false；fresh table zero 是 available result；
- real SQLite test 纳入现有 `test:main:native-sqlite` 显式原生验证入口；
- overwrite/reopen 重读新库 marker；increment/legacy import 新增 raw history 时 marker 被删除，搜索立即回到
  incomplete fallback；
- database identity 切换后，旧 generation worker 不写 running/completed/failed；
- existing hit/ranking、blank query、route contract tests 保持通过；
- `typecheck:node`、format、i18n、lint、targeted tests、diff check 通过；不跑 full/E2E；
- 无 `[NEEDS CLARIFICATION]`。
