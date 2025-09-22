# 组件拆解与导出清单（首批）

说明：UIKit 不重写 shadcn 组件，仅统一导出与命名，并在必要处提供样式/变体约束。下表为首批纳入的组件与路径，均通过 `@/components/uikit` 导出。

基础输入与显示
- Button（含 `buttonVariants`）
- Input / Textarea / Label
- Checkbox / RadioGroup / Switch / Slider / NumberField
- Separator / Progress

数据展示与容器
- Card / CardHeader / CardTitle / CardDescription / CardContent / CardFooter
- Badge / Avatar / Skeleton

导航
- Breadcrumb（List/Item/Link/Page/Separator/Ellipsis）
- Tabs（List/Trigger/Content）
- Menubar / NavigationMenu / Sidebar

浮层与反馈
- Dialog（Trigger/Content/Header/Footer/Title/Description/Close/ScrollContent）
- AlertDialog / Sheet（Trigger/Content/Header/Footer/Title/Description/Close）
- Popover / Tooltip / DropdownMenu / ContextMenu / HoverCard
- Alert / Toast

滚动与披露
- ScrollArea
- Accordion / Collapsible

导入方式（示例）
```ts
import {
  Button,
  Card, CardHeader, CardTitle, CardContent,
  Dialog, DialogTrigger, DialogContent, DialogTitle
} from '@/components/uikit'
```

命名规范
- 组件：PascalCase（与源码一致）。
- 变体：通过 CVA 暴露（如 `buttonVariants`）。
- 不在 UIKit 层重命名，避免二义性。

设计要点（与 Figma 对齐）
- 半径：默认 `--radius-md`（即 Tailwind `rounded`），容器多使用 `rounded-xl`，控件 `rounded-lg`，其余按 `--radius-*` 映射。
- 间距：控件高度 `h-9` 为默认，sm/xs 变体见 Button/Input 系列。
- 颜色：控件前景/背景统一使用变量，如 `bg-card text-card-foreground`。

后续增量
- 表单组合（Form、Field、HelperText、Validation）。
- 表格（Table）、标签页导航模式与分组容器。

## 当前封装覆盖情况

- ✅ 已导出的 shadcn 组件遵循原命名与 API，仅在 UIKit 层聚合，便于未来替换实现。
- ✅ 自主实现的基础控件：`IconButton`、`Toolbar`、`Chip`、`Pill`、`ListItem`、`Tabstrip` 均沿用统一 token，可作为后续原创组件的模板。
- ⛔ 仍在 `src/renderer/src/components/ui` 中但未封装的模块：
  - Select 系列（`Select`、`SelectTrigger`、`SelectContent`、`SelectItem`、`SelectValue`）
  - Toggle
  - HoverCard
  - AspectRatio
  - EmojiPicker
  - MessageDialog / UpdateDialog（业务专用对话框）
- 🎯 建议优先补齐 Select / Toggle / HoverCard，确保业务无需再从 `@/components/ui` 引用。

## 业务层使用要求

- 所有新旧组件调用统一从 `@/components/uikit` 导入，禁止直接引用 `@/components/ui/*`；可在 lint 规则中加入限制并通过 codemod 批量迁移。
- 当需要扩充 props/slots 时优先在 UIKit 包装层实现，再向下兼容旧 props，避免业务代码触碰底层实现细节。
- UIKit 未来计划抽离为独立包或路径别名时，以该入口为准即可实现无缝切换。
