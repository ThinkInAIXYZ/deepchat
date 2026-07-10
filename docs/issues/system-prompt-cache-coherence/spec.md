# System Prompt Cache Coherence

- Status: proposed
- Date: 2026-07-10
- Task: `PRM-001`
- Audit finding: `P-07`
- Implementation slice: `PRM-002`

## 结论先行

先反驳一个容易得出的结论：问题不是“有两层 cache，所以删掉一层”，也不是把 `200ms`
改得更长。

两层 cache 分别解决真实问题，而且从代码历史能确认它们都是故意存在的：

- `systemPromptCache` 让同一 session 在输入未变化时复用当天已组装的 system prompt。
- `agentsInstructionsCache` 用 `200ms` 首读预算和 `30s` TTL 避免慢文件系统阻塞首轮消息，过期内容按
  stale-while-revalidate 方式在后台刷新。

真正的 bug 是两层 cache 没有共同的 revision contract。外层在调用 env builder 和加载 active skill
content 之前就可能返回，因此内层即使已经拿到新内容，外层也不知道。

本规格最终决定如下：

1. 保留两层 cache 和 `200ms` 首读预算。
2. `systemEnvPromptBuilder` 在每次外层 cache 判定前返回 `{ prompt, revision }` snapshot；`revision`
   是实际 env prompt 内容的稳定 digest，不使用 `mtime` 或 `Date.now()` 代替内容真相。
3. `SkillPresenter` 提供 process-lifetime、单调递增的 `skillRevision`。任何会改变 skill metadata、
   active skill rendered content 或 skill-derived tool availability 的成功变更，都必须推进该 revision。
4. 外层 `systemPromptCache` fingerprint 必须包含 `envRevision` 和 `skillRevision`；
   `toolProfileCache` fingerprint 也必须包含 `skillRevision`，避免 prompt 已更新但 `allowedTools` 仍旧。
5. 首轮因 `AGENTS.md` 超时而使用 fallback 后，不回滚或重启正在执行的 turn。late read 完成后，
   下一次开始组装 prompt 的 turn 必须看到新 revision 并重建 prompt。
6. 不新建通用 cache framework。改动留在现有 `systemEnvPromptBuilder`、`SkillPresenter` 和
   `AgentRuntimePresenter` 三个 owner 内。

## 用户可见问题

用户可能已经修改了项目 `AGENTS.md` 或一个已启用 skill 的 `SKILL.md`，DeepChat 内层也可能已经读到
新内容，但同一 session 的后续消息仍继续使用旧 system prompt。当前最坏情况会持续到以下任一条件发生：

- 手工触发 session prompt invalidation；
- provider、model、project dir、base prompt、active skill name 等现有 fingerprint 字段变化；
- 本地日期变化；
- session 被销毁或应用重启。

这不是单纯的“cache 命中率不理想”。模型可能在同一天内持续忽略用户刚写入的项目约束或 skill
指令，属于 prompt 正确性问题。

## 范围

本 issue 只定义 contract 和后续 `PRM-002` 的实施、测试边界；`PRM-001` 不改生产代码或测试。

覆盖：

- `AGENTS.md` 首次读取超过 `200ms`；
- 首次 timeout 后的 late result；
- `AGENTS.md` missing → present、present → changed、present → missing；
- 同名 skill 的 metadata、body、extension/runtime instructions 更新；
- `skillRevision` 对 composed prompt 和 skill-derived tool profile 的一致失效；
- unchanged revision 下继续命中外层 cache，避免把正确性修复变成每轮磁盘重读。

不覆盖：

- provider API 的 prompt caching 策略和 `prompt_cache_key`；
- system prompt 文案或 section 顺序重写；
- `AGENTS.md` 向父目录递归查找；当前 contract 仍只读取 resolved workdir 下的单个文件；
- 替换 skill watcher backend；
- module-global path cache 的容量治理；这是已知次级 lifecycle 问题，不与正确性修复捆绑；
- UI、IPC、数据库 schema 或持久化格式变更。

## 当前代码真相

### 1. 内层 `AGENTS.md` cache 确实允许 late result

[`systemEnvPromptBuilder.ts`](../../../src/main/lib/agentRuntime/systemEnvPromptBuilder.ts) 当前定义：

- `AGENTS_READ_BUDGET_MS = 200`、`AGENTS_CACHE_TTL_MS = 30_000`
  （[L22-L32](../../../src/main/lib/agentRuntime/systemEnvPromptBuilder.ts#L22)）。
- refresh Promise 完成后会把新 content 写回 module-global map
  （[L128-L143](../../../src/main/lib/agentRuntime/systemEnvPromptBuilder.ts#L128)）。
- 首次读取超过预算只返回 fallback，原 Promise 不会被取消
  （[L146-L171](../../../src/main/lib/agentRuntime/systemEnvPromptBuilder.ts#L146)）。
- 已有 entry 过期时，当前调用先返回旧 content，同时启动后台 refresh
  （[L174-L190](../../../src/main/lib/agentRuntime/systemEnvPromptBuilder.ts#L174)）。

因此内层行为不是“timeout 后丢弃结果”，而是明确的 stale-while-revalidate。

### 2. 外层 cache 在读取 env 和 active skill content 前返回

[`AgentRuntimePresenter.buildSystemPromptWithSkills()`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4634)
先收集 skill metadata/name，然后构造 fingerprint。当前 fingerprint 只包含：

- provider/model/workdir/base prompt；
- `skillsEnabled`；
- available/active skill names；
- agent tool 的 `server:name`；
- `skillDraftSuggestionsEnabled`。

对应代码见
[`buildSystemPromptFingerprint()`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L5095)。cache
命中后会在 [L4740-L4747](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4740) 直接返回。

active skill content 到 [L4769-L4789](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4769)
才加载，env builder 到 [L4791-L4804](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4791)
才调用。这证明外层 cache 会完全绕过内层 refresh 的观察点。

### 3. 同名 skill 更新只清内层 content cache

[`SkillPresenter.loadSkillContent()`](../../../src/main/presenter/skillPresenter/index.ts#L728) 以 skill name
作为 `contentCache` key，cache miss 时读取 `SKILL.md`，再拼接 runtime instructions
（[L740-L770](../../../src/main/presenter/skillPresenter/index.ts#L740)）。

当前已有多条正确的局部 invalidation：

- watcher 收到同一 `SKILL.md` update 时删除旧 content，并替换 metadata
  （[L2984-L3021](../../../src/main/presenter/skillPresenter/index.ts#L2984)）；
- `updateSkillFile()` 成功写入后删除 content cache
  （[L2423-L2439](../../../src/main/presenter/skillPresenter/index.ts#L2423)）；
- `saveSkillWithExtension()` 和 `saveSkillExtension()` 也删除对应 content cache
  （[L2446-L2501](../../../src/main/presenter/skillPresenter/index.ts#L2446)、
  [L2642-L2660](../../../src/main/presenter/skillPresenter/index.ts#L2642)）。

但是外层 fingerprint 只看 skill name。只要同名 skill 仍 active，下一 turn 会先命中
`systemPromptCache`，上述新 content 根本不会被再次加载。

### 4. available skill metadata 也可能同名漂移

skills metadata prompt 实际使用 `description`、`category` 和 `platforms`，但 fingerprint 只取
`normalizedAvailableSkills.map((skill) => skill.name)`
（[L4720-L4736](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4720)）。

因此不只是 active skill body；同名 skill 的描述、分类或平台限制变化，也可以被当天的 composed
prompt cache 屏蔽。

### 5. `skills.catalog.changed` 不是 main 内部 invalidation bus

Skill watcher 和 mutation 路径会调用 `publishDeepchatEvent('skills.catalog.changed', ...)`，但
[`publishDeepchatEvent()`](../../../src/main/routes/publishDeepchatEvent.ts#L32) 只把 typed envelope 发给
renderer windows。`AgentRuntimePresenter` 没有订阅这条 main-internal signal。

所以不能因为“已经 publish event”就推断 composed prompt cache 已失效；代码没有这条连接。

### 6. tool profile 是另一层相关 cache

[`resolveToolProfile()`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L6696) 的 fingerprint
包含 active skill names 和 `toolRegistryRevision`，但不包含 skill metadata revision
（[L6714-L6731](../../../src/main/presenter/agentRuntimePresenter/index.ts#L6714)）。

这意味着同名 skill 若只更新 frontmatter `allowedTools`，`SkillPresenter` 可以已经更新 metadata，
而 `toolProfileCache` 仍返回旧 tool definitions。`PRM-002` 必须让同一个 `skillRevision` 同时参与这两层
cache，不能只修 prompt 文本后留下 prompt/tool 不一致。

### 7. “完整 tool schema 缺 fingerprint”需要收窄表述

审计 P-07 提到 tool schema 未进入 composed prompt fingerprint。检查当前实现后，不能直接据此得出
“必须 hash 全部 MCP JSON schema”的结论：

- [`buildToolSystemPrompt()`](../../../src/main/presenter/toolPresenter/index.ts#L538) 当前主要依据 agent
  tool 的 name 和 server grouping 生成文字；
- provider 请求中的 tool definitions 由 `toolProfileCache` 单独持有；MCP registry event 会推进
  `toolRegistryRevision` 并清该 cache；
- composed prompt 当前没有复制完整 parameters schema。

因此本 issue 不要求把完整 tool schema hash 进 system prompt fingerprint。若将来
`buildToolSystemPrompt()` 开始读取 description/parameters，fingerprint 必须跟随“实际渲染输入”扩展，
而不是提前对所有 schema 付出 hashing 成本。

### 8. 现有测试没有跨两层验证

- [`systemEnvPromptBuilder.test.ts`](../../../test/main/lib/agentRuntime/systemEnvPromptBuilder.test.ts#L71)
  证明直接再次调用 builder 能看到 late content。
- [`agentRuntimePresenter.test.ts`](../../../test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts#L2501)
  证明同日复用、跨日失效、base prompt/project dir/active skill name 变化会失效。
- `agentRuntimePresenter.test.ts` 全局 mock 了 `buildSystemEnvPrompt`，因此这些测试没有执行真实
  `agentsInstructionsCache`。

缺失的是“真实外层 cache + 真实内层 late cache”的组合测试。

## 反常设计是否故意

结论是：两个局部行为都是故意的，但它们的组合后果没有设计依据。

| 历史证据 | 能确认的意图 | 不能推导的结论 |
| --- | --- | --- |
| commit `c86f1fb1` 引入 `systemPromptCache` 及同日复用、跨日失效测试 | 外层复用是有意行为 | 不能推导“env/skill 内容当天不可变” |
| historical `docs/specs/agent-tooling-v2/spec.md`（可用 `git show c86f1fb1:...` 查看）要求固定 section 顺序、避免实时 tab/process snapshot，同时明确包含 `AGENTS.md` 全文 | 稳定 prompt 指“不注入高频运行态快照” | 不能把用户修改的 instruction file 当成永不变化的静态值 |
| commit `4545791d` 的 historical `docs/issues/session-start-lag/spec.md` 明确要求慢 `AGENTS.md` 读取不阻塞首轮，stale content 后台 refresh，后续消息复用新内容 | `200ms` fallback 和 late refresh 是有意行为 | 不能推导 late result 可以被外层 cache 屏蔽到次日 |
| commit `b31e8f6c` 引入 skill watcher invalidation | skill hot reload 是有意行为 | 不能推导删除 `contentCache` 已自动删除 session composed prompt |

本地历史中没有找到定义这两层组合语义的文档或测试。结合上述相互冲突的明确目标，合理结论是
“cache coherence 漏接”，不是故意让 late instructions 当天失效。

## Root Cause

两个 cache owner 只暴露 value，没有暴露能参与上层 cache 判定的 revision：

```text
Turn 1
  AgentRuntime fingerprint (no env/skill revision)
    -> cache miss
    -> AGENTS.md read exceeds 200ms
    -> compose without instructions
    -> store day-level session prompt

Background
  AGENTS.md read settles
    -> inner path cache now has new content
    -> no session prompt invalidation or revision propagation

Turn 2
  same structural fingerprint
    -> outer cache hit
    -> env builder and skill content loader are skipped
    -> stale composed prompt survives
```

`30s` TTL 也不能自行修复：TTL 只有在再次调用 inner reader 时才会被检查，而外层 hit 正好阻止了这次
调用。

## 最终 contract

### A. `SystemEnvPromptSnapshot`

`systemEnvPromptBuilder` 增加 snapshot API；具体函数名可按现有命名调整，但语义固定为：

```typescript
interface SystemEnvPromptSnapshot {
  prompt: string
  revision: string
}
```

contract：

1. `revision` 是最终 `prompt` bytes 的稳定 digest。相同 prompt 必须得到相同 revision；任何实际
   prompt 变化必须得到不同 revision。
2. 不使用 `mtime`、file size 或 `Date.now()` 作为内容 revision。它们可用于避免不必要读取，但不能
   单独作为正确性依据。
3. 外层每次 cache 判定前都要获取 snapshot。fresh path cache 不重复读磁盘，也不重复向父目录扫描
   `.git`；只有首次读取或超过 `30s` TTL 才刷新这些 file-backed observations。
4. 首次没有可用 content 时最多等待 `200ms`。timeout 后返回 empty-instructions fallback，pending
   read 继续执行。
5. pending read 完成后只更新 source cache；不修改已经发给 provider 的 turn。下一 turn 获取到新
   snapshot revision 后重建 composed prompt。
6. stale entry refresh 时，当前 turn 允许继续使用 last-known-good content。若后台读到不同内容，
   后台完成后的下一 turn 必须使用新内容。
7. `ENOENT`/`ENOTDIR` 表示成功读取到“文件不存在”状态；present ↔ missing 必须改变 revision。
8. 其他 I/O error 不得覆盖 last-known-good content。首次读取失败时可以返回 empty fallback，但不能
   将失败伪装成成功 refresh；必须按有界 retry window 重试，禁止每个 turn 无间隔重读。
9. 多个 session 使用同一 resolved `AGENTS.md` path 时共享 pending read 和 source snapshot；revision
   不持有 session reference。

`envRevision` hash 最终 env prompt，因此自然覆盖当前 builder 实际渲染的 model display name、resolved
workdir、git state、platform、local date 和 `AGENTS.md` content。现有 `dayKey` 保留，既兼容当前测试，
也让日期失效意图保持直观。

### B. `skillRevision`

`SkillPresenter` 作为 skill metadata/content/watch lifecycle owner，提供同步、只读的 process-lifetime
revision。推荐形态：

```typescript
interface SkillRuntimeRevisionPort {
  getRuntimeRevision(): number
}
```

contract：

1. revision 从安全整数开始单调递增；应用重启后可重新开始，因为所有依赖它的 in-memory cache 同时
   清空。
2. 不使用 renderer event payload 中的 `Date.now()` version 代替。main runtime 必须直接从注入的
   `SkillPresenter`/narrow port 读取 revision。
3. 下列成功变更必须在新 metadata/content 对后续读取可见之后推进 revision：
   - discovery 结果替换；
   - install、uninstall、adopt、plugin skill register/unregister；
   - enable/disable；
   - `SKILL.md` watcher create/update/delete；
   - `updateSkillFile()`、`saveSkillWithExtension()`、`saveSkillExtension()`；
   - 会改变 rendered runtime instructions 的 script descriptor create/delete/rename 或 extension override。
4. 失败并完整 rollback 的 mutation 不推进 revision；rollback 失败且状态未知时必须推进 revision，强制
   后续 cache miss，并保留现有错误日志。
5. 单个 global revision 会让不相关 session 多重建一次 prompt/tool profile。skill 变更是低频操作，
   这里接受该成本，避免先引入 per-skill dependency graph。
6. watcher 启动失败时，外部编辑的 hot reload 仍遵循现有 degraded contract：在 watcher 恢复或显式
   discovery 前不保证被发现。watch root 之外的 plugin-contributed skill 也只在 plugin
   register/unregister 或显式 discovery 后保证推进 revision。DeepChat 自己的 mutation API 仍必须同步
   推进 revision。

### C. 外层 composed prompt cache

`AgentRuntimePresenter` 的 cache hit 条件变为：

```text
same dayKey
AND same structural fingerprint
AND same envRevision
AND same skillRevision
```

约束：

1. env snapshot 和 `skillRevision` 必须在 cache hit 判定前读取。
2. cache entry 记录使用的两个 revision，便于测试和 debug；日志不得输出 `AGENTS.md` 或 skill content。
3. active skill names 不变但 body/metadata/extension 变化时，`skillRevision` 变化必须阻止 outer hit。
4. revision 未变化时继续复用相同 composed prompt；修复不能退化为每 turn 重读所有 active
   `SKILL.md`。
5. 在 snapshot 获取后、cache set 前发生 late update 时，本 turn 可使用捕获到的旧 revision；下一
   turn 必须看到新 revision。不要为追求同一 turn 的线性化而阻塞 pending I/O。

### D. tool profile 一致性

`resolveToolProfile()` fingerprint 同样加入 `skillRevision`。理由不是所有 skill content 都改变 tool
schema，而是 `allowedTools` 与 metadata/content 共用 `SKILL.md` 变更入口。如果只刷新 prompt，可能出现
“新 skill 指令已经出现，但新允许的工具仍不可用”的半更新状态。

同一 pre-stream preparation 必须把一次捕获的 `skillRevision` 同时传给 tool profile 和 composed
prompt。两者完成后若 revision 已变化，丢弃这一组 cache candidate，并用最新 revision 做一次有界重建；
若重建期间仍持续变化，本 turn 可以使用最新完成的结果，但不得把已知不一致的结果写入长期 cache，
下一 turn 必须再次重建。不要用无限 retry 阻塞发送。

MCP 自身仍由 `toolRegistryRevision` 管理；不合并两种 revision owner。

## 可验证 acceptance criteria

- [ ] 使用真实 `AgentRuntimePresenter.buildSystemPromptWithSkills()` 和真实 env builder：首次
      `AGENTS.md` read 超过 `200ms` 时，首轮按时返回且不含 instructions；late read settle 后，同日、
      同 structural inputs 的下一轮包含新 instructions。
- [ ] late read 只触发一次 disk read；第二轮不为看到 late result 重读文件。
- [ ] `AGENTS.md` 从 A 改为 B：TTL 内允许继续使用 A；TTL 后首个 turn 触发 background refresh，
      refresh settle 后下一 turn 使用 B。
- [ ] `AGENTS.md` missing → present、present → missing 均按同一 revision contract 生效。
- [ ] 非 `ENOENT` I/O error 保留 last-known-good content；恢复后的成功读取可推进 revision。
- [ ] active skill name 不变、body 从 A 改为 B 后，下一 turn 的 `## Active Skills` 使用 B。
- [ ] 同名 skill 的 `description`、`category` 或 `platforms` 变化后，available skills 段更新。
- [ ] `saveSkillExtension()` 或 script descriptor 变化后，active skill runtime instructions 更新。
- [ ] 同名 skill 的 `allowedTools` 变化后，`toolProfileCache` miss 并重建 tool definitions。
- [ ] skill 在 pre-stream 期间变化时，tool profile 和 composed prompt 不会以两个不同的
      `skillRevision` 写入 cache；有界 retry 不会形成无限等待。
- [ ] unchanged `envRevision`/`skillRevision` 下，连续两轮仍命中 composed prompt cache；
      `AGENTS.md` disk read 次数在 `30s` 内保持为一，skill content 仍走现有 content cache。
- [ ] fresh env snapshot lookup 不执行 `AGENTS.md` content read 或重复 `.git` ancestor scan；修复没有把
      原本按天发生的同步文件系统检查放大到每个 turn。
- [ ] 现有 base prompt、project dir、model、active skill names 和 natural-day invalidation 测试继续通过。
- [ ] 本规格中的 contract 均有明确 owner、时序和 failure semantics，不留未决实现选择。

## Fix plan（`PRM-002`）

1. 先添加会失败的真实组合测试，不在测试里用 mock env builder 替代内层 cache。
2. 扩展 `systemEnvPromptBuilder`：
   - source cache 记录 last-known-good/pending 状态；
   - 将 git observation 与 `AGENTS.md` source observation 放在同一有界 refresh cadence；
   - 导出 `{ prompt, revision }` snapshot；
   - 保留 string-returning wrapper，避免无关 call site 一次性迁移；
   - 区分 missing 与 transient I/O error。
3. 在 `SkillPresenter` 增加 revision getter 和一个集中 bump helper，把现有分散的
   `metadataCache`/`contentCache` mutation 接到同一 helper；不创建第二套 skill cache。
4. 在 `AgentRuntimePresenter`：
   - cache 判定前获取 env snapshot 和 `skillRevision`；
   - fingerprint/cache entry 加入 revisions；
   - cache miss 时直接复用已经取得的 env snapshot，禁止同一 turn 二次构建；
   - `resolveToolProfile()` fingerprint 加入同一 `skillRevision`；
   - tool/prompt build 后复核 revision，并对 concurrent mutation 做一次有界重建。
5. 补 race 和 failure tests：late result、unchanged result、mutation rollback、watcher degraded、
   session destroy 后 late result。
6. 运行 focused tests、typecheck、format、i18n、lint 和完整 test baseline；只接受与记录基线一致的
   unrelated failures。

## Task checklist

- [x] `PRM-001`: 核对 P-07、真实双层调用链、现有测试和历史意图。
- [x] `PRM-001`: 固定 env/skill revision、late result、failure 和 cache hit contract。
- [x] `PRM-001`: 记录被否决方案、兼容/回滚和残余风险。
- [ ] `PRM-002`: 先提交 failing integration tests。
- [ ] `PRM-002`: 实现 `SystemEnvPromptSnapshot`。
- [ ] `PRM-002`: 实现 `skillRevision` 并覆盖所有 prompt/tool-affecting mutation paths。
- [ ] `PRM-002`: 接入 composed prompt 和 tool profile fingerprints。
- [ ] `PRM-002`: 完成 automated validation 和 manual smoke validation。

## Test design

### Focused automated tests

建议新增独立的 `systemPromptCacheCoherence.test.ts`，不要继续扩大已有超大 test file。该测试必须使用：

- 真实 `systemEnvPromptBuilder` module；
- 唯一 temp workdir/`AGENTS.md` path，避免 module cache 在 case 间串扰；
- fake timers + controllable deferred `fs.promises.readFile`；
- 真实外层 `buildSystemPromptWithSkills()`，可通过现有 presenter harness 调用 private method；
- 最小 fake `SkillPresenter` 只控制 revision/content，不 mock 掉 outer cache。

需要覆盖：

1. `first timeout -> fallback cached -> late settle -> next turn refresh`；
2. `stale A -> background B -> next turn B`；
3. `same skill name/revision R1 -> content B/revision R2`；
4. `same revisions -> outer hit`；
5. late result 在 session destroy 后完成，不重新创建 session cache 或持有 session reference；
6. 两个 session 共用 source path 时只发一个 pending read，但各自按 revision 重建；
7. fresh snapshot 连续调用不重复执行 content read 或 `.git` ancestor scan。

`SkillPresenter` focused tests 另外覆盖每类 bump path，至少包括 watcher update、内部 save、rollback、
extension update、script descriptor update 和 `allowedTools` update。

### Validation commands

```bash
pnpm vitest run test/main/lib/agentRuntime/systemEnvPromptBuilder.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/systemPromptCacheCoherence.test.ts
pnpm vitest run test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts
pnpm vitest run test/main/presenter/skillPresenter/skillPresenter.test.ts
pnpm run typecheck
pnpm run format
pnpm run i18n
pnpm run lint
pnpm test -- --reporter=dot
git diff --check
```

### Manual validation

1. 在同一 DeepChat session 发送一次消息，修改 workdir 下的 `AGENTS.md`，等待超过 `30s`，再连续发送
   两个可观察约束的消息。允许触发 refresh 的第一条仍使用旧内容；后台完成后的下一条必须使用新内容。
2. 保持 active skill name 不变，在 DeepChat skill editor 中修改 body 并保存；下一条消息必须使用新
   body，不需要跨日或重启。
3. 修改该 skill 的 `allowedTools`，确认下一轮 tool definitions 与 prompt 同步变化。
4. 检查日志只包含 path、timing、error code/cache state 等 metadata，不包含 instruction content。

首次读取超过 `200ms` 的确定性验证依赖 automated deferred test，不用人工制造慢盘作为 merge gate。

## 兼容与影响

- 无数据库、settings、IPC 或 renderer schema 迁移。
- 首轮 latency contract 不变：首次 `AGENTS.md` read 仍最多等待 `200ms`。
- unchanged inputs 下 system prompt bytes 不变，provider 侧 cache key/命中不应因本修复自行抖动。
- 真实 env/skill 变化后 prompt bytes 会更早变化，provider prompt cache miss 是正确性所需成本。
- global `skillRevision` 会让不相关 session 在任一 skill 变化后各重建一次 prompt/tool profile；这是
  有界、低频且可回滚的代价。
- 模型在同一 session 中看到更新后的 instruction 是预期行为；不保留“当天冻结”兼容。

## Rollback

该变更只影响 in-memory cache key 和 source snapshot，无持久化数据。若 `PRM-002` 出现严重回归，可整体
回滚实现 commit，应用重启后所有新 revision/cache entry 自动消失。不要只回滚 fingerprint 字段而保留
新 snapshot API 的调用顺序，否则可能留下无效 I/O 成本但重新引入 stale prompt。

## 被否决方案

### 1. 把 `200ms` 改长或等待磁盘完成

否决。它重新引入 `session-start-lag` 已确认的首轮阻塞，只是降低 timeout 概率，没有建立 coherence。

### 2. 把外层 cache 从一天缩短到 `30s`

否决。固定 TTL 只能缩短错误窗口，不能保证 late result 在下一轮生效；还会无条件增加重建。

### 3. 删除内层 cache

否决。会把 `AGENTS.md` disk I/O 放回每轮 pre-stream hot path，违背已有性能目标。

### 4. 直接删除外层 cache

暂不采用。理论上能恢复正确性，但外层复用有明确历史测试，且目前没有数据证明整段 prompt/tooling
每轮重建没有成本。revision 修复能保留既有收益，变更面更小。

### 5. 只把 `mtime`/size 放进 fingerprint

否决。粗粒度 timestamp、same-size overwrite 和不同文件系统语义都可能漏掉内容变化。它们只能作为
read optimization，不能作为最终 revision。

### 6. 用 `Date.now()` 作为 revision

否决。它可能在同一毫秒碰撞，也会让相同内容无意义失效；renderer event version 还不是 main 内部可读
signal。

### 7. 收到 `skills.catalog.changed` 后让 renderer 回调 main 清 cache

否决。事件方向错误，会把 main 内部正确性依赖 renderer/webContents 生命周期。revision 应由 source
owner 直接提供。

### 8. 对所有 MCP tool schema 做全量 hash

否决。当前 composed tooling prompt 不消费完整 schema；为未发生的依赖增加每轮 serialization/hashing
属于过度兜底。skill-derived tool coherence 用 `skillRevision`，MCP registry coherence 继续用
`toolRegistryRevision`。

### 9. late result 完成后重启或重放当前 turn

否决。provider 请求一旦开始，重放会带来重复副作用和消息状态问题。contract 明确从下一 turn 生效。

## 残余风险

1. `agentsInstructionsCache` 仍按 path 保留到 process 结束；大量一次性 workspace 可能增长 map。本 issue
   不顺手加入 LRU，避免把正确性修复扩大为 cache lifecycle 重构。
2. `AGENTS.md` refresh 是 turn-driven：没有新 turn 就不会主动读盘；这不影响模型行为，因为没有新的
   provider 请求需要该 prompt。
3. TTL stale-while-revalidate 明确保留一个 stale window；TTL 后触发 refresh 的那一 turn 仍可能使用
   旧内容，late settle 后下一 turn 才必须更新。
4. skill watcher degraded 时，外部直接编辑文件仍可能不被发现；watch root 之外的
   plugin-contributed skill 也没有当前 hot-reload 保证。这是现有 watcher ownership contract，不是
   composed cache 能自行推断的状态。DeepChat 自身 save/install 和 plugin register/unregister API 不受
   此限制。
5. global `skillRevision` 会产生少量 false invalidation，但不会产生 stale false hit；后续只有在 metrics
   证明成本显著时才考虑 per-skill revision。
6. snapshot 与 cache set 之间可能发生更新。实现会做一次有界重建并拒绝缓存已知不一致的 tool/prompt
   pair；如果 source 持续变化，当前 turn 仍可能使用最后一次完整结果，下一 turn 收敛。该边界是为了
   不用无限 retry 阻塞发送。

## 完成定义

`PRM-001` 在本文合入后完成；它只固定 contract。`PRM-002` 只有在上述 acceptance criteria、focused
tests、完整 baseline 对比和 manual validation 都完成后才算修复 P-07。
