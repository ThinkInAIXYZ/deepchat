# Skill 安装拖拽交互

## 背景
`SkillInstallDialog.vue` 当前提供「文件夹 / ZIP / URL」三种安装方式，文件夹与 ZIP 标签页仅支持点击触发原生文件选择器（`border-dashed` 区域只是视觉样式，绑定 `@click`）。i18n 中预留的 `dragNotSupported` 文案也说明拖拽暂未实现。

## 目标
为「文件夹」与「ZIP」两个上传区域增加拖拽（drag & drop）交互，并兼容：
- 拖入**文件夹** → 走 `installFromFolder`
- 拖入 **.zip 文件** → 走 `installFromZip`

点击选择的既有行为保持不变。

## 用户故事
- 作为用户，我可以把一个 skill 文件夹直接拖到弹窗的上传区域完成安装，而不必逐级点击系统文件选择器。
- 作为用户，我可以把一个 `.zip` 包拖进来直接安装。
- 拖拽过程中上传区域有高亮反馈；拖入不支持的内容时给出明确错误提示。

## 验收标准
1. 文件夹 / ZIP 两个标签页的拖拽区域响应 `dragenter/dragover/dragleave/drop`，拖拽悬停时有高亮态。
2. 拖入目录调用文件夹安装；拖入单个 `.zip` 文件调用 ZIP 安装（按拖入内容自动路由，不强依赖当前标签页）。
3. 拖入非 `.zip` 文件或同时拖入多项不合法内容时，toast 报错且不发起安装。
4. 安装中（`installing`）禁止再次拖拽触发。
5. 成功/冲突/失败的处理沿用既有 `handleInstallResult` 逻辑（含覆盖确认弹窗）。
6. 既有点击选择行为不回归。

## 非目标
- URL 标签页不涉及拖拽。
- 不改动主进程安装逻辑（`skillPresenter`）与 IPC 契约。

## 约束 / 技术要点
- Electron 渲染进程通过 `window.api.getPathForFile(file)`（底层 `webUtils.getPathForFile`）获取拖拽文件/文件夹的本地绝对路径，主进程安装接口均基于绝对路径。
- 用 `DataTransferItem.webkitGetAsEntry()` 同步判断 drop 项是目录还是文件。
- 复用既有 `useDragAndDrop` 思路管理高亮态。
