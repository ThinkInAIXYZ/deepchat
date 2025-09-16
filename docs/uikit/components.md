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
- 半径：默认 `--radius`，容器使用 `rounded-xl`，控件 `rounded-md`。
- 间距：控件高度 `h-9` 为默认，sm/xs 变体见 Button/Input 系列。
- 颜色：控件前景/背景统一使用变量，如 `bg-card text-card-foreground`。

后续增量
- 表单组合（Form、Field、HelperText、Validation）。
- 表格（Table）、标签页导航模式与分组容器。
