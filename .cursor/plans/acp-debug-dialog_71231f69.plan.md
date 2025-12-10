---
name: acp-debug-dialog
overview: 在设置页提供ACP调试全屏弹窗，可选择常用方法或自定义方法，支持JSON编辑和响应观测，基于现有stdio管道。
todos:
  - id: entry-overlay
    content: 在设置页新增入口与全屏调试弹窗框架
    status: pending
  - id: methods-json
    content: 实现常用方法选择和JSON编辑发送逻辑
    status: pending
  - id: response-view
    content: 展示响应/通知及历史清理
    status: pending
  - id: state-guard
    content: 处理loading/错误、与stdio管道串行化
    status: pending
  - id: manual-test
    content: 完成手动验证用例
    status: pending
---

# ACP 调试弹窗实现计划

1) 入口与弹窗框架

- 在 `src/renderer/settings/components/AcpSettings.vue` 增加“ACP 调试”入口；点击后打开全屏遮罩二级页面，含标题栏和关闭 X，关闭后返回设置。
- 结构采用已有 dialog/sheet 组件或自定义全屏 overlay，确保不会因失焦自动关闭。

2) 方法选择与 JSON 发送区

- 提供常用方法快捷选项（initialize、session/new、session/prompt、session/cancel等），点击后填充可编辑 JSON 模板；支持自定义方法名与 payload。
- 预填字段来自当前 ACP 配置（如 clientId/version/transport=stdio），允许继续编辑；提供发送按钮，发送前校验 JSON。

3) 结果展示与流式观测

- 显示请求/响应历史列表，展开可查看完整 JSON；实时展示 ACP 返回的数据结构（包括通知）以便调试。
- 保留手动清空历史入口；错误用显式提示。

4) 交互与状态管理

- 仅使用 stdio 传输（符合当前支持范围），复用现有 ACP 会话/Process 管道；发送时确保串行/队列避免竞争。
- 加入loading/禁用状态，防止重复发送；异常捕获后在 UI 呈现。

5) ASCII 布局方案（择一）

- 方案A（左右分栏）：
+-------------------------------------------+
| Header [ACP 调试]           [X]           |
+-------------------------------------------+
| 方法列表 | JSON 编辑与发送 | 响应/历史    |
+-------------------------------------------+
- 方案B（上下分区）：
+-------------------------------------------+
| Header [ACP 调试]  [X]                    |
+-------------------------------------------+
| 方法快捷 & 自定义 + JSON 编辑区           |
+-------------------------------------------+
| 实时响应流 / 历史                         |
+-------------------------------------------+

6) 测试与校验

- 手动验证：打开/关闭弹窗；预填与自定义方法发送；查看响应历史；错误提示。