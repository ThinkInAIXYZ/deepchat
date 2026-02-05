# Renderer Store & Composables Rules Plan

**Status**: Draft  
**Created**: 2026-01-20  
**Owner**: Eric

## 目标
- 让 renderer 的 `store` 与 `composables` 具备稳定的职责边界与依赖方向。
- 基于已完成的 adapter 层，消除 UI 与 store 的跨层调用。

## 计划步骤
### 1) 现状盘点与分类
- 输出清单：`file -> category(UI/App/Adapter/Store)`。
- 标记违反依赖方向的文件与调用点。

### 2) 试点域落地
- 选 1 个核心域（如 Conversation 或 Chat Input）进行完整对齐。
- 迁移 `usePresenter`/IPC 订阅到 Adapter Composable。
- 为涉及订阅的 store 补齐 `useXxxStoreLifecycle`。

### 3) 横向扩展到 Top 3 Store
- 优先治理 `mcp.ts`、`modelStore.ts`、`chat.ts`。
- 拆分流程编排为 App Composable。

### 4) 规则固化与持续约束
- 引入 lint 规则或脚本约束，阻止反向依赖回流。
- 将规则写入团队约定与 PR 检查项。

## 产出物
- 规则文档与分类清单。
- 1 个试点域的对齐实现。
- 规则检查脚本或 lint 配置（可选）。

## 验证方式
```bash
rg "usePresenter" src/renderer/src
rg "window\\.electron|ipcRenderer" src/renderer/src
rg "useXxxStoreLifecycle" src/renderer/src
```
