# OpenCode ACP Agent 集成

本目录包含将 OpenCode 集成为 DeepChat 内置 ACP Agent 的完整技术规格和实施计划。

## 文档结构

### 📄 spec.md
**完整技术规格文档**

包含以下内容：
- OpenCode 和 ACP 协议的详细分析
- 集成方案设计和架构说明
- 技术实现细节（代码修改、配置等）
- 用户体验设计
- 测试计划
- 兼容性和限制说明
- 参考资料和故障排查指南

**适合阅读对象**: 开发人员、架构师、技术审查人员

### 📋 plan.md
**快速实施计划**

包含以下内容：
- 分步实施指南
- 代码修改清单
- 测试验证步骤
- 验收标准
- 回滚计划

**适合阅读对象**: 实施人员、项目经理

### ✅ tasks.md
**详细任务清单**

包含以下内容：
- 4 个阶段的详细任务分解
- 每个任务的具体步骤和预期结果
- 12 项手动测试清单
- 验收标准检查表
- 进度跟踪表格

**适合阅读对象**: 执行人员、QA 测试人员

### 🔍 installation-mechanism.md
**安装机制调研报告**

包含以下内容：
- DeepChat ACP Agent 安装机制详解
- 初始化命令配置说明
- 外部依赖检测机制
- 交互式终端实现
- 用户体验流程
- 关键代码位置索引

**适合阅读对象**: 开发人员、架构师

## 快速开始

如果你想立即开始实施，请按以下顺序阅读：

1. **了解背景** → 阅读 `spec.md` 的第 1-2 节（概述和 OpenCode 分析）
2. **查看方案** → 阅读 `spec.md` 的第 3 节（集成方案设计）
3. **了解安装机制** → 阅读 `installation-mechanism.md`（可选，深入了解）
4. **开始实施** → 按照 `tasks.md` 的清单逐项执行
5. **遇到问题** → 参考 `spec.md` 的第 10.3 节（故障排查）

### 推荐工作流程

```
📖 阅读 spec.md (15 分钟)
    ↓
🔍 阅读 installation-mechanism.md (可选，10 分钟)
    ↓
✅ 打开 tasks.md 开始执行
    ↓
✓ 勾选完成的任务
    ↓
📝 记录测试结果
    ↓
🎉 完成集成！
```

## 集成概述

### 什么是 OpenCode？

OpenCode 是一个开源的 AI 编码代理，具有以下特点：
- ✅ 完全开源（MIT 许可证）
- ✅ 支持多种 LLM 提供商（Claude、OpenAI、Google 等）
- ✅ 原生支持 ACP 协议
- ✅ 功能完整（文件操作、终端命令、MCP 集成等）

### 为什么集成 OpenCode？

1. **开源优势**: 用户可以自由定制和扩展
2. **提供商无关**: 不绑定特定的 LLM 服务
3. **功能丰富**: 支持自定义工具、项目规则等高级特性
4. **官方支持**: 在 ACP 官方 Agent 列表中

### 集成方式

将 OpenCode 作为**内置 ACP Agent** 集成，与现有的 Kimi CLI、Claude Code ACP 保持一致。

### 工作量估算

- **代码修改**: 30 分钟（仅需修改 2 个文件）
- **测试验证**: 1-2 小时
- **文档更新**: 30 分钟
- **总计**: 3-4 小时

## 技术要点

### 需要修改的文件

1. `src/shared/presenter/config.ts` - 添加类型定义
2. `src/main/presenter/configPresenter/acpConfHelper.ts` - 添加配置

### 核心配置

```typescript
// 添加到 BUILTIN_ORDER
'opencode'

// 添加到 BUILTIN_TEMPLATES
'opencode': {
  name: 'OpenCode',
  defaultProfile: () => ({
    name: 'Default',
    command: 'opencode',
    args: ['acp'],
    env: {}
  })
}
```

### 用户使用流程

1. 安装 OpenCode: `npm install -g opencode`
2. 在 DeepChat 设置中启用 OpenCode
3. 创建新对话，选择 OpenCode 作为模型
4. 设置工作目录
5. 开始对话

## 参考资料

### 官方文档
- [OpenCode 官网](https://opencode.ai)
- [OpenCode ACP 文档](https://opencode.ai/docs/acp)
- [ACP 协议官网](https://agentclientprotocol.com)

### DeepChat 文档
- [ACP 集成架构规范](../acp-integration/spec.md)
- [项目开发指南](../../../CLAUDE.md)

## 状态

- **当前状态**: 规划完成，待实施
- **目标版本**: 下一个 minor 版本
- **负责人**: 待定
- **预计完成时间**: 待定

## 问题和反馈

如有问题或建议，请：
1. 查看 `spec.md` 的故障排查部分
2. 在项目 issue 中提出
3. 联系开发团队

---

**最后更新**: 2026-01-15
**文档版本**: 1.0
