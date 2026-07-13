# 修复 F9：Markdown workers 真正按需初始化

## 目标
将 `ensureMarkdownWorkers()` 从 renderer 启动阶段的无条件调用，改为仅在实际进入 `markstream-vue` 渲染路径时触发，从而避免无 Markdown / KaTeX / Mermaid / 代码块内容时也提前拉起 worker 初始化。

## 定位
- 当前 eager 初始化发生在 [src/renderer/src/main.ts](../../../src/renderer/src/main.ts#L11-L20)：renderer 启动时直接调用 `ensureMarkdownWorkers()`。
- worker 生命周期实现位于 [src/renderer/src/lib/markdownWorkerLifecycle.ts](../../../src/renderer/src/lib/markdownWorkerLifecycle.ts#L73-L150)：`loadWorkerConstructors()` 通过 `import('markstream-vue/workers/... ?worker&inline')` 动态加载构造器，`ensureMarkdownWorkers()` 负责幂等初始化与注册。
- `ensureMarkdownWorkers` 目前仅被两个源码位置引用：定义本身在 [src/renderer/src/lib/markdownWorkerLifecycle.ts](../../../src/renderer/src/lib/markdownWorkerLifecycle.ts#L112-L150)，调用点仅在 [src/renderer/src/main.ts](../../../src/renderer/src/main.ts#L18-L20)。
- 不能把 [src/renderer/src/components/markdown/MarkdownRenderer.vue](../../../src/renderer/src/components/markdown/MarkdownRenderer.vue#L1-L220) 视为唯一 Markdown 入口：除该组件外，[src/renderer/src/components/think-content/ThinkContent.vue](../../../src/renderer/src/components/think-content/ThinkContent.vue#L30-L39) 也直接挂载 `NodeRenderer`，并且其 [code_block / mermaid 自定义组件](../../../src/renderer/src/components/think-content/ThinkContent.vue#L77-L103) 同样可能触发代码块或 Mermaid 渲染路径。

### 证据
- [src/renderer/src/main.ts](../../../src/renderer/src/main.ts#L14-L20) 注释写明 worker 是单一 owner、未就绪时可退化显示，但当前实现仍在应用挂载前执行初始化。
- [src/renderer/src/lib/markdownWorkerLifecycle.ts](../../../src/renderer/src/lib/markdownWorkerLifecycle.ts#L73-L89) 明确使用 Vite `?worker&inline` 语法动态导入 worker 构造器，说明删除 eager 调用后，worker 仍会在 `ensureMarkdownWorkers()` 首次被调用时加载，但产物形态是 inline worker，而不是可直接表述为“独立 chunk”。
- [src/renderer/src/lib/markdownWorkerLifecycle.ts](../../../src/renderer/src/lib/markdownWorkerLifecycle.ts#L112-L150) 已提供 `initialized` 与 `globalScope.__markdownWorkers` 双重守卫，多次调用安全。
- [src/renderer/src/components/markdown/MarkdownRenderer.vue](../../../src/renderer/src/components/markdown/MarkdownRenderer.vue#L5-L16) 直接渲染 `NodeRenderer`；其 [自定义 `mermaid` 与 `code_block` 分支](../../../src/renderer/src/components/markdown/MarkdownRenderer.vue#L157-L220) 会走 `MermaidBlockNode` / `CodeBlockNode`。
- [src/renderer/src/components/think-content/ThinkContent.vue](../../../src/renderer/src/components/think-content/ThinkContent.vue#L30-L39) 同样直接渲染 `NodeRenderer`；其 [自定义 `code_block` 与 `mermaid` 分支](../../../src/renderer/src/components/think-content/ThinkContent.vue#L77-L103) 也覆盖 Mermaid / 代码块场景。
- `grep ensureMarkdownWorkers` 仅命中 2 个文件：调用点只有 [src/renderer/src/main.ts](../../../src/renderer/src/main.ts#L18-L20)，不存在其他现成惰性触发入口。

## 修复方案
1. 从 [src/renderer/src/main.ts](../../../src/renderer/src/main.ts#L18-L20) 删除启动阶段的 eager `ensureMarkdownWorkers()` 调用，避免 renderer 冷启动即初始化 Markdown workers。
2. 重新定义“Markdown 入口”范围：不只覆盖 `MarkdownRenderer.vue`，还要枚举并覆盖所有直接使用 `markstream-vue` `NodeRenderer` 的入口，当前至少包括 [src/renderer/src/components/markdown/MarkdownRenderer.vue](../../../src/renderer/src/components/markdown/MarkdownRenderer.vue#L5-L16) 与 [src/renderer/src/components/think-content/ThinkContent.vue](../../../src/renderer/src/components/think-content/ThinkContent.vue#L30-L39)。
3. 在这些直接入口组件内触发 `ensureMarkdownWorkers()`，利用其幂等性允许多入口安全并发调用，而不是把检测逻辑散落到更高层页面。
4. 风险上明确接受一个过渡态：首次渲染到 worker 就绪之间，可能出现纯文本或基础渲染的短暂闪烁；该体验需要作为惰性初始化的显式权衡来验证，而不是默认假设完全无感。
5. 不再使用“worker 仍以独立 chunk 存在”的绝对表述；这里只能确认 `?worker&inline` 动态导入路径仍可在首次调用 `ensureMarkdownWorkers()` 时拉起对应 worker。
6. 对 fallback 行为保持审慎：当前仓库中只在注释层面看到“未就绪时退化显示”的说法，尚未在本仓代码里看到显式 fallback 实现，因此需要额外实证 `markstream-vue` 的真实行为与类型约束。

## 步骤拆分
1. 删除 [src/renderer/src/main.ts](../../../src/renderer/src/main.ts#L18-L20) 的 eager 初始化调用。
2. 枚举所有直接 `NodeRenderer` / `markstream-vue` 渲染入口，至少覆盖 [src/renderer/src/components/markdown/MarkdownRenderer.vue](../../../src/renderer/src/components/markdown/MarkdownRenderer.vue#L5-L16) 和 [src/renderer/src/components/think-content/ThinkContent.vue](../../../src/renderer/src/components/think-content/ThinkContent.vue#L30-L39)。
3. 在上述入口组件内接入惰性 `ensureMarkdownWorkers()` 调用，并保持多次 mount / 多入口并发场景下的幂等语义。
4. 补充或调整测试，验证 worker 不再在 renderer 启动时初始化，而是在这些真实渲染入口首次挂载时触发。
5. 构建与手动验证时，额外核实 `?worker&inline` 的产物形态以及首次渲染前后 UI 表现。

## 验证
- 静态引用验证：`grep ensureMarkdownWorkers` 应继续只出现于生命周期模块定义和明确的新惰性入口调用位置；当前基线为仅 2 个文件（定义 + `main.ts` 调用）。
- 组件路径验证：检查所有直接 `NodeRenderer` 入口是否都已覆盖，尤其是 [src/renderer/src/components/think-content/ThinkContent.vue](../../../src/renderer/src/components/think-content/ThinkContent.vue#L30-L39) 这类非 `MarkdownRenderer.vue` 路径。
- 产物验证：`pnpm run build` 后核实 `markstream-vue/workers/*?worker&inline` 的实际构建产物形态，确认删除 eager 调用后仍能通过动态 import 拉起 worker，但不要把结果描述成“独立 chunk 仍存在”除非产物实测支持。
- fallback 实证：通过检查 `markstream-vue` 用法、类型或运行表现，确认 worker 未就绪时到底是纯文本、基础渲染，还是其他退化行为；不能只依赖本仓注释。
- 体验验证：手动或自动测试首次打开含公式 / Mermaid / 代码块内容时，确认渲染成功，并观察首次 worker 就绪前是否存在纯文本/基础渲染闪烁。

## 风险
- 首次命中 Markdown worker 能力时需要异步加载与注册，可能带来首次公式、Mermaid 或复杂代码块渲染延迟。
- 从首次渲染到 worker 就绪之间，可能出现纯文本或基础渲染的短暂闪烁；如果闪烁明显，可能需要额外占位或延迟策略。
- 若只覆盖 `MarkdownRenderer.vue` 而遗漏 [src/renderer/src/components/think-content/ThinkContent.vue](../../../src/renderer/src/components/think-content/ThinkContent.vue#L30-L39) 这类直接 `NodeRenderer` 路径，仍会存在未初始化 worker 的功能缺口。
- `markstream-vue` 的实际 fallback 语义目前在本仓缺少显式实现证据，若上游行为与注释不一致，惰性初始化方案可能引入未预期的渲染退化。