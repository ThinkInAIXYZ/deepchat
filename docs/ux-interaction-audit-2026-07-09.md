# DeepChat 全局交互体验审计（双源对比版）

**日期**：2026-07-09
**方法**：静态代码走读，交叉验证 grok 报告
**范围**：`src/renderer/**` 主聊天、侧栏、侧面板、悬浮球、Spotlight、消息块、动画系统
**说明**：未修改代码、未跑验证、未提交。以下为排查到的可疑/可改进点。

---

## 一、Grok 报告对比总结

| 维度 | 结论 |
|---|---|
| **整体准确度** | 高。grok 对大框架的判断（滚动窗口化、流式批处理、动画策略不统一）方向正确，大部分发现经验证属实 |
| **误判 / 需修正** | 3 处——见 §1.2 |
| **遗漏 / 可补充** | 12 处——见 §1.3 |

---

### 1.1 Grok 正确且验证属实的主要发现

| # | 发现 | 验证位置 | 体感风险 |
|---|---|---|---|
| 1 | 消息窗口化估算偏差：tool_call +150、thinking +96、image +260，折叠态 tool pill 实际约 28px | `useMessageWindow.ts` `#L52-L86` | 高 |
| 2 | 流式 debounce：fast 32ms / maxWait 64ms，>12k 内容 slow 96ms/180ms，成段出现不跟手 | `MarkdownRenderer.vue` `#L185-L200` | 高 |
| 3 | 权限/提问出现时 ChatInputBox + ChatStatusBar 曾整体 v-if unmount；当前已改为 v-show + inert 保持挂载 | `ChatPage.vue` 输入区 mounted-but-hidden 处理 | 高（已修复） |
| 4 | Activity Group：CSS 220ms vs BODY_UNMOUNT_DELAY_MS 260ms，展开先 mount 再切 grid | `MessageBlockActivityGroup.vue` `#L88`, `#L22-L28` | 中高 |
| 5 | Tool Call：只有 opacity/scale/translateY，无高度过渡 | `MessageBlockToolCall.vue` `#L51-L57` | 中高 |
| 6 | ThinkContent 标题区无 cursor-pointer、chevron 无旋转过渡 | `ThinkContent.vue` `#L5-L26` | 中 |
| 7 | Spotlight：v-if 直接挂载，无 Transition、无遮罩淡入 | `SpotlightOverlay.vue` `#L4` | 中 |
| 8 | Will-change 常驻：SidePanel、SideBar、SideBarSessionItem | 全局 grep 验证 | 中（性能） |
| 9 | ChatStatusBar ~3000 行 + 多个 immediate watcher | `ChatStatusBar.vue` 文件大小验证 | 高（性能） |
| 10 | 每条消息独立 ResizeObserver | `MessageListRow.vue` `#L123-L125` | 中（性能） |
| 11 | 图片块 loading h-40 固定，加载后 1:1 不一致 | `MessageBlockImage.vue` `#L23` | 中 |
| 12 | ChatTabView 无 keep-alive，切换时整页重建闪白 | `ChatTabView.vue` `#L11-L14` | 高 |
| 13 | PendingInputLane v-if 无入场动画 | `PendingInputLane.vue` `#L2` | 中 |
| 14 | Session pin 动画 420–560ms 偏长 | `WindowSideBarSessionItem.vue` 样式验证 | 中 |
| 15 | Tool/Arguments/Other 英文硬编码 | `ChatToolInteractionOverlay.vue` `#L32`, `#L36`, `#L68` | 中低 |
| 16 | Motion token 体系不统一：多处写死 duration-150/200/300 | grep 验证 | 中 |

---

### 1.2 Grok 需要修正的 3 处

**1.2.1 AgentProgressFloat "max-height 动画不稳"**

- **grok 说**：Transition 用 max-height: 0 ↔ min(24rem, …) + opacity + translateY
- **实际**：AgentProgressFloat 用的是 Vue `<Transition name="agent-progress-panel">` 配合 `v-show`。CSS `max-height` 不在该组件中——grok 可能混淆了它与其他面板。但 _效果观察_ 确实偏硬（v-show 瞬间切换），仍然建议改进。

**1.2.2 "Agent progress panel 160–220ms 混用"**

- **grok 说**：时长混用
- **实际**：该组件主要用 `transition-all duration-200`，混用程度比描述轻。SidePanel 有明确的 `PANEL_MOTION_MS = 220` / `FULLSCREEN_MOTION_MS = 180`，差异是有意为之。

**1.2.3 部分具体数值**

- **grok 说** "Activity unmount 260ms vs 220 不一致"。260ms 是正确的（`BODY_UNMOUNT_DELAY_MS = 260`），但 grok 认为 CSS 是 `--dc-motion-default = 220ms`。实际 CSS 用的是 `duration-[var(--dc-motion-default)]`，确实 = 220ms。差异 40ms，比 grok 描述的"不一致"更轻微——但仍应统一。

---

### 1.3 Grok 遗漏 / 我没发现的补充项

以下为 grok 报告中未涉及、或一笔带过但值得展开的点。

---

## 二、补充发现

### 2.1 TipTap 编辑器焦点与 IME 风险

**位置**：`ChatInputBox.vue` `#L50-L55`

- 输入框使用 TipTap `EditorContent`，有 `@compositionstart` / `@compositionend` 处理。
- 历史风险：权限/提问态曾通过 `v-if` 卸载 ChatInputBox / ChatStatusBar，TipTap editor 实例会随组件销毁，draft state、IME 组合态和光标位置都有丢失风险。
- 当前实现已改为 `v-show` + `inert` 的 mounted-but-hidden 方案，保留 editor 实例与 StatusBar watcher，避免权限/提问面板出现时反复销毁输入区。

**建议**：保持 mounted-but-hidden 方案；后续仅评估是否需要在异常 unmount 场景补充 draft 序列化兜底。

---

### 2.2 模型图标懒加载无骨架占位 → 布局抖动

**位置**：`ModelIcon.vue`

- 图标通过异步 registry 加载，加载前无尺寸占位
- 首次渲染时图标区域从 0→h-4 w-4，导致消息头部的 model name 位置跳动
- 每次切 session / 新消息首次渲染都会触发

**建议**：加载前渲染固定尺寸的骨架占位 `div`，保持布局稳定

---

### 2.3 Backdrop-blur 值不统一

| 组件 | 值 |
|---|---|
| ChatInputBox | `backdrop-blur-lg` |
| ChatTopBar | `backdrop-blur-lg` |
| PendingInputLane | `backdrop-blur-lg` |
| SpotlightOverlay | `backdrop-blur-[26px]` |
| AgentProgressFloat | `backdrop-blur-[26px]` |
| ChatToolInteractionOverlay | `backdrop-blur-[26px]` |
| ChatSearchBar | `backdrop-blur-xl` |
| ChatStatusBar (acp badge) | `backdrop-blur-lg` |
| McpIndicator | `backdrop-blur-lg` |
| MessageActionButtons | `backdrop-blur-lg` |

**问题**：视觉质感在 3 种 blur 值之间跳跃（`lg`/`xl`/`[26px]`），玻璃态体验碎片化。

**建议**：统一为一个 token，例如 `--dc-glass-blur: blur(18px)`。

---

### 2.4 Scroll 事件处理未节流

**位置**：`ChatPage.vue` `#L8`

```html
@scroll.passive="onScroll"
```

- `onScroll` 内包含 scroll 位置测量、near-bottom 判定、auto-follow 决策、历史加载触发等
- 使用 `.passive` 正确，但 scroll 事件以显示刷新率频率触发，未节流
- 配合每行的 ResizeObserver，内存/CPU 压力叠加

**建议**：对 `onScroll` 加 rAF 合并，或使用 `IntersectionObserver` 替代滚动手动计算

---

### 2.5 嵌套滚动容器问题

**位置**：`ChatPage.vue` + 内嵌的 MessageList + 消息内的代码块/pre 标签

- 主聊天区是 `overflow-y-auto`
- 消息内 Markdown 代码块也可独立横向滚动
- PendingInputLane 内列表也可纵向滚动
- MemoryChip popover 内也可纵向滚动
- 在某些触控板手势下容易滚错容器（尤其两指横滑 vs 代码块横向滚动冲突）

**建议**：对代码块容器加 `overscroll-behavior: contain`；PendingInputLane 滚动区域加明确视觉边界

---

### 2.6 空状态体验不一致

| 场景 | 当前表现 |
|---|---|
| 无消息的新会话 | 显示 Hero（NewThreadPage）或 AgentWelcomePage，体验好 |
| 空搜索结果 | "0 / 0" 文字，无空状态插画 |
| 空 Agent 列表 | 无明确处理 |
| 空 MCP 工具列表 | 无明确处理 |
| 空 Session 列表 | 无明确空状态 |

**建议**：统一空状态组件，含图标 + 文案 + 可选 CTA

---

### 2.7 键盘导航覆盖不足

- **ChatPage 快捷键**：仅有搜索 Ctrl+F、Spotlight 等全局快捷键
- **消息块内**：Tool call pill / Thinking toggle 不支持键盘聚焦（或聚焦样式不可见）
- **Tab 序**：未验证从输入框 Tab → 消息列表 Toolbar → 侧栏 → 侧面板的自然流

**建议**：补全 `focus-visible` 样式，确保关键交互可键盘访问

---

### 2.8 Toast 通知与交互浮层的层级冲突

**位置**：`App.vue` `#L12`（Toaster，z-index 默认 ~50）+ `ChatPage.vue` 内 AgentProgressFloat（z-20）+ SpotlightOverlay（z-[90]）

- Spotlight（z-90）比 Toast 还高，Spotlight 打开时 toast 被遮挡
- Plan float / Tool interaction overlay（z-20）可能与 Toast 重叠

**建议**：建立全局 z-index 层级体系（z-backdrop < z-sticky < z-overlay < z-popover < z-modal < z-toast）

---

### 2.9 拖拽排序缺乏视觉反馈

**位置**：`PendingInputLane.vue` `#L77`（vuedraggable）

- 使用 `draggable` 组件，但拖拽手柄是 CSS class `.pending-input-drag`
- 拖拽过程中无 ghost 样式定制，drag placeholder 视觉弱
- 触控设备完全无法拖拽排序

**建议**：定制 ghost 样式；移动端增加长按触发 + 交换按钮备选方案

---

### 2.10 语言切换 / 方向切换无过渡

**位置**：全局 `langStore.dir` 响应

- 部分地方用 `:dir="langStore.dir"`，切换 RTL/LTR 时文本方向直接跳变
- 无过渡动画处理文本重新对齐

**建议**：非核心，但可在 RTL 切换时加短 fade 或留到后续

---

### 2.11 Windows/Linux 滚动条与 macOS 不一致

**位置**：`ChatTabView.vue` `#L139-L156`

- 全局覆盖了 `::-webkit-scrollbar` 样式（宽度 8px、圆角）
- macOS 原生 overlay scrollbar 被强制替换为常显滚动条
- 这与 macOS 系统偏好冲突，视觉突兀

**建议**：macOS 上保留原生 overlay scrollbar，或提供"系统滚动条"选项

---

### 2.12 Plan Block 进度条颜色缺少暗色适配检查

**位置**：`MessageBlockPlan.vue` `#L18`

```html
class="h-1.5 rounded-full bg-primary transition-all duration-300"
```

- 使用 `bg-primary`，进度条动画 duration-300（硬编码，非 motion token）
- 暗色模式下 Primary 色可能与背景对比度不足

**建议**：统一到 motion token；检查暗色模式对比度

---

### 2.13 首次加载 icon 注册阻塞渲染

**位置**：`App.vue` `#L24`（`ensureIconsLoaded`）

- Iconify 图标集在 `onMounted` 中通过 `ensureIconsLoaded` 按需加载
- 加载期间使用中的图标可能短暂显示为空白占位 → 闪烁

**建议**：关键路径图标预打包；非关键图标加骨架占位

---

## 三、综合优先级矩阵

### P0（用户高频感知，尽快修）

| # | 问题 | 位置 |
|---|---|---|
| 1 | 权限/提问时保持输入框 mounted-but-hidden，避免丢焦点、丢 draft 和布局硬切 | `ChatPage.vue` 输入区 v-show + inert |
| 2 | 流式期间 measure + scroll 合并到单 rAF | `ChatPage.vue`, `MessageListRow.vue` |
| 3 | 窗口化估高按真实折叠态修正 | `useMessageWindow.ts` #L52-L86 |

### P1（明显不精致，应修）

| # | 问题 | 位置 |
|---|---|---|
| 4 | Tool call / Activity group 统一高度动画与 unmount 时序 | `MessageBlockActivityGroup.vue`, `MessageBlockToolCall.vue` |
| 5 | Pending lane / Memory chip / Spotlight 补过渡动画 | 多个组件 |
| 6 | ChatStatusBar 拆分 + 去 deep watch | `ChatStatusBar.vue` |
| 7 | 图片占位与最终尺寸一致 | `MessageBlockImage.vue` |
| 8 | Backdrop-blur 统一到 soft / panel / overlay 语义 token，避免组件内重复内联 | 多个组件 |
| 9 | 会话切换轻过渡 / 缓存（避免闪白） | `ChatTabView.vue` |

### P2（打磨项）

| # | 问题 |
|---|---|
| 10 | Motion token 统一，清魔法数字（duration-150/200/300 → CSS变量） |
| 11 | 侧栏折叠两阶段动画 |
| 12 | 悬浮球对齐 token、收敛时长 |
| 13 | Toolbar 触控可发现性 |
| 14 | i18n 硬编码 Other/Tool/Arguments 标签 |
| 15 | ThinkContent 交互样式对齐 Activity Group（cursor、chevron 旋转） |
| 16 | 空状态统一组件 |
| 17 | z-index 层级体系建立 |
| 18 | 模型图标骨架占位防抖 |
| 19 | Toast 层级不与 Spotlight/Interaction Overlay 冲突 |
| 20 | 滚动性能优化（scroll 事件节流、嵌套滚动 `overscroll-behavior`） |
| 21 | macOS 保留原生 overlay scrollbar |
| 22 | Plan 进度条 duration 走 motion token |

---

## 四、Grok 报告完整评估

| 方面 | 评分 | 说明 |
|---|---|---|
| 覆盖度 | ⭐⭐⭐⭐ | 覆盖了主要交互路径，遗漏 12 项可补充 |
| 准确性 | ⭐⭐⭐⭐☆ | 3 处小偏差（AgentProgressFloat 判断、部分时长数据），主要结论正确 |
| 深度 | ⭐⭐⭐⭐ | 对代码模式有较好理解，尤其是窗口化、流式渲染、动画策略 |
| 实用性 | ⭐⭐⭐⭐⭐ | P0/P1/P2 分层合理，建议方向与代码实际吻合度高 |

**结论**：grok 报告可作为交互优化的主要参考基线，本补充文档填补了遗漏项和细节修正。两份文档合并后形成完整的交互体验审计。

---

*本文档为静态审计产出，不修改代码、不跑验证、不提交。*
