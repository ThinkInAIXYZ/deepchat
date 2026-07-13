# Artifact streaming parse hotspot

## Issue

`useArtifacts.generatePart` 对流式内容做 O(n × m) 同步扫描；含大量 artifact 标签或长文本的流式输出时，token 到达越久越卡。

## Impact

- renderer 主线程被解析占用，打字机流式体感变差
- 与 Markdown 渲染、列表测量叠加后更明显

## Suspected root cause / location

- `src/renderer/src/composables/useArtifacts.ts` `generatePart`（约 L107–L509）
  - 内层循环对每个 tag pattern `new RegExp(...)` 并在 `content.substring(currentPosition)` 上 exec
  - 每次 content 更新从头扫描完整字符串
  - tool 相关标签在内层再次创建正则

## Fix plan

1. 预编译所有标签正则；禁止扫描内层新建 RegExp
2. 使用单一合并起始标签正则定位下一候选，再按类型分支处理（或等价的预编译多模式 earliest-match）
3. 对流式文本做轻量缓存：相同 content+status 直接返回；前缀增长时尽量复用已解析的完整 parts 偏移（若实现成本可控）
4. 本轮不做 Worker 迁移（列为后续可选）

## Task checklist

- [x] 预编译 tag / tool 相关正则
- [x] 消除内层 `new RegExp` + 重复 substring 扫描热点
- [x] 相同输入结果缓存（至少 memo last content/status）
- [x] 导出可测 API 或经 `extractArtifactsFromContent` 覆盖
- [x] 单元测试：thinking / closed&open artifact / tool_call 序列
- [x] format / i18n / lint / 聚焦测试

## Validation

- 长 content 多次解析时不再随长度二次方恶化（实现上应为单次线性扫描 + 缓存命中 O(1)）
- 现有 artifact / tool_call 解析语义不变
- MessageBlockContent / WorkspacePanel 提取 artifact 行为不回归

## Linked GitHub issue

（未同步；需开发者明确要求后再创建）
