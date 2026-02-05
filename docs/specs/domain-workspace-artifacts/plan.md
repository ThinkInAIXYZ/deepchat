# Workspace & Artifacts Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- Workspace 负责会话绑定路径与文件树浏览。
- Artifacts 负责产物展示与导出入口，不参与消息执行。

## 代码现状分析（收敛点）
- Workspace 状态集中在 store，但 UI 与输入联动较多。
- Artifacts 相关 UI 与 composables 分散。

## 结构与边界
- **Workspace State**：路径、文件树、终端片段。
- **Artifacts View**：产物列表与预览。
- **Export Surface**：导出与分享入口。

## 事件与数据流
- 会话切换 -> Workspace 刷新 -> 文件树与终端片段更新。
- 产物生成 -> 产物面板更新 -> 导出入口可用。

## 迁移策略
- 先稳定 Workspace 刷新与绑定逻辑，再收敛 Artifacts UI。

## 架构变更步骤与涉及文件范围

### 1) Workspace 绑定与刷新稳定化
目标：会话与工作区绑定一致。
影响范围：
```txt
src/renderer/src/stores/workspace.ts
src/renderer/src/components/workspace/
src/renderer/src/components/chat-input/composables/useAgentWorkspace.ts
```

### 2) Artifacts 视图收敛
目标：产物展示统一入口与状态。
影响范围：
```txt
src/renderer/src/components/artifacts/
src/renderer/src/composables/useArtifacts.ts
src/renderer/src/composables/useArtifactExport.ts
```

## 测试策略
- Workspace 会话切换刷新测试。
- Artifacts 预览与导出路径测试。
