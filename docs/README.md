# DeepChat Docs

当前 live 聊天链路已经统一到 `newAgentPresenter + deepchatAgentPresenter + new_sessions/deepchat_*`。

优先阅读：
- [ARCHITECTURE.md](./ARCHITECTURE.md): 当前主架构总览
- [FLOWS.md](./FLOWS.md): 当前 UI -> main -> data 主流程
- [architecture/agent-system.md](./architecture/agent-system.md): session/agent 运行时权威说明
- [guides/code-navigation.md](./guides/code-navigation.md): 现行代码入口导航

历史资料：
- [archives/agent-session-cleanup-2026-03-12.md](./archives/agent-session-cleanup-2026-03-12.md): 本次清理、归档、映射和排障入口
- `archive/agent-session-legacy-2026-03-12/`: 退役源码、测试和旧文档快照

注意：
- `docs/architecture/session-management.md` 等旧文档已不再描述 live 运行时，只能作为历史参考。
- archive 中的代码不参与 lint/format，也不应被新的业务逻辑重新引用。
