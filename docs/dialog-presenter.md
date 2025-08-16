# Dialog 模块文档

## 概述
Dialog 模块用于在 Electron 应用中通过渲染进程展示消息对话框。该模块支持多按钮、超时自动选择、国际化等特性，确保在多标签页/窗口环境下的唯一性和交互一致性。

## 主要组成

### 1. 主进程 Presenter (`src/main/presenter/dialogPresenter/index.ts`)
- **DialogPresenter**：实现 `IDialogPresenter` 接口，负责：
  - 生成唯一对话框请求（`DialogRequest`），通过 `eventBus` 发送到渲染进程。
  - 维护 pendingDialogs Map，确保同一窗口同一时刻只有一个对话框。
  - 处理渲染进程的响应（`DialogResponse`），或异常（如取消/超时）。
- **核心方法**：
  - `showDialog(request: DialogRequestParams): Promise<string>`：发起对话框请求，返回 Promise，resolve 为按钮 key。
  - `handleDialogResponse(response: DialogResponse)`：收到响应后 resolve Promise。
  - `handleDialogError(id: string)`：异常时 reject Promise。

### 2. 渲染进程 Store (`src/renderer/src/stores/dialog.ts`)
- **Pinia Store**：
  - 监听主进程的对话框请求事件（`DIALOG_EVENTS.REQUEST`）。
  - 管理对话框的显示、倒计时、响应与异常处理。
  - 支持超时自动选择默认按钮。
- **核心属性/方法**：
  - `dialogRequest`：当前对话框请求数据。
  - `showDialog`：对话框显示状态。
  - `timeoutMilliseconds`：倒计时剩余时间。
  - `handleResponse`：用户点击按钮或超时后响应主进程。
  - `handleError`：对话框异常处理。

### 3. 渲染进程 UI 组件 (`src/renderer/src/components/ui/MessageDialog.vue`)
- **功能**：
  - 根据 `dialogRequest` 渲染对话框内容、按钮、图标。
  - 支持国际化（i18n）、倒计时显示、按钮自定义。
  - 用户点击按钮后调用 `handleResponse` 响应主进程。
- **细节**：
  - 支持多种按钮类型（默认/取消），超时自动触发默认按钮。
  - 支持图标自定义与国际化标题/描述。

## 典型流程
1. 主进程调用 `showDialog`，通过 eventBus 发送请求到渲染进程。
2. 渲染进程 Store 监听到请求，更新 `dialogRequest` 并显示对话框。
3. 用户点击按钮或超时，Store 调用 `handleResponse`，通过 presenter 通知主进程。
4. 主进程 resolve Promise，返回结果。

## 设计要点
- **唯一性**：同一窗口同一时刻只允许一个对话框，重复请求会自动取消前一个。
- **超时处理**：支持倒计时自动选择默认按钮。
- **国际化**：支持 i18n 标题、描述、按钮。
- **解耦**：主进程与渲染进程通过事件总线通信，UI 与逻辑分离。

## 相关文件
- 主进程 Presenter：`src/main/presenter/dialogPresenter/index.ts`
- 渲染进程 Store：`src/renderer/src/stores/dialog.ts`
- 渲染进程 UI：`src/renderer/src/components/ui/MessageDialog.vue`

## 参考
- 事件定义：`@/events`、`@shared/presenter`
- 组件库：`@/components/ui/alert-dialog`
- 状态管理：`pinia`
- 国际化：`vue-i18n`
