# System Prompt Cache Coherence

- Status: proposed
- Date: 2026-07-10
- Task: `PRM-001`
- Audit finding: `P-07`
- Implementation slices: `PRM-002A` → `PRM-002B` → `PRM-002C`

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
   是 rendered env prompt bytes 的稳定 digest，不使用 `mtime` 或 `Date.now()` 代替输出真相。
3. `buildVerificationPolicyPrompt()` 的 `package.json` name/scripts 也是动态 file-backed input；它必须改为
   bounded-refresh `{ prompt, revision }` snapshot。env 和 verification snapshots 并行获取，共享一个
   absolute `200ms` overall deadline，不能串行消耗两个 budget。
4. `SkillPresenter` 使用 immutable last-known-good runtime snapshot + seqlock-style
   `skillMutationEpoch`。stable even 不等于“mutation Promise 已 settle”，而是“已经 atomic publish 一个
   coherent snapshot”；metadata、rendered content、`allowedTools` 必须来自同一 staged source version。
   reader/build 不得绕过 published snapshot 再从磁盘拼 skill body。
5. 外层 `systemPromptCache` fingerprint 必须包含 `envRevision`、`verificationPolicyRevision` 和 stable
   `skillMutationEpoch`；`toolProfileCache` 也使用同一个 skill epoch，避免 prompt 已更新但
   `allowedTools` 仍旧。
6. 首轮因 `AGENTS.md` 超时而使用 fallback 后，不回滚或重启正在执行的 turn。late read 完成后，
   下一次开始组装 prompt 的 turn 必须看到新 revision 并重建 prompt。
7. `waitForStableRuntimeSnapshot()` 接收 pre-stream `AbortSignal` 和同一个 absolute deadline；等待 odd
   epoch 最多占用 overall `200ms`。deadline 到达时只能回退到完全 matching 的 previous stable pair，
   否则抛 typed retryable `SkillRuntimeUpdatingError`。
8. 不新建通用 cache framework。实施拆成可独立运行、可逆序回滚的 `PRM-002A` source snapshots、
   `PRM-002B` skill immutable snapshot/epoch、`PRM-002C` orchestration cache wiring。

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

本 issue 只定义 contract 和后续 `PRM-002A`–`PRM-002C` 的实施、测试边界；`PRM-001` 不改生产代码或
测试。

覆盖：

- `AGENTS.md` 首次读取超过 `200ms`；
- 首次 timeout 后的 late result；
- `AGENTS.md` missing → present、present → changed、present → missing 在 rendered output 变化时的失效；
- workdir `package.json` missing → present、present → changed、present → missing 在 rendered
  verification policy 变化时的失效；
- 同名 skill 的 metadata、body、extension/runtime instructions 更新；
- `skillMutationEpoch` 对 composed prompt 和 skill-derived tool profile 的一致 snapshot；
- invalid watcher/update parse、repo-owned rollback failure 与 reconcile/quarantine；
- pre-stream abort、shared deadline、hung mutation worker 和 matching stable fallback；
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

### 5. verification policy 也在 outer miss 后同步读取动态文件

[`buildVerificationPolicyPrompt()`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4882)
根据 workdir 下 `package.json` 的 `name` 和 `scripts` 生成 verification instructions。当前实现先通过
`getVerificationScriptNames()` 读取一次 manifest，随后又通过 `readPackageJsonManifest()` 读取第二次
（[L475-L505](../../../src/main/presenter/agentRuntimePresenter/index.ts#L475)、
[L4894-L4913](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4894)）。这两次都是 main process
同步 `existsSync`/`readFileSync`。

该 section 只在 composed prompt cache miss 后构建
（[L4823-L4839](../../../src/main/presenter/agentRuntimePresenter/index.ts#L4823)）。因此同一 workdir 的
`package.json` 从 missing 变为 present，或 name/scripts 原地更新后，外层 cache 同样可能整天屏蔽新的
verification policy。这是 P-07 同一种 root cause，source owner 进入 `PRM-002A`，outer wiring 进入
`PRM-002C`；不能只修 `AGENTS.md`。

### 6. `skills.catalog.changed` 不是 main 内部 invalidation bus

Skill watcher 和 mutation 路径会调用 `publishDeepchatEvent('skills.catalog.changed', ...)`，但
[`publishDeepchatEvent()`](../../../src/main/routes/publishDeepchatEvent.ts#L32) 只把 typed envelope 发给
renderer windows。`AgentRuntimePresenter` 没有订阅这条 main-internal signal。

所以不能因为“已经 publish event”就推断 composed prompt cache 已失效；代码没有这条连接。

### 7. tool profile 是另一层相关 cache

[`resolveToolProfile()`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L6696) 的 fingerprint
包含 active skill names 和 `toolRegistryRevision`，但不包含 skill metadata revision
（[L6714-L6731](../../../src/main/presenter/agentRuntimePresenter/index.ts#L6714)）。

这意味着同名 skill 若只更新 frontmatter `allowedTools`，`SkillPresenter` 可以已经更新 metadata，
而 `toolProfileCache` 仍返回旧 tool definitions。`PRM-002B` 必须建立 coherent skill snapshot，
`PRM-002C` 再让同一个 stable `skillMutationEpoch` 同时约束两层 cache；不能只修 prompt 文本后留下
prompt/tool 不一致。

### 8. “完整 tool schema 缺 fingerprint”需要收窄表述

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

### 9. 现有测试没有跨两层验证

- [`systemEnvPromptBuilder.test.ts`](../../../test/main/lib/agentRuntime/systemEnvPromptBuilder.test.ts#L71)
  证明直接再次调用 builder 能看到 late content。
- [`agentRuntimePresenter.test.ts`](../../../test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts#L2501)
  证明同日复用、跨日失效、base prompt/project dir/active skill name 变化会失效。
- `agentRuntimePresenter.test.ts` 全局 mock 了 `buildSystemEnvPrompt`，因此这些测试没有执行真实
  `agentsInstructionsCache`。
- verification policy 现有断言只检查 section order
  （[L2725-L2747](../../../test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts#L2725)），
  没有覆盖 `package.json` missing/present/changed 或 outer cache coherence。

缺失的是“真实 outer cache + env/verification file snapshots + skill mutation interleaving”的组合测试。

## 反常设计是否故意

结论是：两个局部行为都是故意的，但它们的组合后果没有设计依据。

| 历史证据 | 能确认的意图 | 不能推导的结论 |
| --- | --- | --- |
| commit `c86f1fb1` 引入 `systemPromptCache` 及同日复用、跨日失效测试 | 外层复用是有意行为 | 不能推导“env/skill 内容当天不可变” |
| historical `docs/specs/agent-tooling-v2/spec.md`（可用 `git show c86f1fb1:...` 查看）要求固定 section 顺序、避免实时 tab/process snapshot，同时明确包含 `AGENTS.md` 全文 | 稳定 prompt 指“不注入高频运行态快照” | 不能把用户修改的 instruction file 当成永不变化的静态值 |
| commit `4545791d` 的 historical `docs/issues/session-start-lag/spec.md` 明确要求慢 `AGENTS.md` 读取不阻塞首轮，stale content 后台 refresh，后续消息复用新内容 | `200ms` fallback 和 late refresh 是有意行为 | 不能推导 late result 可以被外层 cache 屏蔽到次日 |
| commit `8fd50e40` 初次实现 `SkillPresenter` 的 content cache 与文件 hot reload；commit `b31e8f6c` 后来把 watcher 迁到共享 watcher service，并保留 change 时删除 content cache 的语义 | skill hot reload 是有意行为，`b31e8f6c` 不是它的起点 | 不能推导删除 `contentCache` 已自动删除 session composed prompt |

本地历史中没有找到定义这两层组合语义的文档或测试。结合上述相互冲突的明确目标，合理结论是
“cache coherence 漏接”，不是故意让 late instructions 当天失效。

## Root Cause

多个动态 input owner 只暴露 value，没有暴露能参与上层 cache 判定的 snapshot revision/epoch：

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
调用。`package.json` 路径甚至没有内层 TTL；它只在 outer miss 时同步读两次，因此也会被同一个 early
return 屏蔽。

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

1. `revision` 是 `sha256(UTF-8(prompt))` 语义的稳定 digest。相同 rendered prompt bytes 必须得到相同
   revision；只有 rendered output 变化才要求不同 revision。
2. source status 与 rendered revision 分离。missing、empty file 和 whitespace-only file 当前都不渲染
   `Instructions from:` section，因此允许得到同一个 revision；不能为了 source state 不同强制 outer
   cache miss。
3. 不使用 `mtime`、file size 或 `Date.now()` 作为 rendered revision。它们可用于避免不必要读取，但
   不能单独作为输出正确性依据。
4. 外层每次 cache 判定前都要获取 snapshot。fresh path cache 不重复读磁盘，也不重复向父目录扫描
   `.git`；只有首次读取或到达 `30s` refresh boundary 才刷新这些 file-backed observations。
5. snapshot lookup 接收 pre-stream `AbortSignal` 和 absolute `deadlineAt`。首次没有 last-known-good
   content 时只创建一个 shared pending read，caller 最多等待 `deadlineAt - now`，不得另开自己的
   `200ms`。timeout 后返回 empty-instructions fallback，原 pending read 继续执行；signal abort 立即停止
   caller wait，但不取消其他 caller 共享的 source read。
6. source entry 明确保存 `lastKnownGood`、`pending`、`settledAt` 和 `nextAttemptAt`：
   - 成功读取文件：更新 `lastKnownGood`，清 `pending`，令
     `nextAttemptAt = settledAt + 30_000`；
   - `ENOENT`/`ENOTDIR`：作为成功的 missing observation，更新 last-known-good 为 absent，并使用同样
     的 `30s` refresh boundary；
   - 其他 I/O failure：保留原 `lastKnownGood`，清 `pending`，令
     `nextAttemptAt = settledAt + 30_000`；没有 last-known-good 时继续渲染 empty fallback；
   - `Date.now() < nextAttemptAt` 时任何 turn 都不得再次读盘；到达 boundary 后，第一个 caller 创建一个
     retry Promise，其他 caller 共享它。
7. 只有成功读取或成功 missing observation 才更新 `AGENTS.md` source snapshot。非 `ENOENT` failure
   不得把 last-known-good instructions 清空，也不得更新成“成功 empty”；env prompt 的日期、model 等
   非文件输入仍按各自实际值正常渲染。
8. stale entry refresh 时，触发 refresh 的当前 turn 允许使用 last-known-good content。successful late
   result settle 后，下一 turn 获取新 rendered snapshot；若 rendered bytes 未变，revision 也不变。
9. pending settle 不修改已经发给 provider 的 turn，也不持有 session reference。多个 session 使用同一
   resolved path 时共享 source entry 和 pending read。

当前 [`isGitRepository()`](../../../src/main/lib/agentRuntime/systemEnvPromptBuilder.ts#L96) 只检查 workdir
或其 ancestor 是否存在名为 `.git` 的 path；它不验证该 path 的类型/有效性，也不表示 branch、HEAD、
dirty status 等 Git state。本 contract 将它准确命名为 `gitRepositoryMarkerPresent` observation，并按
同一 `30s` cadence 缓存。`envRevision` 覆盖 snapshot 实际渲染的 yes/no；marker 在磁盘变化后允许到下次
refresh 才反映。

### B. `VerificationPolicySnapshot`

`buildVerificationPolicyPrompt()` 改为单次读取、bounded-refresh snapshot：

```typescript
interface VerificationPolicySnapshot {
  prompt: string
  revision: string
}
```

contract：

1. key 是 resolved workdir 下的 `package.json` path；workdir 为空时返回纯静态 base policy，不读盘。
2. 每次 refresh 只异步读取并 parse 一次 manifest，禁止当前 `getVerificationScriptNames()` +
   `readPackageJsonManifest()` 的双重同步读取。
3. `revision` 同样以 rendered verification-policy prompt bytes 为真。只修改与输出无关的 manifest 字段，
   或 missing → valid manifest 但仍渲染相同 base policy时，revision 可以不变。
4. 使用 `30s` refresh/retry interval、shared pending、`lastKnownGood` 和 `settledAt + 30_000`
   `nextAttemptAt`，failure/missing semantics 与 A 相同。JSON parse failure 按 transient failure 处理，不用
   部分写入中的 malformed file 覆盖 last-known-good policy。
5. lookup 接收与 env 相同的 `AbortSignal`/absolute `deadlineAt`。首次没有 last-known-good 时只等剩余
   overall budget；timeout/error 使用 base policy fallback。成功 late result 若改变 rendered output，
   下一 turn 必须带新 revision 重建 outer prompt。
6. non-empty present → missing、missing → present、name/scripts changed 只有在 rendered policy bytes
   实际改变时才失效。例如新增 `format`/`i18n`/`lint` 会切换 DeepChat policy；增加无关字段不会。

### C. `skillMutationEpoch` seqlock

`SkillPresenter` 是 skill source、metadata、rendered content 和 skill-derived `allowedTools` 的共同 owner。
它不再把 `metadataCache` 与按 name 延迟读盘的 `contentCache` 当作可独立组合的 runtime truth，而是 atomic
publish immutable last-known-good snapshot：

```typescript
interface PublishedSkillEntry {
  sourceVersion: string
  availability: 'metadata_only' | 'ready' | 'quarantined'
  metadata: Readonly<SkillMetadata>
  renderedContent?: string
  allowedTools: readonly string[]
  linkedFiles?: readonly Readonly<{ path: string; kind: string }>[]
  sourceError?: Readonly<{ code: string; message: string }>
}

interface SkillRuntimeSnapshot {
  epoch: number // always even on a published snapshot
  entries: ReadonlyMap<string, PublishedSkillEntry>
}

interface SkillRuntimeSnapshotPort {
  getPublishedRuntimeSnapshot(): SkillRuntimeSnapshot
  waitForStableRuntimeSnapshot(options: {
    requiredSkillNames: readonly string[]
    signal: AbortSignal
    deadlineAt: number
  }): Promise<SkillRuntimeSnapshot>
}
```

#### C1. stable-even 的强 invariant

1. stable even 的含义不是“某个 mutation Promise settle 了”，而是 `SkillPresenter` 当前指向一个 immutable、
   coherent、已经 publish 的 runtime snapshot。任何 runtime-usable `ready` entry 的 metadata、rendered
   content、`allowedTools`、runtime instructions 和 `sourceVersion` 必须来自同一次 staged source read。
2. runtime reader、prompt builder 和 skill-derived tool builder 只能读取 `PublishedSkillEntry`；不得在
   stable pair 外调用 `fs.readFile`、重新 parse frontmatter 或用另一个 cache 的 body 拼接 metadata。
3. 为保留 progressive loading，非 active skill 可以是 `metadata_only`。某 skill 成为 active 前，
   `SkillPresenter` 必须从同一次 raw source/config/script snapshot stage 出完整 `ready` entry，再 atomic
   publish；`waitForStableRuntimeSnapshot({ requiredSkillNames })` 负责共享该 readiness stage，reader 不能
   直接从磁盘补 body。
4. `skill_view` 的 root `SKILL.md`（包括显式 `filePath: 'SKILL.md'`）是 model/runtime reader：content、
   metadata 和 linked-file path listing 必须来自同一个 captured `ready` entry，调用期间不 stat、readdir
   或 read skill source。显式查看非 root linked file 是独立的用户请求，允许在 captured catalog metadata
   授权的 skill root 内有界读盘，并明确可能观察到比 root LKG 更新的 linked-file bytes；该内容不参与
   prompt/tool coherent pair，也不会替换 published root snapshot。
5. `sourceVersion` 是 staged inputs 的 content digest，至少覆盖 raw `SKILL.md`、normalized extension、
   normalized runnable script descriptors、linked-file path listing，以及会影响 path-variable/runtime
   rendering 的 skill/plugin root、owner id 和 process arch。不能只用 name/mtime。
6. stable state 使用 even safe integer，publish window 使用 odd integer。应用重启可从 `0` 开始，因为
   published snapshot 和所有依赖 cache 同时清空。
7. 进入新的 even epoch 前必须已经选择并 atomic publish 以下三者之一：
   - fully validated candidate snapshot；
   - previous last-known-good snapshot（可附带新的 diagnostic `sourceError`）；
   - 对没有 last-known-good 的 source 发布 `quarantined/unavailable` 状态，且它不进入 available/active
     prompt 或 `allowedTools`。
8. published `sourceError` 是 runtime contract 的一部分，只允许稳定、受控、无 source content 的
   code/message。raw exception、绝对路径、文件内容和底层错误消息只写 main-process local log，不得进入
   immutable snapshot、IPC 或 renderer cache。

仅仅“disk operation 返回了”或“worker Promise settle 了”不是进入 even 的充分条件。

#### C2. stage → atomic publish

1. watcher/discovery 先在 published snapshot 之外 stage raw read、frontmatter parse、body render、extension
   和 script descriptors，计算 `sourceVersion` 并形成 immutable candidate。stage 期间 reader 继续使用旧
   stable snapshot，不会读取正在变化的磁盘。
2. candidate 完整后才开启很短的 odd publish window，atomic swap snapshot reference，然后进入新的
   even epoch。每个 stage 带 source observation sequence；sequence 的 compare-and-swap 与开启 odd
   publish/update 必须是同一个同步原子步骤，不能先检查、跨越 `await` 后再 publish。discovery 使用
   catalog observation sequence，并只在该 sequence 仍是最新 observation 时 whole-map replace；其间任一
   watcher 或 mutation observation 都使旧 discovery result 失效。重叠 publish 使用 active publish
   count/shared settlement barrier，直到所有 publish settlement 完成都保持 odd。
3. repo-owned mutation 在写盘前先用 proposed bytes stage/validate candidate。需要写盘时，在第一个
   externally visible write 前进入 odd，使用 temp file + atomic replace；多资源写入失败且已经改变磁盘时，
   必须用 previous raw/config 做 atomic rollback，然后才能选择 previous LKG snapshot 并进入 even。
4. 下列入口都必须遵守同一 staging/publish protocol：
   - discovery 结果替换；
   - install、uninstall、adopt、plugin skill register/unregister；
   - enable/disable；
   - watcher callback 观察到的 `SKILL.md` create/update/delete；
   - `updateSkillFile()`、`saveSkillWithExtension()`、`saveSkillExtension()`；
   - 会改变 rendered runtime instructions 的 script descriptor create/delete/rename 或 extension override。
5. external watcher update parse/render 返回 null/error 时：
   - existing skill 保留整条 previous LKG entry（metadata/body/allowedTools 一起保留），只 atomic publish
     `sourceError` diagnostic；
   - new invalid skill 不进入 published catalog；可以记录 path-level diagnostic，但不能发布半个 entry。
6. repo-owned update 在 staging parse-null 时直接拒绝，尚未写盘。若后续步骤失败且 rollback 成功，保留
   previous LKG。rollback 失败或磁盘状态 unknown 时，也不得把 unknown bytes 宣称为 stable：
   - 有 previous LKG：继续发布 previous LKG runtime entry，标记 `reconcile_required`；
   - 无 previous LKG：发布 quarantine/unavailable diagnostic，不向 prompt/tool 暴露；
   - 每次 repo-owned mutation failure 结束前只执行一次 immediate bounded reconcile。它只有在重新 stage
     出完整 candidate 后才 atomic publish；本次 reconcile 再失败则保持 LKG/quarantine，不创建 timer、
     worker 或其他后台 retry loop。后续只由新的 watcher event、显式 discovery 或下一次 repo-owned
     mutation 重新触发 reconcile。
7. success、完整 rollback、rollback failure 和 invalid candidate 都必须在 `finally` 中关闭 publish
   bookkeeping；但只有 coherent snapshot 已被选定/published 后才能从 odd 进入 even。即使最终仍是旧
   bytes，也进入新的 even epoch；这是可接受的低频 false invalidation。
8. publication observer/callback 不是 publication truth。snapshot reference 已 swap 后，即使 observer
   抛错，本次 publication 仍保持成功的 even snapshot；调用方同步收到 observer error，但 shared
   settlement 必须在 `finally` resolve 并清空，不能留下 even epoch 搭配永久 pending waiter。
9. `reset()`/`destroy()` 遇到 active publish 时必须原子拒绝：snapshot、observation sequences、readiness
   stages、diagnostics 和 publish bookkeeping 全部保持不变。owner 应先停止 watcher/阻止新 mutation，等
   active publish settlement 后重试 reset；成功 reset 必须推进单调 observation floor，使 reset 前已经
   stage 的 late result 永远不能在 reset 后重新 publish。
10. plugin contribution register/unregister API 返回成功前，贡献 map 与 published snapshot 必须收敛。
    whole-catalog discovery 的 CAS 若被并发 watcher/mutation observation 淘汰，register 使用 bounded
    per-source stage/CAS publish，unregister 为每个 removed source 推进 observation 并 direct CAS remove；
    不能把 stale catalog snapshot 当作成功。所有 uninstall cleanup（包括目录已不存在的 `not_found`）也
    必须先推进 source observation，再在 atomic remove 点 CAS，从而使 cleanup 前已开始的 watcher stage
    永远不能复活已删除 entry。

#### C3. bounded stable read

1. pre-stream 创建一个 absolute `deadlineAt`，不晚于 source preparation 开始后的 `200ms`，并把原始
   `AbortSignal` 传给 `waitForStableRuntimeSnapshot()`。retry/rebuild 不得重置 deadline。
2. required entry 仍是 `metadata_only` 时，wait 启动/复用 shared readiness staging Promise；epoch odd 时
   复用 shared publish settlement Promise。每个 caller 独立 race 自己的 signal/deadline；一个 caller
   timeout/abort 不取消 shared stage/mutation，也不影响其他 waiter。shared readiness stage 若得到 invalid
   candidate 或 read failure：有 previous `ready` LKG 时保留该 LKG 并附稳定 `sourceError`；没有 ready
   LKG 时 atomic publish `quarantined`。后续 waiter 直接观察同一稳定结果，不重复读盘；只有新的 watcher
   event、显式 discovery 或下一次 mutation 才能重新触发 staging，不创建 `30s` timer 或后台 retry loop。
3. signal 先触发时立即抛现有 abort error，不回退 cache。deadline 先到且 required readiness stage 或 odd
   publish 仍 pending/hung 时，抛：

```typescript
class SkillRuntimeUpdatingError extends Error {
  readonly code = 'SKILL_RUNTIME_UPDATING'
  readonly retryable = true
}
```

4. orchestration 捕获 deadline error 后，只能返回一个完全 matching 的 previous stable prompt/tool pair：
   structural fingerprint、env revision、verification revision、skill snapshot even epoch、
   `toolRegistryRevision` 都必须匹配当前请求。没有 matching pair 时继续抛 typed error，不能返回半更新
   skill，也不能永久等待。
5. stable read 使用 seqlock：读取 even epoch → 读取 immutable snapshot reference → 再读 epoch；只有两次
   相同且为 even 才接受。若 changed/odd，等待 settlement 后在原 absolute deadline 内最多重建一次。
   第二次仍变化时不写长期 cache，只允许 C3.4 的 matching previous stable fallback。
6. external edit 到 watcher event 被观察之间存在不可避免的 observation window：published LKG 仍可用。
   event 被观察后 staging 期间也继续使用 LKG；只有 atomic publish window 是 odd。关闭这段窗口需要每
   turn re-stat/re-read，不属于本 contract。watcher degraded 或 watch root 外 plugin skill 只在 event、
   register/unregister 或显式 discovery 被观察后提供新版本保证。
7. 单个 global epoch 会让不相关 session 多重建一次 prompt/tool profile。skill mutation 低频，接受该
   成本，不引入 per-skill dependency graph。

### D. 外层 composed prompt cache

`AgentRuntimePresenter` 的 cache hit 条件变为：

```text
same dayKey
AND same structural fingerprint
AND same envRevision
AND same verificationPolicyRevision
AND same stable-even skillMutationEpoch
```

约束：

1. pre-stream source preparation 只创建一个 `deadlineAt = startedAt + 200ms`。env snapshot、verification
   snapshot 和 stable skill snapshot wait 立即并行启动并共享该 absolute deadline/`AbortSignal`；禁止先等
   env `200ms`，再等 verification `200ms`，再为 skill 创建新 budget。
2. env/verification snapshots 和 stable skill epoch 必须在 cache hit 判定前取得。两个 file snapshot
   都 pending 时，wall-clock upper bound 是 overall `200ms` 加微小同步 compose/hash 开销，不是 `400ms`。
3. cache entry 记录使用的 revisions/epoch，便于测试和 debug；日志不得输出 `AGENTS.md`、
   `package.json` 或 skill content。
4. active skill names 不变但 body/metadata/extension 变化时，stable epoch 变化必须阻止 outer hit。
5. revisions/epoch 未变化时继续复用相同 composed prompt；修复不能退化为每 turn 重读所有 active
   `SKILL.md`。
6. cache miss 时直接复用已经取得的 env/verification snapshots 和 immutable skill snapshot，禁止同一
   turn 再次读/parse source。
7. env/verification pending 在 snapshot 获取后 settle 时，本 turn 可使用捕获到的旧 revision；下一 turn
   必须看到新 rendered snapshot。skill mutation 不使用此宽松规则，必须遵守 C 的 stable-even read。

### E. tool profile 一致性

`resolveToolProfile()` fingerprint 同样加入 stable even `skillMutationEpoch`。理由不是所有 skill content
都改变 tool schema，而是 `allowedTools` 与 metadata/content 共用 `SKILL.md` mutation window。tool
definitions 与 composed prompt 必须来自 C 中同一次 seqlock read；不能各自采样 epoch 后拼成半更新状态。

MCP 自身仍由 `toolRegistryRevision` 管理；不合并两种 revision owner。

## 可验证 acceptance criteria

- [ ] 使用真实 `AgentRuntimePresenter.buildSystemPromptWithSkills()` 和真实 env builder：首次
      `AGENTS.md` read 超过 `200ms` 时，首轮按时返回且不含 instructions；late read settle 后，同日、
      同 structural inputs 的下一轮包含新 instructions。
- [ ] late read 只触发一次 disk read；第二轮不为看到 late result 重读文件。
- [ ] `AGENTS.md` 从 A 改为 B：TTL 内允许继续使用 A；TTL 后首个 turn 触发 background refresh，
      refresh settle 后下一 turn 使用 B。
- [ ] `AGENTS.md` missing → non-empty present、non-empty present → missing 会在 rendered output 变化时
      失效；missing、empty、whitespace-only 渲染相同时允许 revision 不变。
- [ ] 非 `ENOENT` I/O error 保留 last-known-good content。fake clock 在 `settledAt + 29_999ms`
      前无第二次 read，恰到 `+30_000ms` 后并发 caller 只创建一个 shared retry；只有 retry success 才更新
      source snapshot，rendered bytes 不变时 revision 不变。
- [ ] workdir `package.json` missing → relevant scripts present、name/scripts changed、present → missing 的
      rendered verification policy 能按 `30s` bounded refresh 更新；无关 manifest 字段变化不强制失效。
- [ ] verification refresh 每次只进行一次 async read/parse，不保留当前双重同步读取。
- [ ] env 和 verification 首读同时 deferred 时使用同一 absolute deadline；fake clock 到 `199ms` 仍等待，
      到 `200ms` 两者一起 fallback/返回，source preparation latency 不累加为 `400ms`。
- [ ] active skill name 不变、body 从 A 改为 B 后，下一 turn 的 `## Active Skills` 使用 B。
- [ ] 同名 skill 的 `description`、`category` 或 `platforms` 变化后，available skills 段更新。
- [ ] `saveSkillExtension()` 或 script descriptor 变化后，active skill runtime instructions 更新。
- [ ] 同名 skill 的 `allowedTools` 变化后，`toolProfileCache` miss 并重建 tool definitions。
- [ ] 每个 published `ready` skill entry 的 metadata、rendered content、runtime instructions 和
      `allowedTools` 都有同一个 `sourceVersion`；prompt/tool build 没有 runtime disk body read。
- [ ] `getMetadataList()`、`loadSkillContent()`、`getActiveSkillsAllowedTools()` 和 `listSkillScripts()` 的
      runtime/compatibility path 只读 captured published snapshot；hard-check 在这些调用期间发生 source disk
      read 时直接失败。
- [ ] watcher update 的 parse/render deferred 时 reader 继续得到完整 previous LKG；valid candidate stage
      完成后才进入 odd atomic publish window。invalid existing update 保留整条 LKG 并标 source error；
      invalid new skill 不发布。
- [ ] repo-owned update 先 stage candidate，再在 visible disk write 前进入 odd，并用 atomic replace。后续
      failure 的 atomic rollback 成功时继续发布 previous LKG；stage parse-null 时尚未写盘，直接保留
      previous LKG。
- [ ] rollback failed/disk unknown 时 unknown bytes 从不成为 stable runtime entry：有 LKG 时保留 LKG，
      无 LKG 时 quarantine/unavailable；每次失败只做一次 immediate bounded reconcile，失败后没有后台
      retry loop，只由 watcher 新事件、显式 discovery 或下一 mutation 重触发。
- [ ] stable snapshot wait 接收 pre-stream signal/deadline：abort 立即结束 caller；odd/hung worker 到 overall
      `200ms` 不会永久挂。只有完全 matching previous stable prompt/tool pair 可 fallback，否则抛
      retryable `SkillRuntimeUpdatingError`。
- [ ] env、verification、odd skill 同时 pending 时仍只消耗同一个 `200ms` overall deadline，不出现
      source fallback 后重新给 skill wait 计时的 `400ms+` 路径。
- [ ] stable read 中途 epoch 变化时丢弃 candidate并在原 deadline 内最多重建一次；持续变化不写长期
      cache，也不发送已知 mixed pair。
- [ ] watcher 外部编辑在 event 被观察前，以及 observed event 的 private staging 期间，允许继续命中旧
      LKG；只有 atomic publish window 是 odd，明确记录 unavoidable observation window。
- [ ] unchanged `envRevision`/`verificationPolicyRevision`/stable skill epoch 下，连续两轮仍命中 composed
      prompt cache；
      `AGENTS.md` disk read 次数在 `30s` 内保持为一，skill body 直接来自 immutable published snapshot。
- [ ] fresh env/verification snapshot lookup 不执行 source content read 或重复 `.git` ancestor marker
      scan；修复没有把原本按天发生的同步文件系统检查放大到每个 turn。
- [ ] 现有 base prompt、project dir、model、active skill names 和 natural-day invalidation 测试继续通过。
- [ ] 本规格中的 contract 均有明确 owner、时序和 failure semantics，不留未决实现选择。

## Implementation slices and rollout

不把 source cache、skill mutation protocol 和 pre-stream orchestration 塞进一个大 PR。三个 slice 严格
串行，后一个以前一个 merge commit 为 base：

| Slice | Depends on | 独立交付内容 | 独立运行条件 | 独立回滚 |
| --- | --- | --- | --- | --- |
| `PRM-002A` source snapshots | `PRM-001` | `SystemEnvPromptSnapshot`、`VerificationPolicySnapshot`、shared pending/30s retry 状态机；保留现有 string builder compatibility wrapper，并让生产 compatibility calls 共享同一个 `200ms` deadline 并行启动 | focused source tests、生产链并行 deadline test、typecheck/lint/full baseline 通过；outer cache behavior 暂不宣称已修复 | 可单独 revert；旧 outer key 仍可运行 |
| `PRM-002B` skill immutable snapshot/epoch | `PRM-002A` | staged source version、immutable published LKG snapshot、quarantine/reconcile、odd/even publish epoch、abortable/deadline-bound wait；现有 skill APIs 改为从 published snapshot 读取 | 所有 SkillPresenter/ToolPresenter tests 通过；尚未要求 outer prompt 使用新 epoch | 可在 `PRM-002C` 合入前单独 revert，`PRM-002A` 保留 |
| `PRM-002C` orchestration cache wiring | `PRM-002A` + `PRM-002B` | env/verification/skill 并行 shared deadline；同一 immutable skill snapshot 生成 prompt/tool pair；outer/tool profile fingerprints 接 revisions/epoch | 真实组合测试、完整 baseline、manual smoke 全部通过；此 slice 才关闭 P-07 | 可先单独 revert C，恢复旧 orchestration 但保留 A/B owner invariants；随后才允许按 B→A 逆序回滚 |

### `PRM-002A` tasks

- [x] 先写 env timeout/late result、transient retry boundary、rendered-no-change failing tests。
- [x] 实现 `lastKnownGood`、shared `pending`、`settledAt`、`nextAttemptAt` source state。
- [x] 导出 `SystemEnvPromptSnapshot`；准确缓存 `.git` marker-presence observation。
- [x] 将 verification policy 改为单次 async read/parse 的 `VerificationPolicySnapshot`。
- [x] 给两个 lookup 接入 `AbortSignal`/absolute deadline 参数；保留 compatibility wrappers。
- [x] 生产 outer cache miss 链立即并行启动两个 compatibility lookup，共享一个 absolute `200ms`
      deadline；不接 source revision fingerprint。
- [x] 验证 A 单独 merge 后输出 bytes/首轮预算兼容，记录 outer coherence 尚待 C。

`PRM-002A` 只发布 source-owner snapshots。外层 `systemPromptCache` fingerprint、skill snapshot/epoch 和
prompt/tool orchestration 仍分别等待 `PRM-002B`、`PRM-002C`；本 slice 不关闭 P-07。

### `PRM-002B` tasks

- [x] 定义 immutable `PublishedSkillEntry`/`SkillRuntimeSnapshot` 与 content-derived `sourceVersion`。
- [x] 让 metadata/body/runtime instructions/`allowedTools` 从同一次 staged source version 产生。
- [x] 保留 progressive loading：active `metadata_only` entry 必须通过 staged atomic publish 变成 `ready`。
- [x] 实现 repo mutation stage → atomic disk replace → atomic snapshot publish；实现 atomic rollback。
- [x] 实现 invalid existing/new、rollback-failed LKG/quarantine 和 reconcile state machine。
- [x] 实现 odd/even publish epoch、shared settlement barrier 和
      `waitForStableRuntimeSnapshot({ signal, deadlineAt })`。
- [x] 让现有 `getMetadataList()`、`loadSkillContent()`、`getActiveSkillsAllowedTools()`、
      `listSkillScripts()` compatibility API 只读 published snapshot，并用 hard-check 阻止 runtime path 重读
      source disk。
- [x] 完成 invalid parse、deferred stage、rollback/reconcile、abort/deadline/hung worker tests。
- [x] 完成最终 mutation lifecycle audit：catalog discovery 使用 catalog observation CAS；root/linked-source
      watcher 使用 per-source observation CAS；repo-owned save/install/adopt 使用先 stage、再 odd publish
      window、失败 rollback/reconcile；plugin contribution register/unregister 在 catalog CAS 丢失后逐源收敛；
      uninstall（含 `not_found` cleanup）先推进 observation 再原子移除。`references`、`templates`、
      `scripts`、`assets` 的目录变化都重建 linked-file listing snapshot。

### `PRM-002C` tasks

- [ ] 先写真实 outer + A/B source owner 的 failing integration tests。
- [ ] 把 stable skill lookup 接入 A 已建立的 absolute `200ms` pre-stream source deadline；三者保持并行。
- [ ] 从同一个 immutable skill snapshot 构造 metadata/content/tool pair。
- [ ] composed prompt/tool profile cache entry 与 fingerprint 加入 source revisions/stable epoch。
- [ ] 实现一次 bounded rebuild、fully matching previous stable fallback 和 typed
      `SkillRuntimeUpdatingError` propagation。
- [ ] 完成 latency upper-bound、full baseline、manual validation；仅在 C 验证完成后关闭 P-07。

### Rollout order

1. merge `PRM-002A`，观察 source unit/integration checks；不更新 P-07 为 fixed。
2. 以 A 为 base merge `PRM-002B`，验证 skill editor/install/watcher/tool exposure；仍不更新 P-07 为 fixed。
3. 以 B 为 base merge `PRM-002C`，执行真实双层 cache、hung mutation、parallel deadline 和 manual smoke；
   通过后才在统一实施台账标记 P-07 complete。
4. 发生回归时按 C → B → A 逆序 revert。禁止保留 C 而回滚它依赖的 B/A contract。

## Task checklist

- [x] `PRM-001`: 核对 P-07、真实双层调用链、现有测试和历史意图。
- [x] `PRM-001`: 固定 env/verification rendered revisions、immutable skill snapshot/epoch、deadline、
      failure/reconcile 和 cache hit contract。
- [x] `PRM-001`: 拆分 `PRM-002A`–`PRM-002C` 的 depends-on、validation 与 rollback order。
- [x] `PRM-002A`: source snapshots。
- [x] `PRM-002B`: skill immutable snapshot/epoch。
- [ ] `PRM-002C`: orchestration cache wiring and final validation。

## Test design

### Focused automated tests

建议新增独立的 `systemPromptCacheCoherence.test.ts`，不要继续扩大已有超大 test file。该测试必须使用：

- 真实 `systemEnvPromptBuilder` module；
- 唯一 temp workdir/`AGENTS.md`/`package.json` path，避免 module cache 在 case 间串扰；
- fake timers + controllable deferred `fs.promises.readFile`；
- 真实外层 `buildSystemPromptWithSkills()`，可通过现有 presenter harness 调用 private method；
- 最小 fake `SkillPresenter` 实现 odd/even epoch、settlement barrier 和 deferred content/metadata，不 mock
  掉 outer cache。

需要覆盖：

1. `first timeout -> fallback cached -> late settle -> next turn refresh`；
2. `stale A -> background B -> next turn B`；
3. 非 `ENOENT` failure 在 `settledAt + 29_999ms` 前零 retry，`+30_000ms` 时 N 个 caller 共享一个
   retry；连续 failure 从新的 settlement 重新计时；
4. missing/empty/whitespace 渲染相同 revision，non-empty content 才改变 rendered revision；
5. `package.json` missing/present/changed、parse failure last-known-good 和 rendered-no-change；
6. same stable epochs/revisions 命中 outer cache；
7. late result 在 session destroy 后完成，不重新创建 session cache 或持有 session reference；
8. 两个 session 共用 source path 时只发一个 pending read，但各自按 rendered revision 重建；
9. fresh snapshot 连续调用不重复执行 content read 或 `.git` ancestor marker scan；
10. env 与 verification reads 同时 deferred 时共享 absolute deadline，fake clock 证明 overall upper bound
    是 `200ms` 而不是两个串行 budget；
11. env、verification 和 odd skill worker 同时 deferred，证明 orchestration 不会在 file fallback 后重置
    skill deadline。

`SkillPresenter`/pre-stream focused tests 必须显式构造以下交错，而不只断言最终 revision 数值：

1. watcher `parseSkillMetadata()`/render deferred 时 published epoch 仍为旧 even，reader 得到 immutable
   previous LKG 全 pair；resolve valid candidate 后只在 atomic swap 窗口出现 odd/new even；
2. watcher existing update parse-null 保留 previous metadata/body/allowedTools 并标 error；new invalid skill
   不进入 catalog；
3. repo-owned update parse-null 在任何 disk write 前失败，previous LKG 和 disk bytes 不变；
4. repo update staged candidate valid 后进入 odd，disk/config 后半段 deferred；并发 reader 的
   `waitForStableRuntimeSnapshot()` 挂在 shared barrier，不能读磁盘中间态；
5. rollback failed 后在 mutation failure 结束前只执行一次 immediate bounded reconcile：runtime 始终只
   暴露 previous LKG；无 LKG install 则 quarantine。reconcile success 才 publish ready entry；failure 继续
   LKG/quarantine，epoch 不宣称 unknown disk bytes stable。fake timer/worker 断言失败后没有后台 retry，
   只有 watcher 新事件、显式 discovery 或下一 mutation 会启动下一次 reconcile；
6. reader 在 even epoch E 取得 snapshot 后 publish E+1/E+2；second epoch read 检出 changed，丢弃
   candidate，在原 deadline 内只重建一次；第二次仍变化时不写 cache；
7. fake timer 下 odd worker永久 pending：`199ms` 仍等待，`200ms` 使用 fully matching previous pair 或抛
   `SkillRuntimeUpdatingError`；advance 多久都没有遗留 waiter 永久挂住；
8. wait 中途 abort 时 caller 立即按 abort path 结束，不使用 stable fallback，也不取消共享 mutation；
9. 两个 overlapping atomic publishes 在全部 settlement 前保持 odd，extension/script/`allowedTools`
   candidate 都只从单一 source version publish；
10. 外部文件先改变、watcher event 尚未送达，以及 event 已送达但 private stage deferred 时，旧 LKG 可继续
   命中；测试明确该 unavoidable observation window 不代表新 disk bytes 已 stable。
11. root `skill_view`（含显式 `SKILL.md`）从一个 captured ready entry 返回 content/metadata/linked-file
    listing，期间不 stat/readdir/read source；显式非 root linked-file view 仍可执行有界读盘。
12. plugin register/unregister 的 catalog CAS 被并发 watcher 淘汰时，API 在逐源 publish/remove 收敛后才
    返回成功。
13. `not_found` uninstall cleanup 与已开始但未完成的 watcher stage 交错时，旧 candidate 不得复活 entry。
14. linked-file 目录新增、删除事件会重建 published listing；linked-file 内容显式查看可读取比 root LKG
    更新的 bytes，但不替换 root snapshot。

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
4. 在临时 workspace 中给 `package.json` 增加或删除 relevant verification scripts，等待 refresh boundary
   后确认 verification policy 更新；修改无关字段不应改变 prompt bytes。
5. 检查日志只包含 path、timing、error code/cache state 等 metadata，不包含 instruction/package/skill
   content。

首次读取超过 `200ms` 的确定性验证依赖 automated deferred test，不用人工制造慢盘作为 merge gate。

## 兼容与影响

- 无数据库、settings、IPC 或 renderer schema 迁移。
- 首轮 latency contract 收紧：env、verification 和 skill stable wait 共用 overall `200ms` deadline，不会
  因新增 source 串行放大。
- unchanged inputs 下 system prompt bytes 不变，provider 侧 cache key/命中不应因本修复自行抖动。
- 真实 env/verification/skill rendered output 变化后 prompt bytes 会更早变化，provider prompt cache miss
  是正确性所需成本。
- verification policy 从 double sync read 改为一个 bounded async source read；fresh turns 只查 snapshot。
- global `skillMutationEpoch` 会让不相关 session 在任一 coherent snapshot publish 后各重建一次
  prompt/tool profile；immutable entries 也会保留少量 duplicate strings。这是有界、低频且可回滚的代价。
- skill source 持续更新或 worker hung 且没有 matching stable pair 时，用户会看到 retryable pre-stream
  error；这是比发送 mixed instructions/tools 更安全的显式行为。
- 模型在同一 session 中看到更新后的 instruction 是预期行为；不保留“当天冻结”兼容。

## Rollback

没有 DB/schema migration；source revisions、published snapshots、epoch、quarantine diagnostics 都在内存。
回滚必须逆依赖执行：

1. `PRM-002C` 可单独 revert，恢复旧 orchestration；A/B 的 owner contract 继续工作。
2. 只有 C 已 revert 后才能 revert `PRM-002B`。回滚前必须确认没有 active
   `reconcile_required/quarantined` source；若有，先完成 reconcile 或阻止 skill runtime，避免旧代码重启后
   直接读取 unknown disk bytes。用户正常保存的 valid skill 文件不回滚，它们不是 migration。
3. B 已 revert 后可单独 revert `PRM-002A`，恢复旧 source builders。

禁止保留 C 而回滚 B/A，也不要只删除 fingerprint 字段却保留并行 snapshot lookup；这两种半回滚都会
破坏已验证的 deadline/coherence contract。

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

否决。事件方向错误，会把 main 内部正确性依赖 renderer/webContents 生命周期。immutable snapshot/epoch
应由 source owner 直接提供。

### 8. 对所有 MCP tool schema 做全量 hash

否决。当前 composed tooling prompt 不消费完整 schema；为未发生的依赖增加每轮 serialization/hashing
属于过度兜底。skill-derived tool coherence 用 stable `skillMutationEpoch`，MCP registry coherence 继续用
`toolRegistryRevision`。

### 9. late result 完成后重启或重放当前 turn

否决。provider 请求一旦开始，重放会带来重复副作用和消息状态问题。contract 明确从下一 turn 生效。

### 10. mutation Promise settle 就直接进入 even

否决。settle 只说明控制流结束，不能证明 disk、metadata cache、rendered body 和 `allowedTools` 来自同一
版本。even 必须绑定一次 coherent immutable snapshot publication。

### 11. stable epoch 后再调用 `loadSkillContent()` 读盘

否决。磁盘可在 epoch sample 后变化，metadata/tool 与 body 会重新撕裂。active body 必须已经属于 captured
published snapshot；未加载 entry 先通过 staged publication 变成 `ready`。

### 12. env、verification、skill 各自等待 `200ms`

否决。串行 budget 会把 pre-stream upper bound 放大到 `600ms`。三者共享一个 absolute deadline；
env/verification I/O 并行开始。

## 残余风险

1. env/verification source caches 仍按 path 保留到 process 结束；大量一次性 workspace 可能增长 map。
   本 issue 不顺手加入 LRU，避免把正确性修复扩大为 cache lifecycle 重构。
2. file-backed refresh 是 turn-driven：没有新 turn 就不会主动读盘；这不影响模型行为，因为没有新的
   provider 请求需要该 prompt。
3. TTL stale-while-revalidate 明确保留一个 stale window；TTL 后触发 refresh 的那一 turn 仍可能使用
   old last-known-good，successful late settle 后下一 turn 才必须更新。
4. 外部 skill 文件写入到 watcher event 被观察、以及 candidate private staging 完成前，reader 会继续使用
   old LKG；watcher degraded 或 watch root 外 plugin skill 可能更久不被发现。这是已明确保留的
   observation gap。DeepChat 自身 mutation 会先 stage，并在 visible write/publish 时受 odd epoch 保护。
5. global `skillMutationEpoch` 会产生少量 false invalidation；后续只有在 metrics 证明成本显著时才考虑
   per-skill epoch/dependency tracking。
6. skill source 持续变化超过一次有界重建时，不缓存 candidate；只允许回退到 epoch matching 的 last
   stable tool/prompt pair，且其 structural/env/verification inputs 也必须匹配。没有 matching stable pair
   时会得到 retryable pre-stream failure，而不是发送已知 mixed pair。这是低概率但明确可见的稳定性
   取舍。
7. rollback/reconcile 失败后没有后台 retry loop；若 watcher、显式 discovery 和后续 mutation 都未触发，
   runtime 会安全地停留在 LKG 或 quarantine，但磁盘与运行态可能长期不同；
   `sourceError/reconcile_required` 必须有日志与诊断可见性，不能静默假装用户的新文件已生效。

## 完成定义

`PRM-001` 在本文合入后完成；它只固定 contract。`PRM-002A`、`PRM-002B` 单独合入都不算修复 P-07；
只有 `PRM-002C` 完成上述 acceptance criteria、完整 baseline 对比和 manual validation 后，统一台账才可
把 P-07 标记为 complete。
