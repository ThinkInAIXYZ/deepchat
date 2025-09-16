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
