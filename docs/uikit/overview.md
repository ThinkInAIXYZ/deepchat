# 概览与设计基础

目标：基于 Figma 的 DeepChat‑V3 设计稿（light/dark - brand），在不破坏现有架构的前提下重构 UI，统一视觉与交互，提升一致性与可维护性。

架构与约束：
- 框架：Vue 3 + Tailwind + shadcn（Radix + CVA）。
- 使用现有 `src/renderer/src/components/ui` 作为实现层，`uikit` 仅做聚合与规范。
- 导出入口：`src/renderer/src/components/uikit/index.ts`。
- i18n：所有可见文案使用 vue-i18n key（不在 UIKit 内硬编码文案）。

基础 token（与 Tailwind 对齐）：
- 颜色：`--background`/`--foreground`/`--card`/`--accent`/`--muted`/`--primary{,-foreground}`/`--secondary{,-foreground}`/`--destructive{,-foreground}` 等（见 `tailwind.config.js`）。
- 圆角：`--radius`（派生 `rounded-md/lg/xl`）。
- 阴影：沿用 shadcn 默认阴影与局部覆盖。
- 动画：统一使用 `tailwindcss-animate` 与既有 keyframes。

主题与品牌：
- 采用 `dark` class 切换；品牌色通过 CSS 变量（primary/secondary/base/...）切换。
- 设计稿命名：`DeepChat‑V3 light - brand` 与 `DeepChat‑V3 dark - brand`。
- 与品牌配置（见 `rebrand-guide.md` 与 `brand-config.*.json`）对齐。

目录约定：
- 实现层：`src/renderer/src/components/ui/*`（保持 shadcn 目录结构）。
- 聚合层：`src/renderer/src/components/uikit/index.ts`（统一导出）。
- 文档：`docs/uikit/*`（本目录）。

Figma 同步：
- 需要 Figma 文件链接或节点 ID 以同步变量（Colors、Radii、Spacing、Typography）。
- 在未接入自动同步前，UIKit 以 Tailwind 变量为准，可在 `theming.md` 中维护映射。
