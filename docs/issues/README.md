# ChatWindow 重构问题分析

本目录记录了 ChatWindow 重构过程中发现的问题和分析。

## 问题列表

### 1. [路由配置问题](./routing-issues.md)
- `/chat` 路由处理不完整
- Artifact Margin 计算逻辑错误
- `activeTab` 循环监听和遗留代码
- 状态恢复被调用两次
- 路由配置的设计意图不明确

### 2. [状态管理问题](./state-management-issues.md)
- 没有明确的单一数据源
- 状态同步链条过长且脆弱
- Store 职责重叠和数据重复
- UI 状态与路由的强耦合
- 多个 watch 形成复杂的依赖网络

## 分析日期

2026-01-17

## 相关文件

- `src/renderer/src/router/index.ts` - 路由配置
- `src/renderer/src/App.vue` - 应用入口
- `src/renderer/src/views/ChatTabView.vue` - 聊天视图
- `src/renderer/src/stores/chat.ts` - ChatStore
- `src/renderer/src/stores/sidebarStore.ts` - SidebarStore
- `src/main/presenter/windowPresenter/index.ts` - 窗口管理
