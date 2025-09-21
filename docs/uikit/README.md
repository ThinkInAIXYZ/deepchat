# DeepChat UIKit（重构版）

本目录记录 DeepChat V3 的 UI 设计与组件库落地方案：
- 设计规范与基础（tokens、排版、间距、圆角）→ `overview.md`
- 组件拆解与命名、API 约定 → `components.md`
- 主题与品牌（DeepChat‑V3 light/dark - brand）→ `theming.md`

使用方式（示例）：

```ts
// 统一从 uikit 暴露组件
import { Button, Card, Dialog, Tabs } from '@/components/uikit'
```

注意：UIKit 基于 `src/renderer/src/components/ui` 下的 shadcn 组件进行封装与聚合，不重复造轮子，仅做一致性、皮肤与 API 规范。

## 现状评估（2024-XX）

- `src/renderer/src/components/uikit/index.ts` 已统一聚合实现层，当前绝大多数组件仍透出 shadcn 版本，后续替换时仅需在 UIKit 层重定向实现。
- 自主实现的 `IconButton`、`Toolbar`、`Chip`、`Pill`、`ListItem`、`Tabstrip` 等示例已证明 UIKit 可以容纳完全原创控件，同时继续沿用统一 token/命名。
- 大量业务仍直接引用 `@/components/ui/*`（如 `ChatInput.vue`、`ThreadsView.vue` 等），需要迁移到 `@/components/uikit`，否则未来替换实现层时会遗漏。
- shadcn 里尚未进入 UIKit 的模块（`select`、`toggle`、`hover-card`、`aspect-ratio`、`emoji-picker`、`MessageDialog`、`UpdateDialog` 等）需要补齐封装，保证导出面与文档一致。

## 使用约束与迁移建议

- 新增或重构的功能必须从 `@/components/uikit` 导入组件；禁止直接使用 `@/components/ui`，可通过 ESLint 规则或 codemod 辅助约束。
- 若确实需要底层差异化样式，应先在 UIKit 层扩展 props/slots，再由业务消费，避免在业务侧硬编码样式。
- UIKit 应作为 Storybook/测试样例的唯一入口，确保未来抽离成独立包时无需大规模查找替换。

## 封装计划追踪

| 类别 | 组件 | 状态 | 备注 |
| --- | --- | --- | --- |
| 输入 | Select / SelectContent / SelectItem / SelectTrigger / SelectValue | 待封装 | 业务已有引用，优先补齐 |
| 输入 | Toggle | 待封装 | shadcn 自带，后续评估保留与否 |
| 浮层 | HoverCard | 待封装 | 文档已列出，需要导出 |
| 布局 | AspectRatio | 待封装 | 供多媒体容器使用 |
| 复合 | MessageDialog / UpdateDialog | 待封装 | 现位于 `ui` 根目录，需重新包装 |
| 复合 | Form Field 系列 | 规划中 | 结合后续表单方案同步 |

> 注：表格（Table）、高级标签页等仍在设计阶段，等 Figma 规范稳定后再落库。
