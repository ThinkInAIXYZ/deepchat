# Search & Retrieval Specification

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 背景与目标
搜索与检索涉及外部引擎与上下文扩展，易与对话主流程耦合。目标是定义最小边界与数据流，保证可替换性。

## 术语与边界
- **Search Engine**：外部检索引擎与配置。
- **Retrieval**：查询与结果聚合流程。

## 范围（In Scope）
- 搜索引擎配置与可用性校验。
- 检索请求的发起与结果结构化。
- 检索结果的展示与引用入口。

## 非目标（Out of Scope）
- Conversation 核心消息模型。
- 具体 LLM 调用与上下文拼接策略。

## 用户故事
- 用户启用检索后可看到检索结果。
- 检索配置变更后立即生效。

## 验收标准
- 检索逻辑与 Conversation 域解耦。
- 检索结果可独立测试与替换。

## 约束与假设
- 引擎配置持久化由 Settings 域提供入口。

## 开放问题
无。
