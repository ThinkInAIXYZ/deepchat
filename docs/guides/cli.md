# DeepChat CLI V1

DeepChat 随桌面应用提供 `deepchat` 命令。命令本身是薄客户端，所有 Provider、凭据、Skill、
MCP、OCR、Artifact 和 Agent 状态仍由正在运行的 DeepChat main 进程持有。

## 生命周期

- 不提供 CLI 开关。DeepChat 启动时自动启动本机 control plane。
- server 监听成功后，DeepChat 自动、幂等地安装或修复自己拥有的 `deepchat` launcher。
- 用户命令位置中的 launcher 是普通文件；它固定引用当前应用中校验过的 CLI 与 bundled Node，
  应用移动或升级后由下次启动原子刷新。旧版 owned symlink 会自动迁移。
- launcher 不会回退到 `PATH` 中的系统 Node；bundled runtime 缺失时以 `127` 失败关闭。
- launcher 冲突时保持失败关闭：不会覆盖同名的外部命令、被修改的 managed block、符号链接
  profile 或不属于 DeepChat 的文件。
- launcher 不是 daemon。DeepChat 未运行时，命令返回 `unavailable`，退出码为 `3`。
- DeepChat 退出时先停止接收请求，再取消进行中的 RPC、上传、下载和 stream。连接会在有界宽限期
  内关闭，所有已连接且正在等待 main 的 CLI 进程自行退出，退出码为 `3`；不会遗留 CLI 后台进程。
- 普通退出保留 launcher，便于下次启动后直接使用。完整数据重置只删除仍能证明由 DeepChat
  拥有且未被修改的 launcher 集成；ownership 冲突或清理失败会保留外部命令/profile 并记录安全
  诊断，但不会阻止应用数据重置。

先用诊断命令确认桌面端和协议可用：

```bash
deepchat system status --json
deepchat system version --json
deepchat system capabilities --json
deepchat system doctor --json
```

## 命令合同

所有命令都使用固定的两段式前缀：

```text
deepchat <domain> <verb> [options]
```

`--json`、`--jsonl`、`--timeout` 和领域参数必须放在 domain 与 verb 之后。下面的形式会被拒绝：

```text
deepchat --json image generate
```

这不只是命令风格。Agent shell 的会话权限按命令签名缓存，两段式前缀确保批准粒度稳定在
`deepchat <domain>`，不会因为前置 flag 变成另一组权限。

查看全部命令或单个命令参数：

```bash
deepchat help
deepchat image generate --help
```

输出模式：

- 默认 text：给人阅读，stdout 只放结果，诊断信息写入 stderr。
- `--json`：只输出一个稳定的 result 或 error envelope。
- `--jsonl`：逐行输出有版本的事件，最后一行是终态 result 或 error。
- streaming 命令在 text/JSON 模式由 CLI 有界收集；main 始终只维护一条 canonical stream。
- machine 模式不输出 ANSI progress UI。

稳定退出码：

| Code | Meaning |
| --- | --- |
| `0` | success |
| `2` | invalid command or input |
| `3` | DeepChat unavailable or protocol/surface mismatch |
| `4` | authentication or authorization failure |
| `5` | renderer approval denied or timed out |
| `6` | domain operation failed |
| `7` | timeout, signal, or cancellation |
| `8` | internal or protocol failure |

## V1 能力清单

| # | 能力 | 命令域 | 关键边界 |
| --- | --- | --- | --- |
| 1 | 文本模型调用 | `model invoke` | raw provider stream，无 Session、Tool、Memory 或 Skill 副作用 |
| 2 | 图片生成 | `image generate` | 二进制结果进入 ArtifactSpool |
| 3 | 音频生成与识别 | `audio speak`, `audio transcribe` | speech 为正式 standalone 能力；转写支持上传或 owned artifact |
| 4 | 视频生成 | `video generate` | 二进制结果进入 ArtifactSpool |
| 5 | 离线 OCR | `ocr status`, `ocr extract`, `ocr clear-cache` | 图片/PDF，文本内联返回，不进入 ArtifactSpool |
| 6 | 完整 Agent run | `agent run`, `run get/watch/cancel` | durable detached Session，可恢复、订阅和幂等取消 |
| 7 | 公共设置 | `settings get/set` | 只读写 typed allowlist，不是任意配置通道 |
| 8 | Provider 管理 | `provider list/test/add/update/set-credential/clear-credential/remove` | 公共 DTO 脱敏；凭据只从 stdin 进入 main |
| 9 | Model 管理 | `model list/enable/disable/config-get/config-set/config-reset` | 运行时列表与严格公共配置分离 |
| 10 | Skill 管理 | `skill list/install/enable/disable/remove` | ZIP/HTTPS 安装有边界与供应链批准 |
| 11 | MCP 管理 | `mcp list/add/update/enable/disable/start/stop/remove` | 仅公开管理面，不暴露 raw MCP tool tunnel |
| 12 | Artifact 管理 | `artifact describe/get/delete` | ownership、TTL、hash、配额与跨文件系统 no-overwrite |
| 13 | 诊断和 benchmark 输出 | `system ...`, JSON/JSONL、stdin、timeout | 外部 harness 负责数据集、重复、打分和冷启动 |
| 14 | Agent scoped CLI | bundled `deepchat-cli` Skill | main 签发短期、按调用和字节限额的 token，不暴露 human descriptor |

## 模型、媒体与 OCR

先枚举可用 Provider 和模型 ID，不要根据 UI 名称猜测：

```bash
deepchat provider list --enabled-only --json
deepchat model list --provider <provider-id> --json
deepchat model config-get --provider <provider-id> --model <model-id> --json
```

模型与媒体调用示例：

```bash
deepchat model invoke --provider <provider-id> --model <model-id> \
  --prompt 'Explain the result' --jsonl

deepchat image generate --provider <provider-id> --model <model-id> \
  --prompt 'A product photo' --jsonl

deepchat video generate --provider <provider-id> --model <model-id> \
  --prompt 'A five second product turntable' --jsonl

deepchat audio speak --provider <provider-id> --model <model-id> \
  --text 'Hello from DeepChat' --jsonl

deepchat audio transcribe --provider <provider-id> --model <model-id> \
  --file ./sample.wav --json
```

较长的 prompt、speech 文本和敏感值应通过 stdin 传递，避免 shell quoting 与 process-list 暴露：

```bash
deepchat model invoke --provider <provider-id> --model <model-id> --stdin --jsonl
deepchat provider set-credential --provider <provider-id> --stdin --json
```

OCR 是独立的随包离线能力，不是模型别名，也不依赖聊天里的“非视觉模型自动提取附件”设置：

```bash
deepchat ocr status --json
deepchat ocr extract --file ./scan.png --json
deepchat ocr extract --file ./document.pdf --page-count 12 --max-tokens 8000 --json
deepchat ocr clear-cache --json
```

OCR 输出记录真实的 cache/runtime 状态：

- `hit`：命中派生缓存；
- `miss-warm`：未命中缓存，提取前 helper 已 ready；
- `cold-runtime`：未命中缓存，提取前 helper 尚未 ready；
- offline：runtime asset 不可用，调用以 typed unavailable error 结束。

`ocr clear-cache` 只清理可再生的派生缓存，不重启 helper，也不保证制造 cold-runtime 样本。严格的
冷启动 benchmark 应由外部 harness 重启 DeepChat，并同时记录 app/protocol/surface 版本、
`runtimeStateBefore`、输入大小、耗时和输出 token 数。

## Artifact 与文件边界

图片、视频和 speech 的二进制结果以临时 Artifact 返回。结果包含随机 ID、MIME、大小、SHA-256、
过期时间和建议文件名，不包含 main 内部路径。

Human terminal 可以读取或删除自己可见的 Artifact：

```bash
deepchat artifact describe --id <artifact-id> --json
deepchat artifact get --id <artifact-id> --out ./result.png --json
deepchat artifact get --id <artifact-id> --out ./result.png --overwrite --json
deepchat artifact delete --id <artifact-id> --json
```

`artifact get` 默认不覆盖现有文件。main 不接受输出路径；它只流式返回受 ownership 保护的字节，
最终路径由 human CLI 在本地处理。

输入同样按 caller 分流：human CLI 打开本地文件并上传有界字节，main 不接受任意输入路径；Agent
只能传递 DeepChat-owned Artifact ID。Agent 不能使用 `--file`、`--out`、`--overwrite`，不能下载或
删除 Artifact 字节。

## Agent run

完整 Agent 工作流与 raw `model invoke` 分开：

```bash
deepchat agent run --prompt 'Inspect the project and summarize the issue' --json
deepchat run watch --run <run-id> --jsonl
deepchat run get --run <run-id> --json
deepchat run cancel --run <run-id> --json
```

`agent run` 先创建 durable detached Session，再启动首轮。CLI 断开不会删除 run；可以通过
`run get` 恢复消息和 `running | awaiting_interaction | terminal` phase，human caller 可通过 cursor
续接 `run watch`。一次 provider stream 完成或失败不会提前结束 watch；只有 root Session 进入
`idle`/`error` 才是整个 detached run 的终态。Agent caller 自身不能递归执行
`agent run`，也不能等待当前正在执行的自身 run；Agent 仅可使用非阻塞的 `run get` 与幂等的
`run cancel`。

## 设置、Skill 与 MCP

公共读取都是脱敏的：

```bash
deepchat settings get --json
deepchat settings get --keys privacyModeEnabled,ocrBackend --json
deepchat skill list --json
deepchat mcp list --json
```

变更示例：

```bash
deepchat settings set --key ocrBackend --value '"cpu"' --json
deepchat model enable --provider <provider-id> --model <model-id> --json
deepchat skill install --url <https-url> --json
deepchat mcp add --name <server-name> --stdin --json
```

设置只覆盖 canonical contract 中的公开 key；Provider/Model、Skill、MCP 也各自使用严格输入，不能
借 CLI 读取 secret、数据库字段、环境变量或任意内部 route。

## 批准与 Agent 安全模型

Human 发起敏感 mutation 时，请求会保持挂起，由 DeepChat renderer 展示批准。批准绑定到当前
method、规范化参数 hash、effect、scope、有效期和 live request；CLI 只会等待结果，无法取得或重放
ticket，也不存在 `--confirmed` 一类绕过参数。

Agent 调用额外经过以下控制：

1. shell command permission；
2. main 签发的短期 scoped token；
3. deny-by-default `CLI_SURFACE_V2` caller/scope policy；
4. effect policy 与 renderer-only approval；
5. ownership、rate、call/byte quota 与脱敏审计。

`deepchat` 不在 `SAFE_COMMANDS`。Agent 每次只能执行一个以 `deepchat <domain> <verb>` 开头的独立
命令；pipeline、重定向、command substitution、separator 和 newline 都会阻止 scoped token 签发。
bundled Skill 不读取或暴露 human descriptor。

Agent 的管理面只开放以下批准入口：preference-only `settings set`、不带 credentials/query/fragment
的 HTTPS `skill install`，以及新增
一个默认禁用、无凭据且可完整审阅的 HTTPS remote `mcp add` 配置。Agent MCP 输入不能包含 stdio
command、headers、authorization、非 HTTPS endpoint，或超过批准 UI 的审阅上限；批准页展示完整
endpoint 与公共 metadata，而审计仍只记录脱敏摘要。`mcp update` 可能立即重启正在运行的服务，因此与
MCP runtime 控制/删除、Provider/Model 配置、Skill 启停/删除、credential 和 destructive 操作一样保持
human-only。Skill/MCP 的脱敏列表可直接读取。

## Coredev 入口

| Owner | Path |
| --- | --- |
| thin CLI、argv、输出和本地文件 I/O | `src/cli` |
| server、surface、policy、domain adapters、ArtifactSpool | `src/main/cli` |
| 唯一 composition/start/stop owner | `src/main/app/composition.ts` |
| canonical protocol 与 route contracts | `src/shared/contracts` |
| 通用批准状态机 | `src/main/approval` |
| Agent shell gate | `src/main/tool/permission/commandPermissionService.ts` |
| bundled Agent instructions | `resources/skills/deepchat-cli/SKILL.md` |

main 只监听 UDS 或 named pipe，不开放 TCP fallback。CLI surface 引用 canonical typed contracts，但
不是内部 route registry 的通用代理。新增能力必须显式加入 surface，并同时定义 caller、scope、
effect、approval、transport、输入/输出边界、quota 和 audit 语义。

V1 明确不包含：ACP server、远程访问、raw MCP tool invocation、TUI/交互 shell、任意配置或 secret
读取、server-side OCR batch/layout/model 管理、通用费用预算系统，以及内置 benchmark runner。
普通 Agent token 与 human client 都只使用 V2。V3 仅为冻结到 CLI Programmatic adapter 的 Agent
Run 增加受 originating View capability 约束的 `tool search|describe|call|batch`；它不是 human raw MCP
tunnel，普通 Agent token 和 V2 client 均不可达。benchmark 是建立在稳定 JSON/JSONL 合同上的外部
harness。

完整架构与安全不变量见
[`docs/architecture/local-control-plane/spec.md`](../architecture/local-control-plane/spec.md)。
