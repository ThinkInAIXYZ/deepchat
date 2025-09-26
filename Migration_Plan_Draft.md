# Shadcn 迁移改造计划书（初稿）

> 本文档用于描述 renderer UI 组件向 `@shadcn/components` 迁移的整体方案。初稿基于 2025-09-26 代码库状态，后续调整请在文档内记录。Playground 视图仅用于内部验证，不会进入生产版本。

---

## 1. 现状扫描

- `src/shadcn/components`：已通过 shadcn 脚本初始化，包含官方推荐结构（ui、lib、composables 等）。
- renderer 仍大量引用 `src/renderer/src/components/ui` 下旧版封装组件；其中部分组件与最新 shadcn 实现存在 API 差异（如 `Switch` 状态、`Toast` 实现）。
- EmojiPicker 为自研组件，首次迁移已上移到 `src/renderer/src/components/emoji-picker`。
- Toast（12 处引用）、Switch（14 处引用）广泛分布于聊天、设置、MCP 模块，需要有序替换。
- 别名情况：`@/components/ui` 指向旧实现，`@shadcn/components` 指向新目录。后续迁移需统一引用来源。
- 最新增设 `PlaygroundTabView` 作为 shadcn 组件验证场景，通过在 Shell Tab 区域 Shift+点击“+”快速打开。

## 2. 目标

1. 逐步替换旧 UI 组件，引入 shadcn 官方实现，减少维护成本。
2. 整体迁移期间保证功能稳定、样式保持一致、国际化流程不受影响。
3. 最终清理 `src/renderer/src/components/ui` 目录，仅保留真正自研组件（例如 EmojiPicker）。
4. 建立规范：新组件默认从 `@shadcn/components` 引入，避免再次出现分叉。

## 3. 迁移策略与阶段划分

### 阶段 A：基线梳理（已启动）

- [x] 建 Playground：`PlaygroundTabView` 展示核心 shadcn 组件 Demo。
- [x] EmojiPicker 抽离至独立目录，避免受迁移影响。
- [ ] 完成完整组件清单与引用关系表。

### 阶段 B：批次迁移

按照组件类型与风险程度拆分批次。在每个批次执行以下步骤：
1. 对比老组件与 shadcn props/slot/event 差异，补齐兼容层。
2. 替换 import，更新业务逻辑（如 `v-model`, `onUpdate` API）。
3. 跑单元测试 / lint / e2e，确认无回归。
4. 如果组件在多个模块中复用，先建立统一包装（如需要）。

建议批次：
- **Batch 1（基础表单）**：Button、Input、Label、Textarea、Checkbox、Switch、Select。
- **Batch 2（反馈）**：Alert、Dialog、Popover、Tooltip、Sonner(Toast)。
- **Batch 3（导航&布局）**：Tabs、DropdownMenu、NavigationMenu、Sheet、Sidebar。
- **Batch 4（复杂组件）**：Table、Card、Accordion、Menubar、Progress、Badge 等。

### 阶段 C：专项替换

- **Toast -> Sonner**
  - 用 `@shadcn/components/ui/sonner` 重写 Toaster，并替换 `useToast` hooks。
  - 统一 toast 样式、位置、主题适配；确保所有触发点覆盖。
- **Switch**
  - 对照 reka-ui 版实现（checked/onUpdate），梳理受控/非受控用法。
  - 批量替换 import，并在 Playground 中覆盖测试场景。
- **其它组件** 根据影响面逐项推进（如 Sidebar、自定义组合组件）。

### 阶段 D：收尾

1. 删除 `src/renderer/src/components/ui` 目录（确认所有引用已迁移）。
2. 更新文档/README，说明 UI 组件来源、Playground 使用方式。
3. 在 CI 中增加检测（例如：扫描禁止再次引用旧目录）。
4. 与设计/QA 评审，确认视觉行为一致。

## 4. 拆迁细项 & 注意事项

### 国际化

- 新增 UI 标题或描述需走 i18n（Playground 为内部页面，可使用硬编码英文提醒 “Internal Only”）。
- 迁移中涉及的用户可见文案，请同步更新多语言 JSON。

### 样式与主题

- 需确认 Tailwind token 与 shadcn 变量一致；若存在差异，可在 `@shadcn/lib/utils` 内扩展。
- Dark mode 行为需在 Playground & 核心视图联动验证。

### 可访问性 & 测试

- shadcn 组件默认遵循 Radix ARIA 规范，迁移时可利用 Playground 跑手动验收。
- 建议补充 Vitest 组件快照 / Storybook（如已有）。
- 若后续引入 Playwright，可用于视觉回归。

## 5. 人员分工建议

- **UI 基础组件迁移**：前端工程师 A（负责 Batch 1 & Batch 2）。
- **复杂组件与逻辑梳理**：前端工程师 B（负责 Batch 3 & 扩展组件）。
- **专项替换（Toast、Switch）**：可由同一责任人串联确保一致性。
- **QA / 测试**：设计配合验证最终效果。

## 6. 时间规划（参考）

| 阶段 | 估算 | 备注 |
| --- | --- | --- |
| A | 1 天 | Playground + 资产梳理 |
| B | 3~5 天 | 视组件数量调整 |
| C | 1 天 | Toast/Sonner、Switch 专项 |
| D | 0.5 天 | 清理 + 文档 |

## 7. 风险与缓解

- **业务耦合复杂**：某些旧组件包有业务逻辑（如 `MessageDialog`）。缓解：在迁移前先抽离业务逻辑到独立模块。
- **样式回归**：需要在每批组件迁移后进行局部回归，可借助 Playground 快速验证。
- **多语言缺失**：迁移时标记缺失语言的 key，后续批量补充。

## 8. 后续计划

- 建立 `scripts/update-shadcn.*` 脚本跟踪上游更新（如已有则完善）。
- 定期审核 Playground，确保覆盖核心组件并更新示例。
- 迁移完成后考虑整合 Storybook 或基于 Playground 的文档化方案。

---

> 文档由自动化助手生成，后续讨论与调整请在本文档中继续维护。
