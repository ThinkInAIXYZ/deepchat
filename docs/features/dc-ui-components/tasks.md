# dc-ui 设计组件层任务清单

- [x] 调研 Button / Dialog 家族 / Toast / 状态组件 / 目录别名的使用现状。
- [x] 编写 spec.md / plan.md（组件契约与替换范围）。
- [x] 注册别名：vite renderer alias、tsconfig.app.json paths、根 tsconfig.json paths。
- [x] Tailwind `@source` 追加 `src/dc-ui`。
- [x] 构建 DcButton（xs 档 / icon-size / loading / icon prop）。
- [x] 构建 DcIconButton（强制可访问名 + tooltip 内建 + 语义化尺寸 + attrs 透传）。
- [x] 构建 DcStatusPill（六状态 + 别名 + dot + pulse + 尺寸档）。
- [x] 构建 DcConfirmDialog（异步确认 + danger + 错误插槽）。
- [x] 构建 DcToggleRow（单行/双行两种变体）。
- [x] 构建 DcEmpty / DcSkeleton。
- [x] 构建 DcToast（notifyRenderer 适配层）。
- [x] 替换 settings 提示词管理 5 个文件。
- [x] 替换 chat-main：ChatTopBar / WindowSideBar / McpServerCard（MessageToolbar 16px 超紧凑按钮记为例外保留）。
- [x] design-system.md 补 dc 组件索引章节（二十二）。
- [x] `pnpm run typecheck:web` 通过（修复 DcStatusAlias 缺 auth-required 的类型错误）。
- [x] 启动 dev 目验主窗口与设置窗口渲染（待用户确认）。

## 第二轮：扩大替换面

- [x] 构建 DcTooltip / DcSheetPanel / DcPopoverPanel / DcSectionCard / DcInlineError。
- [x] PromptEditorSheet / SystemPromptEditorSheet → DcSheetPanel（统一 Sheet 壳与 footer）。
- [x] CommonSettings（4 行）/ AutoCompactionSettingsSection / DisplaySettings（3 行）→ DcToggleRow + DcSectionCard。
- [x] McpServerCard 错误/认证 tooltip → DcTooltip。
- [x] ChatTopBar 两个确认弹窗的错误行 → DcInlineError。
- [x] McpIndicator 高级设置面板 → DcPopoverPanel。
- [x] 运行 typecheck：`pnpm run typecheck:web` 通过（修复 McpIndicator 模板 v-if/else 配对与多余闭合 div）。
- [ ] 启动 dev 目验主窗口与设置窗口渲染（待用户确认）。

## 第三轮：MCP 面板群与确认弹窗

- [x] DcConfirmDialog 增加 `confirm-attrs`/`cancel-attrs`/`busy-data-testid` 透传。
- [x] MemoryListView 删除确认 → DcConfirmDialog（testid 保留，Spinner testid 经 busy-data-testid）。
- [x] McpPromptPanel / McpToolPanel / McpResourceViewer → DcSheetPanel（`scroll-body=false`，消除三处硬编码 `bg-white dark:bg-black`）。
- [x] McpPromptPanel 执行/重置/格式化按钮 → DcButton（loading 态内建）。
- [x] 运行 typecheck 并记录结果（修复 DcSheetPanel `open` 可选化，适配 prop 直绑 v-model 的用法）。
- [ ] McpServers 详情 Sheet（默认填充 sm:max-w-xl 变体）→ 待定 DcSheetDialog 变体，暂缓。

## 第四轮：命名 dc-ui 与存量收尾

- [x] 组件库命名 `deepchat` → `dc-ui`：`src/dc-ui/` + 别名 `@dc-ui/*`（vite/tsconfig×2/style.css @source/全部 import）。
- [x] DataSettings 重置确认 + 沙盒清除确认 → DcConfirmDialog/DcButton（信息型同步错误弹窗保留原实现）。
- [x] McpServers 详情 Sheet → 新增 `DcSheetDialog` 变体 + 状态/来源 Badge → DcStatusPill。
- [x] 其余 8 个 AlertDialogAsyncAction 文件 → DcConfirmDialog（OcrSettings/BuiltinKnowledgeSettings/ProviderRateLimitConfig/MemoryPersona/Directives/Diagnostics/InlinePanel）。
- [x] SkillsIndicator 等嵌套触发器 Popover 记为例外（触发器结构特殊，保留）。
- [x] `pnpm run typecheck:web` 通过。

## 第五轮：dc-ui form 体系（基于 shadcn form 封装）

- [x] 规则确认：dc 已有组件用 dc（按钮→DcButton），dc 没有的用 shadcn（form 原语→vee-validate Form/FormItem 家族）。
- [x] form 相关全部收敛到 `src/dc-ui/components/form/`：DcForm / DcFormField / DcSubmitButton / useDcFormSubmit / useDcForm。
- [x] DcForm 包装 shadcn `Form`，`@submit` 自动包 run() 驱动 idle→submitting→✅/⚠（emit 不声明 submit 以保留 attrs 监听器）。
- [x] DcSubmitButton 基于 DcButton；status 缺省时注入最近 DcForm（useDcForm）。
- [x] DcFormField 包装 shadcn FormField/FormItem/FormLabel/FormControl/FormMessage。
- [x] 替换 AddCustomProviderDialog、McpEnterpriseProfiles（成功 ✅ 停留 600ms 后退出编辑态）。
- [x] 移除旧 submit-button / composables 目录，dc-ui/index.ts 更新。
- [x] `pnpm run typecheck:web` 通过（修复 success-duration 需绑定传值）。

## 第六轮：移除内联操作反馈机制（src/renderer/services）

- [x] 用户确认目标为 src/renderer/services 的内联文案机制（InlineOperationFeedback + useSurfaceFeedback + surfaceFeedbackController）。
- [x] 删除 services/notifications 4 个文件：InlineOperationFeedback.vue / useSurfaceFeedback.ts / surfaceFeedbackController.ts / surfaceVisibility.ts；rendererNotificationRuntime 精简（保留 NotificationManager），index.ts 移除导出。
- [x] 重构 prompt 管理链路 5 文件（PromptSetting/SystemPromptSettingsSection/CustomPromptSettingsSection/PromptEditorSheet/SystemPromptEditorSheet）：删 controller 链与内联渲染，失败/成功改 notifyRenderer toast，表单互斥精简。
- [x] 剩余 28 个调用文件由 3 个并行 agent 清理（settings 通用/skills+knowledge/data+mcp 三组）。
- [ ] 等待 agent 完成后统一跑 typecheck 修复遗漏。

- [x] 剩余 28 个调用文件由 3 个并行 agent 清理（settings 通用/skills+knowledge/data+mcp 三组），全部 0 残留。
- [x] 修复 typecheck 遗漏（PromptEditorSheet 缺 ref import、SystemPromptEditorSheet 残留 pending 引用）。
- [x] 删除 4 个纯机制测试（PromptSettingsFeedback/InlineOperationFeedback/useSurfaceFeedback/surfaceFeedbackController .test.ts）。
- [x] vitest.config.renderer.ts 补 `@dc-ui` 别名（修复 WindowSideBar/ChatTopBar 等 dc 组件测试解析失败）。
- [x] ChatTopBar 测试补 AlertDialog stubs（DcConfirmDialog teleport 适配）；AutoCompaction 测试 stub 改名 DcToggleRow。
- [ ] 3 个测试更新 agent 完成后统一跑 test:renderer 收尾。

- [x] 3 个测试更新 agent 完成（组1 赵可 128 用例 / 组2 孙悦 46 / 组3 林珊 63，均全绿）。
- [x] 全量 `pnpm run test:renderer`：238 文件 / 1956 用例全部通过。
- [x] 最终状态：services 内联反馈机制 4 文件删除 + 33 个组件清理 + 21 个测试适配 + vitest 别名修复，typecheck/test 双绿。

## 第七轮：表单保存反馈 UX 化（按钮 loading→✅，失败内联）

- [x] 用户确认：保存按钮 loading→✅ icon，失败走表单内联错误（不走 toast）。
- [x] 样板：NowledgeMemSettings（保存/测试/重置 → DcSubmitButton + useDcFormSubmit + DcInlineError），测试同步适配。
- [x] 组1（周雨）：DataSettings（云配置/数据库安全）、DeepChatAgentsSettings、DebugSettings 改造；OcrSettings/RemoteSettings/CronJobsSettings/AboutUsSettings/EnvironmentsSettings 无保存按钮保持 toast。
- [x] 组2（吴倩）：skills 5 文件 + AcpSettings 改造；NotificationsHooksSettings 无按钮保持 toast；SkillsSettings 失败 toast 因 SkillDetailDialog 范围外保留。
- [x] 组3（何静）：knowledge 3 文件 + BuiltinKnowledgeSettings + McpBuiltinMarket + McpSettings 改造（经共享 hook useKnowledgeConfigOperation 暴露 lastError）；prompt 4 文件保存即关闭/失焦保存保持现状。
- [x] 全量 `pnpm run typecheck:web` 通过；`pnpm run test:renderer` 238 文件 / 1958 用例全绿。

## 第八轮：结构化优化（非新组件）

- [x] 主窗口 ChatMainApp 根加全局 `TooltipProvider`（delay 200 + ignore-non-keyboard-focus，与 settings App.vue 对齐），新代码无需再局部包裹。
- [x] `DcIconButton` 新增 `size="icon-xs"`（24px），落地 PromptEditorSheet removeFile（移除手写 h-6 w-6 覆盖）。
- [x] 局部 TooltipProvider（11 文件）保留为显式覆盖：delay 0/200 与 ignore 配置存在差异，统一会改变行为；全局为默认兜底、局部为显式覆盖共存。
- [x] typecheck:web 通过；WindowSideBar 50/50、PromptEditorSheet 测试通过。

## 第九轮：功能聚合与行为等价标准化

- [x] 原有 `spec.md` / `plan.md` / `tasks.md` / `design-system.md` 补齐「功能聚合、少而全」组件标准，以及行为等价和 icon-only tooltip 补齐硬约束。
- [x] `DcButton` 吸收原 `DcIconButton`：icon / tooltip / label / loading / active / 默认插槽统一；tooltip 支持 side、side-offset、delay、content class、keyboard-focus；删除 `DcIconButton`。
- [x] 迁移 ChatInputToolbar、WindowSideBar、MessageToolbar 与首批主窗口/settings icon-only action；保留事件修饰、disabled/loading/type/testid、动态状态、tooltip 时序与原尺寸。
- [x] `DcCopyButton` 吸收通用 tooltip 参数；仅 browser Clipboard 调用保留 `copy-text`，KnowledgeFile 继续使用 Electron IPC (`deviceClient.copyText`) 与点击即反馈。
- [x] `DcSheetDialog` 并入 `DcSheetPanel appearance="plain"`；McpServers 详情 Sheet 保留 width、padding、ScrollArea、footer、空 description DOM/ARIA。
- [x] `DcPopoverPanel` 收敛为 `DcPopover`；McpIndicator 保留受控开闭、trigger、header、定位与内容交互。
- [x] review 修复：恢复 MessageToolbar 16px 控件/12px 图标、`v-show` 生命周期与 200ms tooltip；修复 DcButton variant 色、DcCopyButton accessible name、WindowSideBar title/delay 与失效顶层导出。
- [ ] 提交前执行 format / i18n / lint / typecheck / 受影响 Vitest，并整合最新 `origin/dev` 后创建 Draft PR。
