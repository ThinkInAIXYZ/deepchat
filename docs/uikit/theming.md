# 主题与品牌（DeepChat‑V3 light/dark - brand）

设计稿：
- DeepChat‑V3 light - brand（浅色）
- DeepChat‑V3 dark - brand（深色）

实现方案：
- 主题切换：通过 `dark` class 切换（`tailwind.config.js` 的 `darkMode: ['class']`）。
- 品牌色：通过 CSS 变量（`--primary`、`--secondary`、`--base-*` 等）注入，Tailwind 以 `hsl(var(--...))` 读取。
- 容器与控件：统一 `bg-*/text-*` 与阴影规范，避免组件内硬编码颜色。

变量映射（与 Tailwind 对齐）：
- 前景/背景：`--foreground` / `--background`
- 容器：`--card{,-foreground}` / `--popover{,-foreground}` / `--container`
- 品牌：`--primary{,-foreground}` / `--secondary{,-foreground}`
- 状态与中性色：`--accent{,-foreground}` / `--muted{,-foreground}` / `--destructive{,-foreground}`
- 线框与环：`--border` / `--input` / `--ring`

使用建议：
- 组件优先使用变量，如按钮默认 `bg-primary text-primary-foreground`。
- 浅色/深色品牌的对比度需 >= WCAG AA（文字对比 ≥ 4.5:1）。
- 交互态（hover/active/focus）尽量基于主变量做透明度变化（如 `bg-primary/90`）。

与品牌配置对齐：
- 参考 `docs/rebrand-guide.md` 与根目录的 `brand-config.*.json` 示例。
- 后续可将 Figma 变量（Color Styles）导出 → 脚本注入 CSS 变量。

Figma 同步计划：
- 需要提供 Figma 文件链接或 node-id，按以下流程同步：
  1) 读取 Color/Radii/Spacing/Font 变量
  2) 校准 `tailwind.config.js` 与 CSS 变量
  3) 生成主题快照，写入本文件与 `brand-config.json`
