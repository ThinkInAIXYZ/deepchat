# DeepChat 文档索引

本文档反映 `2026-08-12` 的当前代码。历史实施过程、已完成 issue 和一次性 SDD 通过 Git
历史查询，不再长期留在 `docs/`。

## 当前必读

| 文档 | 用途 |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | main 进程模块、所有权、生命周期和依赖方向 |
| [FLOWS.md](./FLOWS.md) | 启动、Session、Agent、Tool、Remote、Scheduler、Sync 和退出流程 |
| [architecture/agent-system.md](./architecture/agent-system.md) | DeepChat / ACP backend、Run、权限和 Subagent 合同 |
| [architecture/session-management.md](./architecture/session-management.md) | Session 数据、binding、恢复、删除和 transfer |
| [architecture/tool-system.md](./architecture/tool-system.md) | Tool、MCP、Skill、Plugin 和权限边界 |
| [architecture/memory-system.md](./architecture/memory-system.md) | Memory 存储、检索、写入、隔离和维护 |
| [architecture/tape-system.md](./architecture/tape-system.md) | Tape、ViewManifest、回放和 Subagent lineage |
| [architecture/event-system.md](./architecture/event-system.md) | typed route、typed event 和 main 内部调用规则 |
| [architecture/shared-skills/spec.md](./architecture/shared-skills/spec.md) | 全局 Skills、Agent binding、迁移和运行时授权合同 |
| [guides/getting-started.md](./guides/getting-started.md) | 当前代码入口和本地开发命令 |
| [guides/cli.md](./guides/cli.md) | 随包 CLI 的能力、生命周期、安全边界和 benchmark 合同 |
| [guides/plugin-packaging.md](./guides/plugin-packaging.md) | `.dcplugin` 打包、内置分发和 release 规则 |
| [release-flow.md](./release-flow.md) | 版本、分支、tag 和平台构建流程 |
| [spec-driven-dev.md](./spec-driven-dev.md) | SDD 分类、产物和清理规则 |

## 进行中的目标

新建或继续维护的 feature / architecture 以 `plan.md` 作为唯一执行清单；有界复杂 bug 可在
`spec.md` 中保留简短清单。历史 `tasks.md` 仅在对应目标下次更新时迁移：优先并入已有
`plan.md`；没有 plan 的单阶段复杂 bug 并入 `spec.md`，其他目标创建 `plan.md`。不为规范迁移
单独批量改写。

| 文档 | 状态 |
| --- | --- |
| [architecture/local-control-plane/](./architecture/local-control-plane/) | CLI V1 已实现；全量测试与生产构建通过，当前平台 unpack 受发布 runtime 下载网络阻塞 |
| [features/acp-v1-reliability/](./features/acp-v1-reliability/) | ACP capability、auth、session lifecycle 与 diagnostics 待实施 |
| [features/cua-cross-platform-computer-use/](./features/cua-cross-platform-computer-use/) | 已实现主体，等待 CI platform matrix 验证 |
| [features/mcp-oauth-authentication/](./features/mcp-oauth-authentication/) | 已实现主体，等待真实 OAuth smoke |
| [architecture/mcp-v2-protocol/](./architecture/mcp-v2-protocol/) | v2 与 legacy wire 已落地，等待外部互操作验证及兼容窗口结束 |
| [features/mcp-apps/](./features/mcp-apps/) | MCP Apps host 已落地，等待 packaged sandbox 与外部 App 验证 |
| [features/mcp-authorization-extensions/](./features/mcp-authorization-extensions/) | 授权扩展已落地，等待受控 OAuth 与安全存储验证 |
| [features/mcp-tasks/](./features/mcp-tasks/) | Tasks 被上游公开 v2 adapter 阻塞，未实现、未宣称支持 |
| [architecture/chat-scroll-ownership/](./architecture/chat-scroll-ownership/) | chat viewport ownership、windowing 与真实 Chromium 验证进行中 |
| [architecture/memory-quality-gates-and-observability/](./architecture/memory-quality-gates-and-observability/) | retrieval artifact upload 待完成 |
| [architecture/memory-vector-store-v2/](./architecture/memory-vector-store-v2/) | v2 已落地，保留 migration window 后的 VSS removal follow-up |
| [architecture/main-process-structured-logging/](./architecture/main-process-structured-logging/) | Main JSONL、持久日志隐私边界与 Agent 并发诊断已落地；本地 SQLite ABI 不匹配导致部分 native tests 跳过，详见任务清单 |
| [issues/chat-history-search-scroll-coordinates/](./issues/chat-history-search-scroll-coordinates/) | 等待 Electron/macOS 物理滚动验证 |

## 保留的产品合同

以下 feature spec 仍承担跨模块产品或扩展合同，不是实施历史：

- [Provider Runtime](./features/provider-runtime/spec.md)
- [DeepChat Skills Management](./features/deepchat-skills-management/spec.md)
- [Plugins Hub](./features/plugins-hub/spec.md)
- [Complete Directory Management](./features/complete-directory-management/spec.md)
- [MCP Permission Ownership](./architecture/remove-mcp-permission-system/spec.md)

## 机器读取基线

| 文件 | 使用方 |
| --- | --- |
| [agent-system-layered-runtime-baseline.json](./architecture/baselines/agent-system-layered-runtime-baseline.json) | architecture baseline generator test 的 canonical fixture |
| [main-kernel-bridge-register.json](./architecture/baselines/main-kernel-bridge-register.json) | architecture baseline generator 的 retired boundary register |

其它 dependency、scoreboard、zero-inbound 报表由 `pnpm run architecture:baseline` 按需生成，
不作为长期文档。

## 文档保留规则

- 当前事实写入核心 architecture、flow 或 guide，不再保留重复的 implemented SDD。
- 完成的 feature / architecture 删除 `plan.md` 和遗留 `tasks.md`；只有维护合同需要时保留
  压缩后的 `spec.md`。
- 已修复 issue 直接删除；历史由 Git 保存，必要的持久化回归由测试保护。
- active goal、`plan.md` 中的未完成步骤、遗留未完成 task 和 `[NEEDS CLARIFICATION]` 不得在
  cleanup 中删除。
- 文档引用的路径必须存在；旧实现只通过 `git log` / `git show` 查询。
