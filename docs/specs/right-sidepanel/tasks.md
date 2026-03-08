# 右侧按需 Sidepanel 任务清单

## T0 规格文档

- [x] 创建 `docs/specs/right-sidepanel/spec.md`
- [x] 创建 `docs/specs/right-sidepanel/plan.md`
- [x] 创建 `docs/specs/right-sidepanel/tasks.md`

## T1 Workspace 主进程清理

- [ ] 删除 workspace 的 `Plan / Terminal` 类型定义
- [ ] 删除 `WORKSPACE_EVENTS.PLAN_UPDATED / TERMINAL_OUTPUT`
- [ ] 删除 `PlanStateManager`
- [ ] 删除 `AgentBashHandler` 的 terminal snippet 发射
- [ ] `WorkspacePresenter` 增加 `readFilePreview / getGitStatus / getGitDiff`

## T2 Sidepanel 状态与布局

- [ ] 新增 `sidepanel` store（窗口级 + 会话级）
- [ ] `ChatTabView` 替换 `ArtifactDialog` 为 `ChatSidePanel`
- [ ] `ChatTopBar` 增加 `Workspace` 按钮并接线
- [ ] 支持 panel 默认隐藏、打开/关闭、宽度拖拽与记忆

## T3 Workspace UI

- [ ] 新增 `WorkspacePanel` 左导航三段折叠区
- [ ] 从当前会话消息解析 artifact 列表
- [ ] 接入文件树读取与文件预览
- [ ] 接入 git 状态与 diff 查看
- [ ] 统一 viewer 的 `Preview / Code / Open externally`

## T4 Artifact 自动滑出

- [ ] 调整 artifact store，不再驱动独立 drawer
- [ ] 流式阶段仅更新 artifact 数据
- [ ] 完成阶段在 panel 关闭时自动滑出并选中最新 artifact
- [ ] panel 已打开时只刷新列表，不抢焦点

## T5 Browser 嵌入

- [ ] `YoBrowserPresenter` 增加单嵌入实例生命周期
- [ ] 新增 `BrowserPanel` toolbar 与容器 bounds 同步
- [ ] 删除 `WindowSideBar` 浏览器入口
- [ ] 主界面不再唤起独立 YoBrowser window

## T6 清理与验证

- [ ] 删除旧 workspace/browser 残留引用与无用组件
- [ ] 补齐必要 i18n 文案
- [ ] 运行 `pnpm run format`
- [ ] 运行 `pnpm run i18n`
- [ ] 运行 `pnpm run lint`
