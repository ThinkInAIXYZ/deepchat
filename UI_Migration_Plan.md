# Shadcn UI 迁移改造计划

## 目标
- 将现有 `src/renderer/src/components/ui` 下的 shadcn 组件逐步迁移至 `@shadcn/components`
- 引入统一的 shadcn 目录作为真实源，renderer 复用
- 替换自有实现：Toast -> Sonner，Switch API 对齐 reka-ui
- 保持 i18n、样式、暗黑模式、无障碍一致

## 当前状态概览
- `src/shadcn/components` 已初始化，包含官方结构
- renderer 仍依赖 `src/renderer/src/components/ui` 内旧组件
- EmojiPicker 为自研组件，已上移至 `src/renderer/src/components/emoji-picker`
- Toast、Switch 等组件调用方式与 shadcn 官方实现存在差异

## 引用统计（2025-09-26）
- **Toast**：12 处引用 `@/components/ui/toast` 或内部 hook（集中在聊天、MCP、设置模块）
- **Switch**：14 处引用 `@/components/ui/switch`
- **EmojiPicker**：已迁移，后续引用路径均更新为 `@/components/emoji-picker`

## 风险点
- 需要确认所有使用路径与别名：`@shadcn/components`, `@/components/ui`
- renderer 多处懒加载/defineAsyncComponent 引入路径需同步调整
- 样式依赖 `src/renderer/src/assets/style.css`，需确认 tokens 和 Tailwind 配置
- 需要保证 Vitest、E2E 测试适配

## 改造步骤

##> 阶段 1：组件清单与差异分析
- 枚举 `src/renderer/src/components/ui` 现有组件及其引用位置
- 梳理公共样式、i18n、状态管理等耦合点，记录替换注意事项
- 对照 `@shadcn/components` 实现，确认 Props、slot、事件差异

### 阶段 2：组件迁移批次
- **批次 A（基础控件）**：Button, Badge, Input, Label, Select, Checkbox, Switch
- **批次 B（反馈）**：Alert, Dialog, Popover, Tooltip, Sonner(Toaster)
- **批次 C（布局与导航）**：Tabs, NavigationMenu, DropdownMenu, Sheet, Sidebar
- **批次 D（复杂组件）**：Table, Card, Accordion, Menubar, Progress 等

每个批次执行步骤：
1. 比对旧组件与 shadcn 版本差异（Props、slot、事件）
2. 在具体使用位置直接替换 import 为 `@shadcn/components/...`
3. 验证 UI 功能，补充 Vitest 或 Storybook（若有）
4. 清理旧组件文件

### 阶段 3：特定组件替换
- **Toast -> Sonner**
  - 引入 `@shadcn/components/ui/sonner`
  - 调整 `useToast` hooks 与调用逻辑，替换为 `import { Toaster } from '@shadcn/components/ui/sonner'`
  - 确认全局样式覆盖
- **Switch**
  - 所有 `@/components/ui/switch` 替换为 shadcn 版本
  - 检查受控模式，确保 `v-model:checked` 或 `checked/onUpdate` 与 reka-ui 兼容
- **Sidebar**
  - 若采用 shadcn Sidebar，需要调整现有 `SideBar.vue` 逻辑，使用 `useSidebar` composable

### 阶段 4：清理与文档
1. 移除 `src/renderer/src/components/ui` 目录（确认所有引用迁移完成）
2. 更新 README / 开发文档说明 UI 组件来源及使用方式
3. 增加 lint / CI 步骤，确保统一直接引用 `@shadcn/components`

## i18n 与主题考虑
- 新增的 Playground 文案已加入 `en-US` 与 `zh-CN`，其他语言待后续同步
- 迁移过程中确保所有用户可见文案使用 i18n key
- 组件自带的暗色样式需与现有 Tailwind 变量兼容

## 时间预估
- 阶段 1：1~2 天
- 每个批次：1~2 天（视测试范围调整）
- 阶段 3：1 天
- 阶段 4：0.5 天

## 后续工作
- 与设计团队确认未覆盖的 UI 模块
- 考虑引入 Playwright/Storybook 作为视觉回归
- 建立脚本自动同步 shadcn 官方更新

