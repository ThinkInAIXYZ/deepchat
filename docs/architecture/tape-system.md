# Tape 系统

Tape 是 Session 同寿命的 append-only execution fact log。它保存可回放事实、anchor、ViewManifest 和
Subagent lineage；message transcript 是面向 UI 的 projection，不是 Tape 的替代品。

## 所有权和数据

| 能力 | 当前 owner |
| --- | --- |
| append/query/replay | `src/main/session/data/tape.ts` |
| effective view | `src/main/session/data/tapeEffectiveView.ts` |
| facts | `src/main/session/data/tapeFacts.ts` |
| ViewManifest storage | `src/main/session/data/tapeViewManifest.ts` |
| runtime assembly | `src/main/agent/deepchat/runtime/tapeViewAssembler.ts` |
| policy selection | `src/main/agent/deepchat/runtime/tapeViewPolicy.ts` |
| model-facing tools | `src/main/tool/agentTools/agentTapeTools.ts` |

Tape entry 只能 append。更正、压缩和 handoff 通过新 fact/anchor 表达，不原地改写旧 entry。

## View 和 provenance

每次 provider request 使用一个明确的 effective view：

```text
Tape entries + anchors + linked child head
  -> selected policy and version
  -> TapeViewAssembler
  -> ordered provider messages
  -> ViewManifest
  -> provider request trace
```

`ViewManifest` 记录 policy、version、selection reason、included/excluded entry、anchor 和 token budget
provenance。正常 chat、resume、tool loop 和 context pressure recovery 都必须记录自己的 view；不得依赖
无法复现的隐式 context builder 状态。

当前默认 policy 保留兼容 ID，但实现由 registry/selector 明确选择。旧 persisted manifest label 只在
read boundary 兼容，新写入必须使用 canonical policy/provenance。

## Message projection 与 tool facts

- user/assistant/reasoning/tool terminal result 在 projection 完成后写入对应 Tape fact；
- provider/tool retry 不得重复提交 terminal fact；
- Tape 写失败按当前 settlement policy 记录/隔离，不能把已经完成的用户回复变成无限挂起；
- replay 从 manifest 和 facts 重建 provider-visible context，不从 renderer block 猜测执行语义。

## Model capability

模型只可调用：

- `tape_search`：在授权 view 内查找；
- `tape_context`：读取已找到 entry 周边上下文。

`tape_info`、`tape_anchors` 是 diagnostic；`tape_handoff` 是 runtime-only。五个名称全部 reserved，
MCP 不能 shadow，持久化 disabled-tool 配置也不能关闭 system capability。

## Subagent lineage

Subagent 使用独立 Session 和独立 Tape。完成后父 Session append 一个 link，固定 child Tape head：

- 查询时只读该 frozen head，不自动读取 child 后续 entry；
- child entries 不复制进父 Tape；
- discard/merge 只改变父 Session 的 lineage fact，不篡改 child 历史；
- 非直接 child、未授权 Session 或递归 Subagent 不能通过 Tape tool 越权读取。

## 回放和兼容

Replay 必须保持 entry order、role、tool call/result pairing、anchor cursor 和 policy version。未知旧 fact
可以按兼容规则跳过或映射，但不能静默改变已知 fact 的含义。测试至少覆盖正常 chat、resume、tool
interaction、compaction、context pressure、Subagent frozen head 和旧 manifest 读取。

关键测试位于 `test/main/session/`、`test/main/agent/deepchat/` 和 `test/main/tool/`。历史的 Tape
increment SDD 已合并到本文，详细实施顺序从 Git 历史查询。
