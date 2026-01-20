# Model & Provider Specification

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 背景与目标
模型与供应商能力是对话质量与稳定性的核心来源。当前配置与校验分散在多个 store。目标是明确模型能力、供应商配置与可用性检查的边界。

## 术语与边界
- **Provider**：模型供应商配置与鉴权信息。
- **Model**：可调用的模型实体与能力描述。
- **Capability**：上下文长度、工具支持、推理预算等能力标记。

## 相关文档
- `docs/specs/domain-conversation/domain-conversation.md`

## 范围（In Scope）
- Provider 配置结构与可用性校验。
- Model 列表、能力探测与过滤逻辑。
- 运行时可用性与健康检查接口。
- 与设置域的配置交互契约。

## 非目标（Out of Scope）
- UI 具体布局与表单交互细节。
- 会话消息发送与流式处理。
- 搜索/RAG 与检索能力。

## 用户故事
- 用户配置 Provider 后可看到可用模型列表。
- 系统能标记模型能力差异并指导选择。

## 验收标准
- Model/Provider 逻辑不直接依赖 UI 层。
- 能力与配置校验逻辑可单独测试。
- 与 Conversation 域解耦，仅输出可用模型与能力。

## 约束与假设
- Provider 配置持久化由 Settings 域提供存储入口。
- 能力探测可能依赖主进程或远端调用。

## 开放问题
无。
