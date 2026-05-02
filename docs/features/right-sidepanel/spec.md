# 右侧按需 Sidepanel 规格

## 概述

本规格定义聊天页右侧统一 `Sidepanel` 的交互与范围。目标是替换当前错位的 `ArtifactDialog` 和残留的旧 `Workspace` 语义，把 `artifact / files / git / yo browser` 收敛到一个按需滑出的右侧面板中。

本规格明确以下产品方向：

1. 右侧 panel 默认隐藏，不常驻。
2. 顶部增加 `Workspace` 按钮作为主入口，位于分享按钮左侧。
3. artifact 完成生成后，在 panel 隐藏时自动滑出并直接进入 preview。
4. `Workspace` 左侧导航统一为 `Artifacts / Files / Git` 三段折叠区。
5. `YoBrowser` 不再提供独立窗口和左侧入口，只保留右侧嵌入模式。
6. 旧 workspace 的 `Plan / Terminal` 能力直接移除，不保留兼容壳。

## 背景与目标

1. 当前 artifact preview 虽可被唤起，但布局错乱，且与聊天主视图割裂。
2. 旧 workspace 的结构已经不再适配当前产品方向，尤其 `Plan / Terminal` 与本次需求无关。
3. 用户希望右侧像 `JSFiddle / CodePen / VS Code side panel` 一样承载文件树、轻量预览、git diff 和浏览器。
4. 当前 YoBrowser 仍是独立窗口模型，和新的右侧工作流冲突。

## 用户故事

### US-1：我可以按需打开右侧工作区

作为用户，我希望右侧面板默认隐藏，需要时再通过顶部按钮打开，不占用主聊天空间。

### US-2：artifact 完成后我能立刻看到预览

作为用户，我希望 assistant 产出 artifact 后，在不打断我当前阅读的前提下，于完成时自动滑出 preview。

### US-3：我能在一个地方查看 artifact、文件和 git 变化

作为用户，我希望右侧 `Workspace` 统一展示当前会话的 artifacts、工作目录文件树和 git 变化，并能切换查看内容。

### US-4：我能在同一个面板里使用浏览器

作为用户，我希望浏览器也在右侧 panel 内，不再跳出独立窗口。

## 功能需求

### A. 总体布局

- [ ] 聊天页改为“主内容 + 右侧滑出 panel”布局。
- [ ] 右侧 panel 默认关闭。
- [ ] panel 打开后不覆盖顶部栏和主聊天区滚动逻辑。
- [ ] panel 支持宽度调整并记忆宽度。

### B. 顶部入口

- [ ] `ChatTopBar` 在分享按钮左侧增加 `Workspace` 按钮。
- [ ] 点击按钮时：
  - 若 panel 已关闭，则打开 panel 并切到 `Workspace` tab。
  - 若 panel 已打开且当前 tab 为 `Workspace`，则关闭 panel。
  - 若 panel 已打开但当前 tab 为 `Browser`，则切回 `Workspace`。

### C. Artifact 自动滑出

- [ ] artifact 流式生成中只更新数据，不自动切换 UI。
- [ ] artifact 完成时：
  - 若 panel 关闭，则自动打开 panel。
  - 自动切到 `Workspace` tab。
  - 选中最新 artifact。
  - 默认进入 `Preview` 模式。
- [ ] 若 panel 已打开：
  - 仅更新 `Artifacts` 列表。
  - 不强制切换当前 viewer，除非当前 viewer 就是该 artifact。

### D. Workspace 结构

- [ ] `Workspace` 固定为“左导航 + 右 viewer”。
- [ ] 左导航包含三个独立折叠区：
  - `Artifacts`
  - `Files`
  - `Git`
- [ ] 三个折叠区可同时展开，也可只展开一个。
- [ ] `Artifacts` 数据来源于当前会话消息中解析出的 artifact。
- [ ] `Files` 数据来源于当前会话 `projectDir`。
- [ ] `Git` 仅在当前 workspace 是 git 仓库时显示。

### E. Viewer

- [ ] viewer 只支持三类 source：
  - `artifact`
  - `file`
  - `git-diff`
- [ ] `artifact / file` 共用 `Preview / Code` 切换。
- [ ] `git-diff` 使用只读 diff 视图。
- [ ] `Open externally` 只对真实文件可见。
- [ ] 对无法内联的二进制文件，显示元信息和外部打开入口。

### F. Browser

- [ ] sidepanel 提供 `Browser` 一级 tab。
- [ ] `Browser` 内嵌 YoBrowser 内容区域。
- [ ] 浏览器模式包含地址栏和基础 toolbar。
- [ ] 不再从主界面暴露独立 browser window。
- [ ] 左侧 `WindowSideBar` 删除浏览器入口。

### G. 清理旧 Workspace

- [ ] 删除旧 workspace 的 `Plan / Terminal` 类型、事件和 presenter 方法。
- [ ] 删除残留 `WorkspaceView / WorkspacePlan / WorkspaceTerminal` 引用。
- [ ] 不保留空壳组件或兼容事件。

## 验收标准

- [ ] 顶部 `Workspace` 按钮位于分享按钮左侧，点击可稳定打开/关闭 panel。
- [ ] artifact 完成时，panel 关闭则自动滑出并进入最新 artifact preview。
- [ ] `Artifacts / Files / Git` 三个折叠区独立展开/收起正常。
- [ ] 文件、artifact、git diff 三类 viewer 切换稳定，无错位、无残留内容。
- [ ] 非 git 仓库不显示 `Git` 区；git 仓库能展示文件变更和 diff。
- [ ] 左侧不再有 browser 入口；主界面也不再打开独立 YoBrowser window。
- [ ] 删除旧 plan/terminal 后，无事件报错、无死引用、无无效 i18n 使用。

## 非目标

1. 本规格不恢复旧 `Plan`、`Terminal`。
2. 本规格不做 git 写操作（stage / unstage / commit）。
3. 本规格不做 multi-root workspace。
4. 本规格不新增服务端 artifact 列表接口。

## 约束

1. v1 只支持单 workspace root，即当前会话 `projectDir`。
2. 用户可见文案必须走 i18n。
3. 右侧 panel 只在聊天页生效。
4. 只有 `FILES_CHANGED` 这类对新文件树仍有价值的 workspace 事件可以保留。

## 开放问题

无。
