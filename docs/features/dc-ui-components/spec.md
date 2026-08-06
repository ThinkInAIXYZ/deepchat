# dc-ui 设计组件层（src/dc-ui/）

## 用户需求

依据 `docs/design-system.md`（CSS 令牌 + 系统化机制），在 `src/shadcn` 同级沉淀
dc-ui 设计组件层（`src/dc-ui/`，别名 `@dc-ui/*`），并在 renderer 的
设置窗口与主聊天窗口中进行替换，收敛当前散落的重复写法。

## 现状事实（2026-08 调研）

- Button：610 处（settings 388 + 主窗口 222），`secondary/lg/icon-lg` 零使用；
  20+ 处手工 `h-7/h-8 text-xs` 覆盖说明缺「紧凑」档；icon-only 106 处但尺寸写法
  （`h-7 w-7` / `h-8 w-8` / `size-7`）三套并存。
- icon-only 可访问性：settings 有 41 处既无 `aria-label` 也无 `title`。
- Tooltip：62 对 Trigger/Content，31 个包 shadcn Button；主窗口无全局 TooltipProvider，
  20 个文件自行包裹（事实标准 delay=200 + ignoreNonKeyboardFocus）。
- 状态 pill：圆点 + 文案模式，`text-[10px]/[11px]/xs` 三档字号并存，无统一组件。
- 确认弹窗：AlertDialog + `AlertDialogAsyncAction`（settings 9 文件 29 处异步确认）。
- Toast：vue-sonner 通知子系统，`notifyRenderer({ kind, code, title, description })`，
  时长按 kind 由策略固定（2400/4000/6000/8000ms），无 per-call duration。
- Toggle 行：`SettingToggleRow`（无 description）与「label + description + switch」
  长格式两种变体并存。
- Skeleton 27 处、Empty 12 处，均为 shadcn 原语直用。

## 目标

- 建立 `src/dc-ui/components/`，与 `@shadcn` 同级、同风格（reka-ui + cn + 语义令牌）。
- 首批 8 个组件：DcButton、DcStatusPill、DcConfirmDialog、
  DcToggleRow、DcEmpty、DcSkeleton、DcToast（notifyRenderer 适配层）。
- 替换：settings 提示词管理全量 + chat-main 高价值组件（顶栏/侧栏/消息工具条/MCP 卡片）。

## 验收标准

- 8 个 dc 组件全部可由 `@dc-ui/components/*` 导入，主窗口与 settings 均可使用。
- ~~DcIconButton 强制可访问名称（`aria-label` 或 `tooltip` prop 至少其一，否则告警）。~~ 已并入
  DcButton（`label`/`tooltip` 任一即可，icon-only 缺失时 DEV 告警），`DcIconButton` 组件已删除。
- DcButton 支持紧凑档（xs = `h-7 text-xs`）、`icon-size`、`loading`（内建 Spinner）。
- DcStatusPill 六状态映射与现有语义色一致，浅/深色双主题正确。
- DcConfirmDialog 支持异步确认（busy + 禁用双按钮 + 错误插槽）。
- DcToast 只封装 `notifyRenderer`，不引入新通知引擎，不增加 duration 参数。
- 替换后既有行为不变：事件及修饰符（`@click` / `@select` / `.stop` / `.prevent`）、payload、禁用条件、`type`、loading、Popover/Dialog 开闭、键盘与焦点行为、i18n key、测试钩子均须保留；dc-ui 组件不得吞掉或重发业务事件。
- 既有 tooltip 的文案、方位、延迟、显示条件不变；缺失 tooltip 的可操作 icon-only 控件必须补齐，优先复用既有 i18n 文案并同时设为 `label`。说明型 Switch/Checkbox/链接提示及文字按钮不因迁移强加 tooltip。
- 验证命令（vitest/lint/fmt/typecheck）仅在用户要求提交时统一执行。

## 约束

- 不修改 `src/shadcn`（原语层保持 shadcn 生成物），dc 层在其上封装。
- 不改变主进程、preload、shared 契约与通知引擎内部策略。
- 新增文案必须走既有 i18n；组件默认文案引用现有 `dialog.*` / `common.*` key。
- dc 组件遵循 Oxfmt 风格（单引号、无分号、100 列）；shadcn 原语保持原格式。

## 非目标

- 不替换全部 610 处 Button（分批进行，本次覆盖下述范围）。
- 不做设计令牌新增或 style.css 修改（复用 `--dc-*` 与语义色）。
- 不改动主窗口全局 TooltipProvider 接入方式（仅在新组件内建局部 Provider 兜底）。

## 已澄清决策

- 物理位置 `src/dc-ui/`（`src/shadcn` 同级），别名 `@dc-ui/*`。
- 落地分支：主工作区 `dev` 直接进行（用户指定）。

## 第九轮：组件体系标准化（2026-08，进行中）

### 标准组件边界

所有 dc-ui 组件遵循「**功能聚合 + DeepChat design component**」：一个组件覆盖一类稳定交互的
完整展示、可访问性与通用状态；不为 icon、tooltip、loading 等单项能力另立组件。新增组件前必须先
证明既有组件无法覆盖。

| 组件族 | 标准入口 | 保留的专用语义 |
| --- | --- | --- |
| Action | `DcButton` | `DcCopyButton`（Clipboard、成功回退、复制错误）；`DcSubmitButton`（form submit 状态）；`DcFormActions`（取消+提交 footer）；`DcDropdownActionItem`（菜单 `select` 语义）；`DcConfirmDialog`（阻断确认） |
| Overlay | `DcSheetPanel`、`DcPopover`、`DcTooltip` | Sheet 编辑/浏览、Popover 可交互内容、Tooltip 非按钮说明三者焦点和关闭语义不同，不合并 |
| Feedback | `DcBadge`、`DcStatusPill`、`DcInlineError`、`DcEmpty`、`DcSkeleton`、`DcToast` | Badge 是静态元数据；StatusPill 是运行状态（dot/pulse/别名），只共享色调而不混合 API |
| Settings/Form | `DcToggleRow`、`DcSectionCard`、`DcForm` | `DcFormField`/`DcSkeleton`/`DcToast` 继续保留为标准入口，但在出现真实调用前不扩展其 API |

### 第九轮验收契约

- `DcButton` 是唯一常规按钮：文字、icon-only、loading、tooltip、label、disabled、active、`as`/`as-child`、默认插槽均由其承接；删除独立 icon button。
- `DcButton` tooltip 支持 `side`、`side-offset`、`delay-duration` 与 content class，以不改变现有 tooltip 的位置、时序和多行样式。
- `DcCopyButton` 复用 DcButton 的外观/tooltip 能力，但不得改变 Clipboard、`copied`/`error` 事件、成功计时和 toast 行为；`DcSubmitButton` 复用 DcButton，但不得改变 native submit、状态注入和防重复提交。
- `DcSheetDialog` 合并进 `DcSheetPanel` 的兼容布局模式；迁移时保留原宽度、滚动、padding、footer 和焦点行为。
- `DcPopoverPanel` 收敛为 `DcPopover`，仅保留可交互浮层需要的 open、定位、宽度、trigger、header 与 content 协议。
- 迁移逐项保持本 spec 的行为等价与 tooltip 补齐规则；复杂嵌套 trigger、动态多行 tooltip、复合卡片和非按钮提示可保留，直到标准组件可无损表达。

## 落地状态（2026-08，未提交）

- 组件沉淀 20 个 + 2 composable；设计哲学收敛为「功能聚合、少而全」（见 design-system.md §22）。
- 按钮统一为 `DcButton`（icon/tooltip/label/loading/active 聚合），`DcIconButton` 已删除；手写
  Tooltip+按钮迁移 8 文件 25 处。
- `DcConfirmDialog` 5 文件 7 框、`DcEmpty` 10 文件 12 处、`DcSectionCard` 4 文件 11 卡、
  `DcStatusPill` 2 文件、`DcInlineError` 12 文件；有意保留项见 design-system.md §22.3。
- 验证命令（vitest/lint/fmt/typecheck）待用户要求提交时统一执行。
