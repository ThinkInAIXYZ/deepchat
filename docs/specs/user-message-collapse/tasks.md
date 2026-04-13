# 用户长文本消息默认折叠任务清单

## T0 规格文档

- [x] 创建 `docs/specs/user-message-collapse/spec.md`
- [x] 创建 `docs/specs/user-message-collapse/plan.md`
- [x] 创建 `docs/specs/user-message-collapse/tasks.md`
- [x] 检查 `spec.md` 中是否存在未解决的 `[NEEDS CLARIFICATION]`

当前状态：
当前没有未解决的 `[NEEDS CLARIFICATION]` 项；如后续新增，需先找 stakeholder 确认再进入实现。

## T1 正文提取与判定逻辑

- [x] 抽取用户消息正文可见文本的纯函数
- [x] 支持结构化内容拼接后的字符数与换行数统计
- [x] 支持 `message.content.text` 的后备路径
- [x] 实现 `>= 600` 字符或 `>= 8` 行的阈值判断
- [x] 为正文提取和阈值逻辑补 renderer 单测

## T2 高度测量与可折叠检测

- [x] 为用户消息正文增加可测量的容器 `ref`
- [x] 从 computed style 读取 `line-height`
- [x] `line-height` 不可解析时回退到 `font-size * 1.5`
- [x] 根据 `12` 行高度计算预览高度
- [x] 真实渲染高度未超过预览高度时隐藏折叠按钮

## T3 折叠/展开 UI

- [x] 给用户消息正文增加默认折叠态
- [x] 增加渐隐遮罩样式
- [x] 接入 `common.expand` / `common.collapse` 按钮文案
- [x] 支持展开后再次折叠
- [x] 补默认折叠、展开、再次折叠的组件测试

## T4 附件与编辑态豁免

- [x] 把附件区域放在正文折叠容器之外
- [x] 验证长文本 + 附件时附件始终完整可见
- [x] 编辑态直接显示完整 textarea，不应用正文裁切
- [x] 补附件豁免与编辑态豁免测试

## T5 动态重评估

- [x] 在正文内容变化后重新检测可折叠状态
- [x] 用 `ResizeObserver` 或等价机制在容器尺寸变化后重扫
- [x] resize 后若不再超高，自动取消折叠并隐藏按钮
- [x] 补窗口 resize / 内容变化后的状态切换测试

## T6 QA 与回归

- [x] 手测短文本消息不出现折叠按钮
- [x] 手测超长纯文本默认折叠
- [x] 手测带附件的超长消息仅正文折叠
- [x] 手测编辑态显示完整内容
- [x] 手测 resize 后重新判定和自动解折叠
- [x] 运行 `pnpm run format`
- [x] 运行 `pnpm run i18n`
- [x] 运行 `pnpm run lint`
