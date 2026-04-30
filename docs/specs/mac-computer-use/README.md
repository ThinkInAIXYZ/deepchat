# macOS Computer Use Handoff

本文档集描述 DeepChat 集成 macOS Computer Use 的规格、架构和实施计划。目标是让后续
macOS 开发人员可以在 Mac 机器上继续实现，不需要重新调研 `trycua/cua` 和
`zats/permiso` 的集成边界。

调研日期：2026-04-26。

## Current Decisions

- 从 `vendor/cua-driver/source` 的 vendored `trycua/cua/libs/cua-driver` 源码集成。
- 上游基线记录在 `vendor/cua-driver/upstream.json`，同步通过 `pnpm run cua:update` 人工触发。
- macOS-only；Windows/Linux 不打包、不注册、不展示可用能力。
- 默认 opt-in；用户在设置中显式开启后才注册并启动 Computer Use。
- 权限身份使用 DeepChat 自己的 helper：
  - Bundle display name: `DeepChat Computer Use`
  - Bundle identifier: `com.wefonk.deepchat.computeruse`
- 最终交付仍然是一个 DeepChat Electron app，helper 作为 nested app 打进
  `DeepChat.app`。
- CUA MCP 入口使用 `cua-driver mcp`。
- 权限引导参考 `zats/permiso`：打开 System Settings 隐私面板，并在系统设置窗口上方显示
  非激活 overlay 指引。

## Document Map

- [spec.md](spec.md): 用户目标、范围、验收标准、非目标。
- [plan.md](plan.md): DeepChat 主进程、renderer、MCP、权限状态的数据流和接口设计。
- [packaging.md](packaging.md): CUA 源码 vendoring、Swift build、架构区分、codesign、
  notarization、CI 接入。
- [permissions-ux.md](permissions-ux.md): permiso 风格权限引导、设置页 UI、ASCII UX 草图。
- [tasks.md](tasks.md): 建议 PR 拆分、依赖顺序、验收点。
- [references.md](references.md): 外部项目链接、当前版本事实、关键源码依据。

## Implementation Rule

本批文档不实现功能代码。后续实现时应按 SDD 流程保持 spec -> plan -> tasks -> PR 的可追踪性，
并在每个 PR 中更新对应文档。
