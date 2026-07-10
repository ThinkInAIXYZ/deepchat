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
   是 rendered env prompt bytes 的稳定 digest，不使用 `mtime` 或 `Date.now()` 代替输出真相。
3. `buildVerificationPolicyPrompt()` 的 `package.json` name/scripts 也是动态 file-backed input；它必须改为
   bounded-refresh `{ prompt, revision }` snapshot，并参与同一个外层 fingerprint。
4. `SkillPresenter` 使用 seqlock-style `skillMutationEpoch`：stable state 是 even epoch，任何 repo-owned
   可见 mutation 开始前进入 odd epoch，全部 settlement 后才回到新的 even epoch。reader 只缓存同一个
   stable even epoch 下得到的 metadata/content/tool pair。
5. 外层 `systemPromptCache` fingerprint 必须包含 `envRevision`、`verificationPolicyRevision` 和 stable
   `skillMutationEpoch`；`toolProfileCache` 也使用同一个 skill epoch，避免 prompt 已更新但
   `allowedTools` 仍旧。
6. 首轮因 `AGENTS.md` 超时而使用 fallback 后，不回滚或重启正在执行的 turn。late read 完成后，
   下一次开始组装 prompt 的 turn 必须看到新 revision 并重建 prompt。
7. 不新建通用 cache framework。改动留在现有 `systemEnvPromptBuilder`、`SkillPresenter` 和
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
- `AGENTS.md` missing → present、present → changed、present → missing 在 rendered output 变化时的失效；
- workdir `package.json` missing → present、present → changed、present → missing 在 rendered
  verification policy 变化时的失效；
- 同名 skill 的 metadata、body、extension/runtime instructions 更新；
- `skillMutationEpoch` 对 composed prompt 和 skill-derived tool profile 的一致 snapshot；
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
verification policy。这是 P-07 同一种 root cause，必须一起进入 `PRM-002`，不能只修 `AGENTS.md`。

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
而 `toolProfileCache` 仍返回旧 tool definitions。`PRM-002` 必须让同一个 stable
`skillMutationEpoch` 同时约束这两层 cache，不能只修 prompt 文本后留下 prompt/tool 不一致。

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
5. 首次没有 last-known-good content 时只创建一个 shared pending read，调用方最多等待 `200ms`。
   timeout 后返回 empty-instructions fallback，原 pending read 继续执行。
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
5. 首次没有 last-known-good 时最多等待 `200ms`；timeout/error 使用 base policy fallback。成功 late
   result 若改变 rendered output，下一 turn 必须带新 revision 重建 outer prompt。
6. non-empty present → missing、missing → present、name/scripts changed 只有在 rendered policy bytes
   实际改变时才失效。例如新增 `format`/`i18n`/`lint` 会切换 DeepChat policy；增加无关字段不会。

### C. `skillMutationEpoch` seqlock

`SkillPresenter` 是 skill metadata/content/watch lifecycle owner。它提供 main-internal narrow port，不复用
renderer event 的 `Date.now()` version：

```typescript
interface SkillRuntimeEpochPort {
  getRuntimeEpoch(): number
  waitForStableRuntimeEpoch(): Promise<number>
}
```

epoch contract：

1. stable state 使用 even safe integer，unstable mutation window 使用 odd integer。应用重启可从 `0`
   开始，因为所有依赖 cache 同时清空。
2. `SkillPresenter` 内部维护 active mutation count 和一个 shared settlement barrier：第一个 mutation 在
   任何 repo-owned 可见写入、cache delete/set 或 await 之前把 even epoch 推进到 odd；重叠 mutation
   只增加 count，不把 odd 推回 even；最后一个 mutation settle 后才推进到新的 even epoch 并 resolve
   waiters。
3. 下列入口都属于 mutation window：
   - discovery 结果替换；
   - install、uninstall、adopt、plugin skill register/unregister；
   - enable/disable；
   - watcher callback 已观察到的 `SKILL.md` create/update/delete；
   - `updateSkillFile()`、`saveSkillWithExtension()`、`saveSkillExtension()`；
   - 会改变 rendered runtime instructions 的 script descriptor create/delete/rename 或 extension override。
4. success、完整 rollback 和 rollback failure 都必须在 `finally` settlement 中退出 odd epoch。即使 rollback
   恢复了相同 bytes，也进入新的 stable even epoch；这是低频 false invalidation，换取 reader 不把
   mutation 中间态写入长期 cache。
5. reader 流程固定为：
   - 读取 `epochBefore`；若为 odd，await shared settlement，取得 stable even epoch；
   - 读取 metadata、active rendered content 和 skill-derived tool definitions；
   - 读取 `epochAfter`；只有 `epochBefore === epochAfter` 且为 even，才接受并缓存这一 pair；
   - 若 odd/changed，丢弃 cache candidate，等待当前 settlement 后以新 stable even epoch 最多重建一次；
   - 若重建期间再次变化，不写任何长期 cache。优先使用已有、tool/prompt epoch 相同的 last stable pair；
     该 pair 还必须匹配当前 structural fingerprint 和 env/verification revisions。否则返回 retryable
     pre-stream failure，禁止把已知 mixed 或输入已过期的 pair 发给 provider。
6. 外部编辑发生到 watcher callback 被观察之间存在不可避免的窗口：epoch 仍是 stable，reader 可能命中
   旧 content。handler 一旦收到 event，必须先进入 odd epoch 再 parse/更新。关闭这段窗口需要每 turn
   re-stat/re-read，不属于本 contract；watcher degraded 或 watch root 外 plugin skill 同样只在事件、
   register/unregister 或显式 discovery 被观察后提供一致性保证。
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

1. env/verification snapshots 和 stable skill epoch 必须在 cache hit 判定前读取。
2. cache entry 记录使用的 revisions/epoch，便于测试和 debug；日志不得输出 `AGENTS.md`、
   `package.json` 或 skill content。
3. active skill names 不变但 body/metadata/extension 变化时，stable epoch 变化必须阻止 outer hit。
4. revisions/epoch 未变化时继续复用相同 composed prompt；修复不能退化为每 turn 重读所有 active
   `SKILL.md`。
5. cache miss 时直接复用已经取得的 env/verification snapshots，禁止同一 turn 再次读/parse source。
6. env/verification pending 在 snapshot 获取后 settle 时，本 turn 可使用捕获到的旧 revision；下一 turn
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
- [ ] active skill name 不变、body 从 A 改为 B 后，下一 turn 的 `## Active Skills` 使用 B。
- [ ] 同名 skill 的 `description`、`category` 或 `platforms` 变化后，available skills 段更新。
- [ ] `saveSkillExtension()` 或 script descriptor 变化后，active skill runtime instructions 更新。
- [ ] 同名 skill 的 `allowedTools` 变化后，`toolProfileCache` miss 并重建 tool definitions。
- [ ] repo-owned mutation 在任何 visible write/cache mutation 前进入 odd epoch，最后 settlement 后才进入
      新 even epoch；重叠 mutation 在全部 settle 前始终保持 odd。
- [ ] deferred skill parse 与 reader 交错时，reader 等待 odd epoch；reader 在 stable read 中途遇到 epoch
      变化时丢弃 candidate 并最多重建一次；持续变化不写 composed/tool 长期 cache，也不发送已知 mixed
      pair。
- [ ] watcher 外部编辑在 event 被观察前允许短暂命中旧 snapshot；event handler 被调用后必须先进入 odd
      epoch，再开始 deferred parse/cache update。
- [ ] unchanged `envRevision`/`verificationPolicyRevision`/stable skill epoch 下，连续两轮仍命中 composed
      prompt cache；
      `AGENTS.md` disk read 次数在 `30s` 内保持为一，skill content 仍走现有 content cache。
- [ ] fresh env/verification snapshot lookup 不执行 source content read 或重复 `.git` ancestor marker
      scan；修复没有把原本按天发生的同步文件系统检查放大到每个 turn。
- [ ] 现有 base prompt、project dir、model、active skill names 和 natural-day invalidation 测试继续通过。
- [ ] 本规格中的 contract 均有明确 owner、时序和 failure semantics，不留未决实现选择。

## Fix plan（`PRM-002`）

1. 先添加会失败的真实组合测试，不在测试里用 mock env builder 替代内层 cache。
2. 扩展 `systemEnvPromptBuilder`：
   - source cache 记录 `lastKnownGood`、shared `pending`、`settledAt`、`nextAttemptAt`；
   - 将 `.git` marker-presence observation 与 `AGENTS.md` observation 放在同一有界 refresh cadence；
   - 导出 `{ prompt, revision }` snapshot；
   - 保留 string-returning wrapper，避免无关 call site 一次性迁移；
   - 严格实现 success/missing/transient error 的 `settledAt + 30s` 状态机。
3. 把 `buildVerificationPolicyPrompt()` 改为单次 async read/parse 的 bounded-refresh rendered snapshot；
   outer fingerprint 加入 `verificationPolicyRevision`，cache miss 复用已取得的 prompt。
4. 在 `SkillPresenter` 增加 seqlock-style epoch getter、shared settlement barrier 和集中
   `begin/endMutation` helper，把现有分散 mutation 接到 odd/even epoch；不创建第二套 skill content
   cache。
5. 在 pre-stream orchestration/`AgentRuntimePresenter`：
   - cache 判定前获取 env/verification snapshots，并取得 stable even skill epoch；
   - 在同一 epoch 下组装 metadata/content/tool pair，完成后复核 epoch；
   - fingerprint/cache entry 加入 revisions/epoch；
   - odd/changed 时等待 settlement，最多重建一次，持续变化不写长期 cache。
6. 补 race 和 failure tests：late result、unchanged rendered result、transient retry boundary、deferred
   skill parse/interleaving、overlapping mutations、rollback、watcher observation window、session destroy
   后 late result。
7. 运行 focused tests、typecheck、format、i18n、lint 和完整 test baseline；只接受与记录基线一致的
   unrelated failures。

## Task checklist

- [x] `PRM-001`: 核对 P-07、真实双层调用链、现有测试和历史意图。
- [x] `PRM-001`: 固定 env/verification rendered revisions、skill mutation epoch、late result、failure 和
      cache hit contract。
- [x] `PRM-001`: 记录被否决方案、兼容/回滚和残余风险。
- [ ] `PRM-002`: 先提交 failing integration tests。
- [ ] `PRM-002`: 实现 `SystemEnvPromptSnapshot`。
- [ ] `PRM-002`: 实现 `VerificationPolicySnapshot`。
- [ ] `PRM-002`: 实现 `skillMutationEpoch` seqlock 并覆盖所有 prompt/tool-affecting mutation paths。
- [ ] `PRM-002`: 接入 composed prompt 和 tool profile revisions/epoch。
- [ ] `PRM-002`: 完成 automated validation 和 manual smoke validation。

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
9. fresh snapshot 连续调用不重复执行 content read 或 `.git` ancestor marker scan。

`SkillPresenter`/pre-stream focused tests 必须显式构造以下交错，而不只断言最终 revision 数值：

1. watcher handler 进入 odd epoch，`parseSkillMetadata()` deferred；并发 reader 必须挂在 settlement
   barrier，不能读取中间 metadata/content；
2. reader 在 even epoch E 读完 metadata 后，内部 save 进入 odd E+1 并 deferred；reader 的 second read
   检出 changed/odd，丢弃 E candidate，等待 E+2 后只重建一次；
3. rebuild 期间第二个 mutation 再次进入 odd，断言本次不写 `systemPromptCache`/`toolProfileCache`；若有
   last stable matching pair 则使用它，否则返回 retryable pre-stream failure；
4. 两个 overlapping mutations 只让 epoch保持 odd，直到两个 settlement 都完成才进入新 even epoch；
5. mutation 完整 rollback、rollback failure、extension update、script descriptor update 和
   `allowedTools` update 都通过 `finally` 关闭 epoch；
6. 外部文件先改变、watcher event 尚未送达时允许旧 cache hit；event callback 一开始即进入 odd，再
   deferred parse，明确证明 unavoidable observation window 的边界。

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
- 首轮 latency contract 不变：首次 `AGENTS.md` read 仍最多等待 `200ms`。
- unchanged inputs 下 system prompt bytes 不变，provider 侧 cache key/命中不应因本修复自行抖动。
- 真实 env/verification/skill rendered output 变化后 prompt bytes 会更早变化，provider prompt cache miss
  是正确性所需成本。
- verification policy 从 double sync read 改为一个 bounded async source read；fresh turns 只查 snapshot。
- global `skillMutationEpoch` 会让不相关 session 在任一 skill mutation settlement 后各重建一次
  prompt/tool profile；这是有界、低频且可回滚的代价。
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
属于过度兜底。skill-derived tool coherence 用 stable `skillMutationEpoch`，MCP registry coherence 继续用
`toolRegistryRevision`。

### 9. late result 完成后重启或重放当前 turn

否决。provider 请求一旦开始，重放会带来重复副作用和消息状态问题。contract 明确从下一 turn 生效。

## 残余风险

1. env/verification source caches 仍按 path 保留到 process 结束；大量一次性 workspace 可能增长 map。
   本 issue 不顺手加入 LRU，避免把正确性修复扩大为 cache lifecycle 重构。
2. file-backed refresh 是 turn-driven：没有新 turn 就不会主动读盘；这不影响模型行为，因为没有新的
   provider 请求需要该 prompt。
3. TTL stale-while-revalidate 明确保留一个 stale window；TTL 后触发 refresh 的那一 turn 仍可能使用
   old last-known-good，successful late settle 后下一 turn 才必须更新。
4. 外部 skill 文件写入到 watcher event 被观察前，reader 可能命中旧 stable epoch；watcher degraded 或
   watch root 之外的 plugin-contributed skill 可能更久不被发现。这是已明确保留的 observation gap。
   DeepChat 自身 save/install 和 plugin register/unregister 在写入前进入 odd epoch，不受此窗口限制。
5. global `skillMutationEpoch` 会产生少量 false invalidation；后续只有在 metrics 证明成本显著时才考虑
   per-skill epoch/dependency tracking。
6. skill source 持续变化超过一次有界重建时，不缓存 candidate；只允许回退到 epoch matching 的 last
   stable tool/prompt pair，且其 structural/env/verification inputs 也必须匹配。没有 matching stable pair
   时会得到 retryable pre-stream failure，而不是发送已知 mixed pair。这是低概率但明确可见的稳定性
   取舍。

## 完成定义

`PRM-001` 在本文合入后完成；它只固定 contract。`PRM-002` 只有在上述 acceptance criteria、focused
tests、完整 baseline 对比和 manual validation 都完成后才算修复 P-07。
