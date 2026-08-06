# dc-ui 设计组件层实施计划

## 目录与别名

```text
src/dc-ui/
├── index.ts                       # 顶层导出
└── components/
    ├── button/        DcButton.vue + index.ts
    ├── icon-button/   DcIconButton.vue + index.ts
    ├── status-pill/   DcStatusPill.vue + index.ts
    ├── confirm-dialog/DcConfirmDialog.vue + index.ts
    ├── toggle-row/    DcToggleRow.vue + index.ts
    ├── empty/         DcEmpty.vue + index.ts
    ├── skeleton/      DcSkeleton.vue + index.ts
    └── toast/         DcToast.ts + index.ts
```

- 别名 `@dc-ui/*` → `src/dc-ui/*`：
  - `electron.vite.config.ts` renderer resolve.alias 追加
  - `tsconfig.app.json` paths 追加
  - 根 `tsconfig.json` paths 追加（与 `@shadcn/*` 一致）
- Tailwind v4：`src/renderer/src/assets/style.css` 的 `@source` 追加
  `../../../dc-ui/**/*.{vue,ts,tsx,js,jsx}`（否则 dc-ui 的 class 不会被扫描）。

## 组件契约

### DcButton（shadcn Button 封装）

- 透传 variant/size（保留 default/outline/ghost/destructive/link；`secondary`/`lg`/`icon-lg`
  不在 props 类型中暴露，需要时仍可透传）。
- 新增 `size="xs"`：`h-7 px-2.5 text-xs`（对应 20+ 处手工覆盖）。
- props：`icon-size`（`'3' | '3.5' | '4'`，默认 `'4'`，作用于内联 `[&_svg]` 尺寸）、
  `loading`（内建 Spinner，替换 icon 区）、`icon`（Iconify name，替代手写 `<Icon>`）。
- 间距：icon + 文字用 flex `gap-1.5`，不再叠加 `mr-*`（替换时移除调用方 `mr-1/mr-2`）。

### DcIconButton（icon-only + 强制可访问名）

- props：`label`（必填：`aria-label` 与 `title` 双写）、`tooltip`/`tooltip-side`（可选，
  内建 `TooltipProvider(200ms) + Tooltip + Trigger asChild`）、`icon`、`size`
  （`icon-sm`=28px / `icon`=32px 语义化，替代 `h-7 w-7` 手写）、`variant`（默认 ghost）、
  其余透传 `Button` attrs（disabled/class 等）。
- 校验：运行时若 `label` 与 `tooltip` 均缺，`console.warn` 提示可访问性缺失。
- hover：默认 `text-muted-foreground hover:text-foreground` 颜色过渡（代码库事实标准）。

### DcStatusPill

- props：`status`（'neutral'|'active'|'success'|'warning'|'danger'|'disabled'，兼容
  'running'|'loading'|'error'|'offline' 别名）、`label`、`show-dot`（默认 true）、
  `pulse`（loading 态圆点 animate-pulse）、`size`（'sm'=text-xs / 'xs'=text-[11px]）。
- 结构：`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5` + 语义圆点
  （success=emerald、warning=amber、danger=red、active=primary、其余 muted），
  颜色带 dark 变体，符合 §18 语义状态体系。

### DcConfirmDialog（AlertDialog + AsyncAction）

- props：`open`（v-model）、`title`、`description?`、`icon?`、`danger`（默认 true → 确认
  按钮 destructive）、`confirm-label?`/`cancel-label?`（默认 `common.confirm/cancel` i18n）、
  `busy`、`disabled-confirm`、`confirm-icon?`。
- 事件：`confirm`（可返回 Promise，pending 期间禁用双按钮 + busy Spinner）、`cancel`。
- 插槽：`default`（错误信息 `role="alert" text-destructive` 等）、`actions`（完全自定义）。
- 容器：`w-[calc(100vw-2rem)] max-w-md`。

### DcToggleRow

- props：`id`、`icon?`、`label`、`description?`、`model-value`、`disabled`、
  `aria-label?`（缺省用 label）。
- emit：`update:model-value`；插槽：`trailing`（替换右侧区域）。
- 无 description 时单行 `h-10`；有 description 时「label + description」双行布局，
  统一两种现存变体。

### DcEmpty（shadcn Empty 封装）

- props：`icon?`、`title`、`description?`；插槽：`default`（正文）、`action`（主行动）。
- 容器统一 `border border-dashed rounded-lg` + 居中。

### DcSkeleton

- props：`width`/`height`（默认 `100%/1rem`，CSS 值）、`rounded?`（默认 `md`）、
  `class` 透传；背景用 `bg-muted/40-70` 渐变层级（现有骨架惯例）。

### DcToast（notifyRenderer 适配层）

- `DcToast.success/info/warning/error({ title, description?, code? })`，code 缺省
  `crypto.randomUUID()`；不新增 duration 参数（沿用 kind 策略时长）。
- 内部仅调用 `@renderer-notifications/rendererNotificationPort` 的 `notifyRenderer`。

## 替换范围（本次）

### settings（提示词管理全量）

- `PromptSetting.vue`：页面操作按钮 → DcButton（含 icon-size）。
- `prompt/SystemPromptSettingsSection.vue`：新建/重置/删除按钮 → DcButton/DcIconButton，
  删除确认 → DcConfirmDialog（danger + busy），「启用」pill → DcStatusPill(active)。
- `prompt/CustomPromptSettingsSection.vue`：新增/编辑/删除 → DcButton/DcIconButton +
  DcConfirmDialog；状态 pill → DcStatusPill(active/disabled) + DcStatusPill(neutral 来源)；
  空态 → DcEmpty；启停 Switch 保持（dc 层不重复 Switch）。
- `prompt/PromptEditorSheet.vue` / `SystemPromptEditorSheet.vue`：footer 按钮 → DcButton。

### chat-main（高价值组件）

- `ChatTopBar.vue`：ghost×icon 按钮 → DcIconButton（label + tooltip）。
- `WindowSideBar.vue`：icon 按钮 → DcIconButton。
- `components/message/MessageToolbar.vue`：5 个 Tooltip 包裹按钮 → DcIconButton。
- `components/mcp-config/components/McpServerCard.vue`：状态区 → DcStatusPill
  （running/loading/error/auth-required/stopped 映射）。

## 第九轮：Action 收敛进度（进行中）

- [x] `DcButton` 聚合 tooltip 的定位、延迟、content class、keyboard-focus 与 icon class；`label` 只提供可访问名称，不再隐式创建 tooltip。
- [x] `ChatInputToolbar` 的附件、语音输入、Steer、主操作按钮迁入 `DcButton`；保留动态状态、录音波形、testid、data-mode、aria、禁用和 emit。
- [x] `WindowSideBar` remote-control 迁入 `DcButton`；保留 right-side、多行 tooltip、native title、条件显示、颜色与 pulse。
- [x] `DcSheetDialog` 并入 `DcSheetPanel appearance="plain"`；McpServers 详情 Sheet 保留原 width、padding、ScrollArea、footer 与空 description DOM/ARIA。
- [x] `DcPopoverPanel` 收敛为 `DcPopover`；McpIndicator 保留受控 open、trigger、header、定位与内容交互。
- [x] 主窗口与 settings 首批 icon-only action 迁入 `DcButton` 并补齐既有 i18n 的 label/tooltip；逐项保留事件修饰、disabled/loading、type、尺寸和测试钩子。
- [x] `DcCopyButton` 聚合通用 tooltip 参数；Clipboard 行为保留专用边界，Electron IPC 复制调用点不替换为 browser Clipboard。

## 数据流与兼容性

dc-ui 是 renderer 展示层封装，不触碰 store / IPC / shared。迁移必须逐项保持行为等价：

- 原事件、修饰符与 payload 不变：`@click` / `@select` / `.stop` / `.prevent` 不得被组件吞掉、改名或重发。
- 原禁用条件、`type`、loading、Popover/Dialog 开闭、键盘及焦点行为不变；`data-testid` 与其他 `$attrs` 必须落在原本可交互的 DOM 元素上。
- 原 tooltip 的文案、side、delay、条件和嵌套触发器结构不变。缺失 tooltip 时，只为可操作的 icon-only 控件补充，并复用既有 i18n 文案同时作为 `label`。
- 纯展示 icon、文字按钮、说明型 Switch/Checkbox/链接 tooltip 不为统一形式而改变交互。

## 验证策略

1. 每一处迁移先人工对照原模板：事件、修饰符、disabled、`type`、loading、测试钩子、tooltip 契约。
2. 本阶段不运行 vitest / lint / fmt / typecheck；仅在用户要求提交时，按受影响范围统一执行。
3. 提交前人工检查主窗口与设置窗口中按钮、弹窗、tooltip 的可见交互与深浅色样式。
