# DeepChat Design System — CSS 令牌

> 从 `src/renderer/src/assets/style.css` 提取，基于 Tailwind CSS v4 `@theme inline` + CSS 自定义属性。
> 颜色详见「一~九」，排版 / 圆角 / 模糊 / 层级 / 动效 / 布局见「十~十五」，
> 系统化机制（色阶计算、Feedback、状态、浮层、密度、Token 契约）见「十六~二十一」。

---

## 一、核心色阶

### 1.1 Base 灰度（11 阶）

| Token | Light | HSL |
|-------|-------|-----|
| `base-50` | 纯白 | `hsl(0 0% 100%)` |
| `base-100` | 近白 | `hsl(0 0% 98.1%)` |
| `base-200` | 浅灰 | `hsl(0 0% 93.4%)` |
| `base-300` | 灰 | `hsl(0 0% 85.9%)` |
| `base-400` | 中灰 | `hsl(0 0% 67.1%)` |
| `base-500` | 半灰 | `hsl(0 0% 48.9%)` |
| `base-600` | 深灰 | `hsl(0 0% 36.5%)` |
| `base-700` | 暗灰 | `hsl(0 0% 28.7%)` |
| `base-800` | 深暗 | `hsl(0 0% 19.5%)` |
| `base-900` | 近黑 | `hsl(0 0% 13.2%)` |
| `base-950` | 极暗 | `hsl(0 0% 12.2%)` |
| `base-1000` | 纯黑 | `hsl(0 0% 1.2%)` |

### 1.2 Primary 蓝色（11 阶）

| Token | Hue | Lightness |
|-------|-----|-----------|
| `primary-50` | 208.6° | 94.3% |
| `primary-100` | 210° | 88.6% |
| `primary-200` | 210° | 80% |
| `primary-300` | 209.7° | 71.6% |
| `primary-400` | 209.8° | 62.9% |
| `primary-500` | 209.8° | 54.3% |
| `primary-600` *(主色)* | 209.9° | 42.9% |
| `primary-700` | 209.8° | 34.3% |
| `primary-800` | 209.6° | 27.8% |
| `primary-900` | 210° | 21.6% |
| `primary-950` | 209.6° | 15.1% |
| `primary-1000` | 210° | 8.6% |

### 1.3 Zinc 辅助灰度（10 阶）

| Token | HSL |
|-------|-----|
| `zinc-50` | `hsl(0 0% 98%)` |
| `zinc-100` | `hsl(240 4.8% 95.9%)` |
| `zinc-200` | `hsl(240 5.9% 90%)` |
| `zinc-300` | `hsl(240 4.9% 83.9%)` |
| `zinc-400` | `hsl(240 5.5% 64.3%)` |
| `zinc-500` | `hsl(240 4.2% 46.3%)` |
| `zinc-600` | `hsl(240 5.7% 34.1%)` |
| `zinc-700` | `hsl(240 5.3% 26.1%)` |
| `zinc-800` | `hsl(240 3.7% 15.9%)` |
| `zinc-900` | `hsl(240 5.9% 10%)` |
| `zinc-950` | `hsl(240 10% 3.9%)` |

---

## 二、语义色（shadcn 风格）

### 2.1 Light 模式

| Token | 值 | 用途 |
|-------|-----|------|
| `background` | `#fff` | 页面背景 |
| `foreground` | `hsl(0 0 15% / 1)` | 正文文字 |
| `card` | `#fff` | 卡片背景 |
| `card-foreground` | `hsl(0 0 15% / 1)` | 卡片文字 |
| `popover` | `#fff` | 弹出层背景 |
| `popover-foreground` | `hsl(0 0 15% / 1)` | 弹出层文字 |
| `primary` | `hsl(210 100% 43%)` | 主色 |
| `primary-foreground` | `#fff` | 主色上文字 |
| `secondary` | `hsl(0 0 0% / 0.05)` | 次要色 |
| `secondary-foreground` | `hsl(0 0 15% / 0.5)` | 次要色文字 |
| `muted` | `hsl(0 0 0% / 0.03)` | 柔和背景 |
| `muted-foreground` | `hsl(0 0 15% / 0.5)` | 柔和文字 |
| `accent` | `hsl(0 0 15% / 0.05)` | 强调背景 |
| `accent-foreground` | `hsl(0 0 15% / 0.8)` | 强调文字 |
| `destructive` | `hsl(0 84.2% 60.2%)` | 危险/删除 |
| `destructive-foreground` | `hsl(0 0% 98%)` | 危险上文字 |
| `border` | 默认 `base-200` → `hsl(0 0% 93.4%)` | 边框 |
| `input` | `hsl(0 0 10% / 0.1)` | 输入框边框 |
| `ring` | `primary-600` → `hsl(209.9 100% 42.9%)` | 聚焦环 |
| `chart-1` ~ `chart-5` | 对应 `primary-600/200/400/300/100` | 图表色 |

### 2.2 Sidebar 侧边栏

| Token | Light | Dark |
|-------|-------|------|
| `sidebar` | `#fff` | `base-900` |
| `sidebar-foreground` | `base-800` | `base-200` |
| `sidebar-primary` | `primary-600` | (继承) |
| `sidebar-primary-foreground` | `#fff` | (继承) |
| `sidebar-accent` | `base-50` | `base-800` |
| `sidebar-accent-foreground` | `base-800` | `base-200` |
| `sidebar-border` | `base-200` | `base-800` |
| `sidebar-ring` | `primary-600` | (继承) |

### 2.3 Dark 模式覆盖

| Token | Dark 值 |
|-------|---------|
| `background` | `hsl(0 0 5% / 1)` |
| `foreground` | `base-200` |
| `card` | `#121212` → `hsl(0 0% 7.1%)` |
| `card-foreground` | `base-200` |
| `popover` | `#121212` → `hsl(0 0% 7.1%)` |
| `popover-foreground` | `#fff` |
| `secondary` | `hsl(0 0 100% / 0.05)` |
| `secondary-foreground` | `base-50` |
| `muted` | `hsl(0 0 100% / 0.03)` |
| `muted-foreground` | `hsl(0 0 100% / 0.5)` |
| `accent` | `hsl(0 0 100% / 0.1)`（Dashboard interactive-card hover 基准） |
| `accent-foreground` | `hsl(0 0 100% / 0.8)` |
| `destructive` | `hsl(0 62.8% 30.6%)` |
| `border` | `base-800` |
| `input` | `base-700` |

---

## 三、自定义语义 Token（新主题体系）

### 3.1 背景类

| Token | Light | Dark |
|-------|-------|------|
| `bg-accent` | `hsl(0 0 15% / 0.05)` | `hsl(0 0 100% / 0.05)` |
| `bg-window-background` | `hsl(0 0 95% / 0.8)` | `hsl(0 0 5% / 0.5)` |
| `bg-background-70` | `hsl(0 0 100% / 0.7)` | `hsl(0 0 15% / 0.7)` |
| `bg-card` | `hsl(0 0 100%)` | `hsl(217 6% 15%)` |
| `bg-muted` | (继承 `muted`) | `hsl(0 0 100% / 0.03)` |
| `bg-primary` | `hsl(210 100% 43%)` | (相同) |
| `bg-primary-70` | `hsl(210 100% 43% / 0.7)` | (相同) |
| `bg-primary-700` | `hsl(210 100% 37%)` | (相同) |

### 3.2 文字类

| Token | Light | Dark |
|-------|-------|------|
| `text-foreground` | `hsl(0 0% 14%)` | `hsl(0 0 100%)` |
| `text-primary` | `hsl(210 100% 43%)` | (相同) |
| `text-primary-foreground` | `hsl(0 0 100%)` | (相同) |
| `text-accent-foreground` | `hsl(0 0 15% / 0.8)` | `hsl(0 0 100% / 0.8)` |
| `text-secondary-foreground` | `hsl(0 0 15% / 0.5)` | `hsl(0 0 100% / 0.5)` |
| `text-muted-foreground` | `hsl(0 0 15% / 0.2)` | `hsl(0 0 100% / 0.2)` |
| `text-green` | `hsl(142 71% 45%)` | (相同) |
| `text-red` | `hsl(0 73% 58%)` | (相同) |
| `text-skeleton-primary` | `hsl(0 0 15% / 0.05)` | `hsl(0 0 100% / 0.05)` |

### 3.3 边框 / 阴影 / 窗口

| Token | Light | Dark |
|-------|-------|------|
| `border` | `hsl(0 0 0% / 0.05)` | `hsl(0 0 100% / 0.05)` |
| `border-window-outside` | `hsl(0 0 21% / 0.25)` | `hsl(0 0 0% / 0.4)` |
| `shadow-card` | `hsl(0 0 0% / 0.1)` | `hsl(0 0 0% / 0.4)` |
| `window-inner-border` | `hsl(0 0 100% / 0.5)` | `hsl(0 0 100% / 0.05)` |

### 3.4 语法高亮

| Token | Light | Dark |
|-------|-------|------|
| `syntax-bold` | `hsl(227 76% 41%)` | `blue-500` |
| `syntax-comment` | `hsl(218 12% 64%)` | `gray-400` |
| `syntax-const` | `hsl(176 100% 24%)` | `emerald-300` |
| `syntax-property` | `hsl(221 97% 54%)` | `blue-100` |
| `syntax-symbol` | `hsl(0 0 15%)` | `hsl(0 0 100% / 0.8)` |
| `syntax-variable` | `blue-800` | `blue-300` |

---

## 四、通知色（Notifications）

| 类型 | Light 背景 | Light 文字 | Dark 背景 | Dark 文字 |
|------|-----------|-----------|----------|----------|
| **Success** | `hsl(142 48% 96%)` | `hsl(142 48% 28%)` | `hsl(142 22% 13%)` | `hsl(142 38% 72%)` |
| **Info** | `hsl(210 58% 96%)` | `hsl(210 52% 30%)` | `hsl(210 24% 14%)` | `hsl(210 42% 74%)` |
| **Warning** | `hsl(42 72% 95%)` | `hsl(38 58% 28%)` | `hsl(42 24% 13%)` | `hsl(42 48% 72%)` |
| **Error** | `hsl(0 58% 96%)` | `hsl(0 48% 34%)` | `hsl(0 24% 14%)` | `hsl(0 44% 75%)` |

---

## 五、用量指示色（Usage）

| Token | Light | Dark |
|-------|-------|------|
| `usage-low` | `hsl(142 71% 45%)` | `hsl(142 40% 60%)` |
| `usage-mid` | `hsl(48 96% 53%)` | `hsl(48 80% 60%)` |
| `usage-high` | `hsl(0 72% 51%)` | `hsl(0 70% 65%)` |

---

## 六、shadcn Theme 备用色系（`theme-*`）

| Token | 值 |
|-------|-----|
| `theme-background` | `white` |
| `theme-foreground` | `slate-950` |
| `theme-card` | `white` |
| `theme-card-foreground` | `slate-950` |
| `theme-popover` | `white` |
| `theme-popover-foreground` | `slate-950` |
| `theme-primary` | `blue-600` |
| `theme-primary-foreground` | `slate-50` |
| `theme-secondary` | `slate-100` |
| `theme-secondary-foreground` | `slate-900` |
| `theme-muted` | `slate-100` |
| `theme-muted-foreground` | `slate-500` |
| `theme-accent` | `slate-100` |
| `theme-accent-foreground` | `slate-900` |
| `theme-destructive` | `red-600` |
| `theme-destructive-foreground` | `slate-50` |
| `theme-border` | `slate-200` |
| `theme-input` | `slate-200` |
| `theme-ring` | `slate-950` |

---

## 七、完整 Tailwind 调色板

项目通过 `@theme inline` 注册了完整 Tailwind 色板（每色 50-950 共 11 阶），涵盖：

| 色系 | 说明 |
|------|------|
| `slate` | 蓝灰 |
| `gray` | 中性灰 |
| `zinc` | 暖灰 |
| `neutral` | 纯灰 |
| `stone` | 暖石色 |
| `red` | 红 |
| `orange` | 橙 |
| `amber` | 琥珀 |
| `yellow` | 黄 |
| `lime` | 青柠 |
| `green` | 绿 |
| `emerald` | 翡翠 |
| `teal` | 青 |
| `cyan` | 青蓝 |
| `sky` | 天蓝 |
| `blue` | 蓝 |
| `indigo` | 靛蓝 |
| `violet` | 紫罗兰 |
| `purple` | 紫 |
| `fuchsia` | 品红 |
| `pink` | 粉 |
| `rose` | 玫瑰 |

---

## 八、使用方式

### Tailwind 类名
```html
<!-- 语义色 -->
<div class="bg-background text-foreground">...</div>
<div class="bg-primary text-primary-foreground">...</div>
<div class="border-border">...</div>

<!-- 色阶 -->
<div class="bg-base-100 text-base-800">...</div>
<div class="bg-primary-600 text-primary-50">...</div>

<!-- 自定义 Token -->
<div class="bg-window-background text-text-foreground">...</div>
<div class="border-window-inner-border">...</div>
```

### CSS 自定义属性
```css
.my-component {
  background: var(--bg-card);
  color: var(--text-foreground);
  border: 1px solid var(--border);
}
```

---

## 九、设计决策记录

1. **Base 色阶** 使用 0% 饱和度灰度（纯中性），作为主背景体系。
2. **Primary 蓝色** 色相锁定在 ~210°，饱和度 72-100%，作为品牌主色。
3. **双主题体系并存**：shadcn 语义色（`background`/`foreground` 等）+ 自定义 Token（`bg-*`/`text-*` 等），自定义 Token 为实际组件使用的主要体系。
4. **Dark 模式** 通过 `.dark` / `[data-theme='dark']` 选择器触发，同时保留 `prefers-color-scheme` 媒体查询作为系统级兜底。
5. **暗色表面与 hover**：所有表面（包括 shadcn 消费的 `card` / `popover`）以 `#121212` 为基准，禁止引入 20% 灰色表面；交互 hover 统一消费 `accent`，其暗色值为 `foreground` 的 10% 透明度，与 Dashboard 的 interactive-card 一致。必须在主题 token 层调整，禁止修改 `src/shadcn` 源码或在组件中硬编码颜色。
6. **通知色** 使用独立的 `dc-notification-*` 命名空间，与 shadcn 语义色解耦。
7. **语法高亮色** 在 Light/Dark 下分别使用硬编码 HSL 和 Tailwind 色板引用。

---

## 十、排版 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--dc-font-family` | `Geist, Noto Sans, ui-sans-serif, system-ui, sans-serif` | 正文字体栈（@font-face 内置 Geist） |
| `--dc-code-font-family` | `JetBrains Mono, Fira Code, Menlo, Monaco, Consolas, monospace` | 代码 / 等宽（`code pre kbd samp .font-mono`） |
| `--dc-font-scale` | `1`（`html.text-sm`=0.875 · base=1 · lg=1.125 · xl=1.25 · 2xl=1.5） | 全局字号缩放 |
| `--text-weight` | `400`（`.font-text`） | 正文默认字重 |
| `--display-weight` | `700`（`.font-display`） | 标题 / 强调字重 |

常用字号阶梯（Tailwind 默认）：

| 类 | 大小 | 行高 |
|----|------|------|
| `text-xs` | 12px | 16px |
| `text-sm` | 14px | 20px |
| `text-base` | 16px | 24px |
| `text-lg` | 18px | 28px |
| `text-xl` | 20px | 28px |
| `text-2xl` | 24px | 32px |

---

## 十一、圆角与模糊

### 圆角（语义级）

| Token | 计算 | 值 |
|-------|------|-----|
| `--radius-sm` | `calc(var(--radius) - 4px)` | 8px |
| `--radius-md` | `calc(var(--radius) - 2px)` | 10px |
| `--radius-lg` | `var(--radius)` | 12px |
| `--radius-xl` | `calc(var(--radius) + 4px)` | 16px |

> 基准 `--radius: 0.75rem`（12px）。控件用 sm/md，容器用 lg，浮层用 xl。

### 模糊（玻璃效果，三档语义值）

| Token | 值 | 工具类 | 适用 |
|-------|-----|--------|------|
| `--dc-blur-soft` | 8px | `.dc-blur-soft` | 搜索条、状态浮条 |
| `--dc-blur-panel` | 16px | `.dc-blur-panel` | 粘性顶栏、输入器 |
| `--dc-blur-overlay` | 26px | `.dc-blur-overlay` | Spotlight / Agent 计划浮层 |

> 优先使用上述工具类，不要随手写 `backdrop-blur-*` 临时值。

---

## 十二、层级（z-index 阶梯）

| Token | 值 | 用途 |
|-------|-----|------|
| `--dc-z-base` | 0 | 页面内容 |
| `--dc-z-sticky` | 10 | 粘性顶栏、tab 栏 |
| `--dc-z-float` | 20 | 浮动元素、滚动 pill |
| `--dc-z-sidepanel` | 30 | 侧滑面板（全屏） |
| `--dc-z-popover` | 50 | Popover / Tooltip |
| `--dc-z-spotlight` | 90 | 系统级浮层 |
| `--dc-z-modal` | 100 | Dialog |
| `--dc-z-toast` | 1000 | Toast |

> 优先 `z-[var(--dc-z-*)]`；tooltip/popover 用 `--dc-z-popover`，禁止使用 `--dc-z-toast`。

---

## 十三、动效 Token

| Token | 值 | 用途 |
|-------|-----|------|
| `--dc-motion-fast` | 140ms | hover、轻量内容切换 |
| `--dc-motion-default` | 220ms | 面板开合、toggle |
| `--dc-motion-slow` | 320ms | 大型浮层出入 |
| `--dc-ease-out-express` | `cubic-bezier(0.16, 1, 0.3, 1)` | 快起→精确落点 |
| `--dc-ease-out-soft` | `cubic-bezier(0.22, 1, 0.36, 1)` | 柔和收尾 |

内置动画：`accordion-down/up`（fast + soft）、`collapsible-down/up`（default + express）、
`pulse`（2.4s 无限）、`loading-shimmer`（1.6s 线性）。

> `prefers-reduced-motion` 下全部动画压缩为 1ms 且仅执行一次；主题切换瞬间通过
> `.dc-theme-switching` 关闭所有过渡避免重绘卡顿。

---

## 十四、滚动条与阴影

### 滚动条（常驻导航线）

| 状态 | 浅色 | 深色 |
|------|------|------|
| 宽/形状 | 8px · `rounded-full` · 轨道透明 | 同左 |
| thumb | `rgba(107, 114, 128, 0.55)` | `rgba(148, 163, 184, 0.45)` |
| thumb hover | `rgba(148, 163, 184, 0.8)` | `rgba(148, 163, 184, 0.7)` |

### 阴影（最高只到 lg）

| 等级 | 用途 |
|------|------|
| `shadow-sm` | 卡片、下拉菜单 |
| `shadow-md` | Popover、菜单内容 |
| `shadow-lg` | Dialog（最高阴影等级） |

---

## 十五、布局与间距常量

| 断点 | 值 |
|------|-----|
| `sm` / `md` / `lg` / `xl` / `2xl` | 640 / 768 / 1024 / 1280 / 1536px |

| 间距 | 值 |
|------|-----|
| `spacing-0.5` / `1` / `2` | 2 / 4 / 8px |
| `spacing-3` / `4` / `5` / `6` | 12 / 16 / 20 / 24px |
| `spacing-8` / `10` / `12` | 32 / 40 / 48px |

| 页面常量 | 值 |
|----------|-----|
| 设置内容区 | `max-w-7xl`（`SettingsPageShell`） |
| 消息内容区 | `max-w-5xl` 居中 |
| 会话列表 | 240px |
| Agent rail | 48px |
| 开关控件 | 32 × 18.4px（除以 `--dc-font-scale` 缩放） |

---

## 十六、色阶计算契约

### 16.1 唯一锚点

一切品牌色由**一个源色**派生：`primary-600 ≡ --primary ≡ hsl(210 100% 43%)`。

### 16.2 Primary 亮度阶梯

| 色阶 | 亮度 | 色阶 | 亮度 |
|------|------|------|------|
| 50 | 94.3% | 700 | 34.3% |
| 100 | 88.6% | 800 | 27.8% |
| 200 | 80% | 900 | 21.6% |
| 300 | 71.6% | 950 | 15.1% |
| 400 | 62.9% | 1000 | 8.6% |
| 500 | 54.3% | — | — |
| **600** | **42.9%（锚点）** | — | — |

### 16.3 派生规则

- **饱和度**：亮端 50–500 去饱和（50 阶约 72% → 600 阶 100%），暗端 600–1000 锁 100%。
  淡色端去饱和避免「粉色感」，暗色端保饱和维持品牌识别。
- **中性色**：`base-*` 饱和度恒 0，亮度 100% → 1.2%；`base-800`（19.5%）为深色边框参考点。
- **新增色阶**：必须按本阶梯插值（oklch 感知均匀插值优先），禁止手写无关色相或任意亮度。
- **不可派生场景**：`destructive`、`emerald`、`amber` 等语义色独立于品牌色阶，各自维护
  亮/暗两套，不并入 primary。

### 16.4 对比度验收

| 文本层级 | 最小对比度 | 适用范围 |
|----------|-----------|----------|
| 正文 | 4.5:1 | `foreground` / `text-foreground` 全部正文 |
| 辅助信息 | 3:1 | `muted-foreground`、时间戳、描述 |
| 状态 pill | 3:1 | pill 文字与 pill 底色 |
| 品牌蓝按钮 | 3:1 | 白字 on `primary`（43% 亮度 + 白字） |

验收时用相对亮度/oklch 计算，双主题分别核验；不满足则上移一个色阶，而不是微调透明度。

---

## 十七、Feedback 机制矩阵

### 17.1 四类反馈通道

| 通道 | 载体 | 特征 |
|------|------|------|
| 静态状态 | 状态 pill、徽标、开关 | 常驻，不打断 |
| 瞬时通知 | Toast | 自动消失，`aria-live` polite，不抢焦点 |
| 模态确认 | AlertDialog | 需用户确认，焦点陷阱 |
| 内联校验 | **UX 优先**（元素自身状态 + 防错设计），文字最后手段 | 就地表达，不打断流程 |

### 17.2 操作 × 通道映射

| 操作类型 | 乐观更新 | 成功反馈 | 失败反馈 | 不可逆确认 |
|----------|:---:|------|------|:---:|
| switch / toggle | ✓ 立即切换 | 状态自明（可选 toast） | 回滚 + destructive toast | — |
| 失焦自动保存 | 内联「保存中→已保存」 | 同上 | destructive toast + 保留内容 | — |
| 创建 / 编辑提交 | — | 关闭浮层 + 列表即时更新 | destructive toast + 保留表单内容 | — |
| 删除 | — | toast | destructive toast | **必选** AlertDialog |
| 覆盖导入 | — | 结果 toast（含新增/更新统计） | destructive toast（含失败原因） | 覆盖语义需确认 |

### 17.3 Toast 契约

- 时长：success 3s · destructive 5s
- 同屏 ≤ 3 条，可手动关闭，不抢焦点
- 含失败原因时使用描述行，不用标题堆叠长句

### 17.4 内联校验：UX 优先原则

错误发生在元素上，就用**元素自身的语言**表达，不要一上来就往旁边注入文字。优先级从高到低：

1. **预防（防错设计）**：约束输入本身——`maxLength`、类型/格式过滤、选择器替代自由输入、
   placeholder 给出正确示例、无效状态下禁用提交按钮。让错误不发生，而不是发生后解释。
2. **元素自身状态**：destructive 边框 / ring 变色、错误图标（icon-only + tooltip +
   `aria-label`）、焦点停留在出错字段、光标定位到问题位置。
3. **微动效**：出错瞬间轻量 shake（fast 140ms，一次），配合 ring 变化引起注意，不重复播放。
4. **文字说明（最后手段）**：仅当错误**无法从元素状态推断**（如格式规则、业务约束）时才
   注入一行短句，并用 `aria-describedby` 关联；说明写「如何修正」，不重复已可见的事实。

补充规则：

- 元素自身的错误状态必须自洽：用户在编辑该字段时错误态即时清除（不残留红色）。
- 错误恢复优先「就地修正」（光标定位、保留输入），避免让用户删除重输。
- 校验消息不堆叠：同一时刻每个字段最多一条说明。
- 旁注文字不是默认形态——评审时出现「每个输入框下面都挂一段提示」的界面即判定违规。

### 17.5 数据区四状态契约

任何数据驱动的区块必须显式覆盖四态，缺一不可：

| 状态 | 必备元素 |
|------|----------|
| loading | skeleton（与目标形状一致）或 spinner |
| empty | 对象说明 + 一个明确主行动 |
| error | 失败说明 + 重试入口 |
| disabled | 原因说明或可恢复的入口 |

---

## 十八、语义状态体系

统一状态集：`neutral / active / success / warning / danger / disabled`。

| 状态 | 色值来源 | pill 样式 | 文案时态 |
|------|----------|-----------|----------|
| neutral | `muted` + `muted-foreground` | 灰底灰字 | 名词（「本地」「导入」） |
| active | `primary` / `primary-10` 底 | 蓝底蓝字 | 名词（「已启用」「默认」） |
| success | `emerald` 系 | 绿底绿字 | 过去时（「已完成」「已同步」） |
| warning | `amber` 系 | 琥珀底琥珀字 | 现在时（「待处理」「注意」） |
| danger | `destructive` 系 | 红底红字 | 现在时（「失败」「不可用」） |
| disabled | `muted` + 低对比文字 | 灰底灰字 + 禁止光标 | 名词（「已禁用」） |

规则：

- 状态色只出现在**小面积**（图标、pill、细边框）；面积越大对比度要求越高，禁止大面积状态底色。
- 状态文案用**完成时/名词**表达事实，不用祈使句（「点击启用」属于按钮文案，不属于状态）。
- 状态色不承担装饰职能，同一信息不得同时用两个状态色表达。

---

## 十九、浮层与焦点契约

| z 层 | 交互契约 |
|------|----------|
| Popover / Tooltip（50） | Esc 或外部点击关闭；无焦点陷阱 |
| Dialog（100） | 焦点陷阱；关闭后焦点还原到触发元素 |
| Sheet（30，全屏侧滑） | 入场焦点移到首个可编辑字段；Esc 关闭；背景滚动锁定 |
| Toast（1000） | 不抢焦点；`aria-live` polite 播报 |
| Spotlight（90） | 焦点陷阱；系统级语义，覆盖全窗口 |

通用规则：

- 同一时刻只允许一个 true modal；AlertDialog 叠加在 Dialog 之上是唯一允许的嵌套。
- 浮层关闭后必须还原用户的上下文（滚动位置、焦点、选择状态）。
- z-index 一律走 `--dc-z-*` 阶梯，禁止绕过。

---

## 二十、密度与命中区契约

- 基础单位 4px（`spacing-0.5`=2px 为唯一例外）。
- 控件高度表：

| 控件 | 高度 |
|------|------|
| 按钮 sm / 默认 / lg | 32 / 36 / 40px |
| 输入框 / 选择器 | 36px |
| 图标按钮 | 28–32px |
| 开关 | 32 × 18.4px |
| 会话列表行 | 36–40px |
| 数据行（列表/表格） | 44–52px |

- 最小可点击区 ≥ 24×24px；icon-only 按钮不足时用 padding 或 wrapper 补足。
- 间距只用既有 spacing 阶梯，禁止中间值（如 13px、22px）。

---

## 二十一、新增 Token 契约

新增或修改设计令牌时，必须同时满足：

1. **颜色成对**：light / dark 两套值同时定义，不得只改一侧。
2. **标明用途**：每个 token 至少一个使用场景和禁用场景（写进注释）。
3. **对比度验收**：按 §16.4 通过双主题对比度检查。
4. **阶梯内取值**：motion 只用 140/220/320ms；radius 只用 8/10/12/16px；blur 只用 8/16/26px；
   z 只用 `--dc-z-*`；禁止新增中间档。
5. **禁止硬编码**：组件内不写裸色值（局部透明度叠加除外），一律引用语义 token。
6. **来源同步**：token 变更必须在 `src/renderer/src/assets/style.css` 与本文档同步落地。

---

## 二十二、dc-ui 设计组件层（`src/dc-ui/`）

与 `@shadcn` 同级的封装层（别名 `@dc-ui/*`），消费语义令牌与 shadcn 原语，
收敛 renderer 中的重复写法。组件以稳定交互语义分组并统一由 `@dc-ui/*` 导出。

**设计哲学：功能聚合、少而全。** 一个组件聚合一类交互的全部能力（如 `DcButton`
聚合 icon / tooltip / label / loading / active / 插槽），禁止为单一场景另立组件；
需要新能力时先扩展既有组件，再考虑新增。按钮体系收敛为一条链：
`DcButton`（唯一按钮）→ `DcSubmitButton`（表单提交语义）→ `DcFormActions`（按钮组）。

| 组件 | 导入路径 | 契约要点 |
|------|----------|----------|
| `DcButton` | `@dc-ui/components/button` | 统一按钮：variant/size 透传（`xs` 紧凑档 h-7 text-xs；`icon`/`icon-sm`/`icon-xs`/`icon-lg` 图标档 32/28/24/40px）；`icon`/`icon-size`（3/3.5/4）/`icon-class` 替代手写 `<Icon>`；显式 `tooltip` 内建悬浮提示，支持 `tooltip-side`/`tooltip-side-offset`/`tooltip-delay-duration`/`tooltip-content-class`/`tooltip-ignore-non-keyboard-focus`；`label` 仅提供可访问名（icon-only 至少 label/tooltip 其一，缺失 DEV 告警）；`loading` 内建 Spinner；`active` 高亮态；`$attrs`（data-testid 等）透传到按钮元素；默认插槽承接任意内容 |
| `DcStatusPill` | `@dc-ui/components/status-pill` | 六状态（neutral/active/success/warning/danger/disabled）+ 别名（running/loading/auth-required/auth-error/error/stopped/offline）；圆点 + 文案；`pulse`（loading）；`size` sm/xs |
| `DcConfirmDialog` | `@dc-ui/components/confirm-dialog` | AlertDialog 封装；`danger` 驱动 destructive 确认；`busy` 时禁用双按钮 + Spinner；`confirm-label`/`cancel-label` 默认走 `common.*` i18n；`confirm-attrs`/`cancel-attrs`/`busy-data-testid` 透传（保留测试钩子）；默认插槽放错误信息，`actions` 插槽自定义 footer。**confirm 不自动关窗**，`@confirm` 处理器负责关闭 |
| `DcToggleRow` | `@dc-ui/components/toggle-row` | label + Switch 行；有 `description` 时双行布局；`trailing` 插槽；`aria-label` 缺省用 label。Switch 必须用 `:model-value` + `@update:model-value`（reka-ui 2.x 约定，`checked`/`update:checked` 无效） |
| `DcEmpty` | `@dc-ui/components/empty` | shadcn Empty 封装；`icon`/`title`/`description` + `action` 插槽（空状态单一主行动） |
| `DcSkeleton` | `@dc-ui/components/skeleton` | `width`/`height`/`rounded` 参数化，`bg-muted/60` 基底 |
| `DcToast` | `@dc-ui/components/toast` | `notifyRenderer` 适配层；`success/info/warning/error({title, description?, code?})`；时长沿用 kind 策略，不新增 per-call duration |
| `DcTooltip` | `@dc-ui/components/tooltip` | 触发器 + 内容封装；`content`/`side`/`side-offset`/`disabled`/`delay-duration`；内建 Provider 200ms；**用于非按钮提示**（按钮提示一律走 `DcButton` 的 `tooltip` prop） |
| `DcSheetPanel` | `@dc-ui/components/sheet-panel` | 唯一标准 Sheet：`appearance="panel"` 为玻璃 header + ScrollArea 正文 + footer；`appearance="plain"` 兼容详情 Sheet 的默认 padding、`sm:max-w-xl`、无 ScrollArea 正文与 footer；`width-class`/`scroll-body` 保留精确布局控制 |
| `DcPopover` | `@dc-ui/components/popover` | 可交互 Popover：受控 `open`、`trigger`/`header`/`title`/`header-actions`/默认内容插槽；`width-class`/`align`/`side`/`side-offset`/`content-class`；默认 `w-80`、`align=end`、`overflow-hidden p-0` |
| `DcSectionCard` | `@dc-ui/components/section-card` | 设置分区卡片（rounded-lg 细边框 + 可选 header/actions/description 插槽） |
| `DcInlineError` | `@dc-ui/components/inline-error` | UX 优先内联反馈：`error`（destructive + 图标）/`hint`（中性）二态，`role="alert"` |
| `DcForm` | `@dc-ui/components/form` | vee-validate `Form` 封装（shadcn form 原语）；内建 `useDcFormSubmit` 提交状态机，`@submit` 自动包裹 loading/success/error；`success-duration`/`error-duration`；`@success`/`@error` 事件 |
| `DcFormField` | `@dc-ui/components/form` | shadcn `FormField`+`FormItem` 家族封装：`name`/`label`/`description` + `#control="{ field }"` 插槽 + `FormMessage` 错误绑定（aria 关联） |
| `DcSubmitButton` | `@dc-ui/components/form` | 提交按钮（dc 的 DcButton 本体）：`status` 缺省自动注入最近的 `DcForm`；submitting→Spinner，success→✅（可配 `success-icon`/`success-label`），error→⚠，到时自动回退 idle |
| `useDcFormSubmit` | `@dc-ui/components/form` | 提交状态机 composable：`{ status, run, reset }`；`run(fn)` 驱动 idle→submitting→success/error，成功/失败按时长自动回退 |
| `useDcForm` | `@dc-ui/components/form` | 读取 `DcForm` 注入上下文（`DC_FORM_INJECTION_KEY`），供自定义提交控件使用 |
| `DcBadge` | `@dc-ui/components/badge` | shadcn Badge 语义化封装：default/secondary/outline/destructive 透传 + `success`/`warning`/`danger`/`active`/`neutral`（带 dark 变体，与 DcStatusPill 色系一致） |
| `DcCopyButton` | `@dc-ui/components/button` | 复制按钮：复用 `DcButton` 契约，`variant` 缺省 `ghost`；`copy-text` 必填触发复制（`useClipboard`），成功图标切 ✅（1200ms 自动回退、色值变 emerald）；`@copied`/`@error` 事件；`label`/`tooltip` 提供可访问名，`copy-text` 兜底 |
| `DcDropdownActionItem` | `@dc-ui/components/dropdown-action-item` | 菜单动作项：`icon`/`label`/`danger`（destructive 变体）/`disabled`/`inset` + `@select`，收敛 `Icon mr-2 + span` 散写 |
| `DcFormActions` | `@dc-ui/components/form-actions` | 表单底部操作组：「取消 + 提交（DcSubmitButton）」+ 中间插槽；`submit-status`/`cancel-label`/`submit-label`/`danger-submit` |

### 22.2 使用规则

- **按钮一律用 `DcButton`**：icon / tooltip / label / loading / active 均在组件内聚合，禁止手写 `Tooltip + Button + Icon` 组合；icon-only 至少传 `label` 或 `tooltip`（缺失 DEV 告警）。已有 tooltip 必须保留其文案、方位、延迟与显示条件；缺失 tooltip 的可操作 icon-only 控件必须补齐，优先复用对应操作的既有 i18n 文案，并同时作为 `label`。
- **选中/切换态按钮（toggle chip）切 `variant`，禁止 class 覆盖**：`outline` 变体自带
  `dark:bg-input/30 dark:border-input dark:hover:bg-input/50`，外部 class 传入的 `bg-primary` /
  `border-primary`（无 `dark:` 修饰符）在 tailwind-merge 中不与其冲突，暗色模式下会被压过，
  导致选中态失效（见 issue #2169）。正确写法：
  `:variant="selected ? 'default' : 'outline'"`，如需与 outline 保持等宽可补 `border border-primary`。
- **非按钮提示**（问号图标、下划线说明、Switch 包裹提示、Checkbox 行提示）不用按钮组件，用 `DcTooltip` / shadcn Tooltip 原样保持。
- **确认/删除类对话框统一 `DcConfirmDialog`**；动态多按钮弹窗、需隐藏确认按钮或 ESC 拦截的路由守卫弹窗保持原实现。
- **空状态统一 `DcEmpty`**（`#action` 放主行动按钮）；仅描述的内嵌小提示不套空态。
- **设置分区卡片统一 `DcSectionCard`**；danger-zone 等特殊边框语义卡不迁移。
- **状态展示统一 `DcStatusPill`**（标准六态 + 别名映射）；图表圆点/计数徽标不迁移。
- **紧凑内联错误统一 `DcInlineError`**（根元素 `role="alert"`）；带重试按钮的错误横幅保持原实现。
- **迁移必须行为等价**：保留原事件与修饰符（`@click` / `@select` / `.stop` / `.prevent`）、payload、禁用条件、`type`、loading 状态、Popover/Dialog 开闭、键盘与焦点行为、i18n key、`data-testid`；测试选择器（如 `[role="alert"]`）不因换组件失效。dc-ui 组件不得吞掉、改名或重发业务事件。
- **tooltip 补齐边界**：只为可操作的 icon-only 控件补齐；文字按钮、纯展示 Icon、以及说明型 Switch/Checkbox/链接提示维持原行为，不为统一形式强行增加 tooltip。
- 新增 dc-ui 组件需先证明既有组件无法覆盖；在本文档登记聚合后的完整契约，并符合 §20/§21 的密度与 token 规则。

### 22.3 迁移状态（2026-08 批次）

- **`DcButton` 聚合**：`DcIconButton` 已并入并删除（13 处调用迁入）；手写 Tooltip+按钮迁移 10 文件 30 处（MessageToolbar 12 / WindowSideBar 8 / ChatStatusBar 2 / ModelConfigItem / MessageBlockImage / MessageBlockToolCallImagePreview / SkillsIndicator / SkillsPanel / ChatInputToolbar 4）。`DcButton` 已补齐 tooltip 定位、延迟、content class 与 keyboard-focus 参数，保留复杂提示契约。
- **`DcCopyButton` 归位**：由 `@dc-ui/components/copy-button` 并入 `@dc-ui/components/button`（旧目录删除），消费方（MessageToolbar / ArtifactBlock / CodeArtifact / McpJsonViewer / McpServers / TraceDialog / MessageBlockToolCall）全部经 `copy-text` 传入复制内容，MessageToolbar 增加 `copy-text` prop。
- **`DcConfirmDialog`**：迁移 5 文件 7 框（ChatPage / ModelConfigDialog ×2 / KnowledgeFileItem ×2 / SkillInstallDialog / SkillDetailDialog ×2）+ ChatPage.test.ts 适配。
- **`DcEmpty`**：迁移 10 文件 12 处空态（含 MemoryEmptyState 用 `#action` 插槽，组件接口不变）。
- **`DcSectionCard`** 4 文件 11 卡（MemoryDiagnosticsPanel / MemoryDirectivesPanel / MemoryConfigInlinePanel / OfficialPluginDetailPage）；**`DcStatusPill`** 2 文件（RemoteSettings 5 渠道 / AcpDebugDialog）；**`DcInlineError`** 12 文件（McpServerForm 5 处等）。
- **有意保留（记录在案）**：WindowSideBar remote-control（多行 tooltip）、WindowSideBarSessionItem pin/delete（依赖 scoped CSS）、MessageDialog / UpdateTaskCheckDialog（动态多按钮）、SettingsLeaveGuardDialog（路由守卫）、DataSettings 单按钮错误弹窗、desc-only 空态提示、带重试按钮的错误横幅。
