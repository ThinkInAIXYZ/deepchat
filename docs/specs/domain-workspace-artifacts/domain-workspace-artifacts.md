# Workspace & Artifacts Specification

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 背景与目标
工作区与产物面板承担文件树、终端片段与产物查看。目标是明确其与 Conversation 的关系与最小职责。

## 术语与边界
- **Workspace**：会话绑定的工作目录与文件树。
- **Artifact**：会话产生的可视化或文件类产物。

## 相关文档
- `docs/specs/domain-conversation/domain-conversation.md`

## 范围（In Scope）
- 会话绑定工作区路径与文件树浏览。
- 终端片段与运行状态展示。
- 产物列表、预览与导出入口。

## 非目标（Out of Scope）
- Conversation 消息执行逻辑。
- 工具执行与结果处理细节。

## 用户故事
- 用户切换会话后工作区与文件树自动更新。
- 用户可查看并导出产物。

## 验收标准
- 工作区状态与会话绑定，不跨会话共享。
- 产物查看不影响消息主流程。

## 约束与假设
- 访问文件系统必须通过主进程授权。

## 开放问题
无。
