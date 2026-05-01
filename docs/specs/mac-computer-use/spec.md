# macOS Computer Use Spec

## Summary

DeepChat 需要在 macOS 上提供 Computer Use 能力，让模型可以通过内置工具读取屏幕状态、
枚举窗口、截屏，并在用户授权后执行点击、输入、快捷键等本机操作。该能力仅在 macOS 有效，
并通过 DeepChat 内置的 `DeepChat Computer Use.app` helper 实现。

用户不需要单独安装 CUA Driver。DeepChat macOS 安装包需要包含匹配当前架构的 helper：
`arm64` 构建包含 arm64 helper，`x64` 构建包含 x86_64 helper。

## Goals

- 在 macOS 上内置 source-built CUA Driver，并通过 MCP 接入 DeepChat agent tool flow。
- 让用户明确开启 Computer Use 后才启用该能力。
- 用 DeepChat 品牌身份请求 macOS 权限，避免系统设置中出现不明来源的 `CuaDriver`。
- 提供清晰的 Accessibility 和 Screen Recording 权限引导。
- 保持 Windows/Linux 行为不变。
- 保持最终交付物为一个 DeepChat app，不要求用户安装额外 app 或命令行工具。

## User Stories

- 作为 macOS 用户，我可以在设置中看到 Computer Use 入口，并理解它需要本机控制权限。
- 作为 macOS 用户，我可以一键打开权限引导，按步骤授予 Accessibility 和 Screen Recording。
- 作为 macOS 用户，我开启 Computer Use 后，agent 可以使用屏幕读取和本机操作工具。
- 作为隐私敏感用户，我不启用 Computer Use 时，DeepChat 不启动 helper、不注册相关 MCP 工具。
- 作为 Windows/Linux 用户，我不会看到可误用的 Computer Use 启用入口。
- 作为发布工程师，我可以分别构建 macOS x64 和 arm64 包，并确认 helper 架构正确。

## Functional Requirements

- Settings:
  - macOS 显示 Computer Use 设置卡片。
  - 默认状态为 disabled。
  - 卡片展示 helper 状态、MCP 状态、Accessibility 权限、Screen Recording 权限。
  - 卡片提供 enable/disable、open permission guide、check again 操作。
- Permissions:
  - 权限身份必须是 `DeepChat Computer Use`。
  - 缺少任一必需权限时，MCP server 不应静默失败；UI 应展示明确状态。
  - 权限引导必须覆盖 Accessibility 和 Screen Recording。
- MCP:
  - DeepChat 内置 MCP server key 使用 `deepchat/computer-use`。
  - server type 使用 `stdio`。
  - command 指向 packaged helper binary。
  - args 使用 `['mcp']`。
  - `autoApprove` 默认空数组。
  - CUA action tools 需要走 DeepChat 现有 permission flow。
- Packaging:
  - macOS build 必须从 vendored source 构建 helper。
  - macOS release artifact 只包含目标架构 helper。
  - helper 必须被签名并随 DeepChat app 一起 notarized。

## Non-Goals

- 不支持 Windows/Linux Computer Use。
- 不提供独立的 CUA Driver 安装器。
- 不允许通过下载上游 release binary 完成正式构建。
- 不在本阶段实现 remote desktop、远程控制或多人协作。
- 不绕过 macOS TCC；用户必须在系统设置中授予权限。

## Acceptance Criteria

- On macOS:
  - Fresh install 后 Computer Use disabled，helper 未启动，MCP 工具未注册。
  - 用户启用后，如果权限缺失，状态显示 missing，并能打开权限引导。
  - 用户授予 Accessibility 和 Screen Recording 后，状态变为 granted。
  - `deepchat/computer-use` server 可以启动，工具列表包含 CUA MCP tools。
  - `check_permissions`、`list_windows`、`screenshot` 可用。
  - action tool 如 `click`、`type_text` 在默认权限模式下触发 DeepChat permission prompt。
- On non-macOS:
  - 不打包 helper。
  - 不注册 `deepchat/computer-use`。
  - 设置页不显示可启用的 Computer Use 卡片，或只显示 unavailable 状态。
- Packaging:
  - mac arm64 artifact 内 helper binary 为 arm64。
  - mac x64 artifact 内 helper binary 为 x86_64。
  - `codesign --verify --deep --strict` 对 helper 和外层 `DeepChat.app` 通过。
  - release notarization 仍通过。

## Constraints

- DeepChat app id 当前为 `com.wefonk.deepchat`。
- Helper bundle id 固定为 `com.wefonk.deepchat.computeruse`，避免 TCC grant 随版本变化丢失。
- CUA Driver 当前 `Package.swift` 声明最低 macOS 14；本功能最低 macOS 14。
- 新 renderer-main 能力应使用 typed route/client，不新增 `useLegacyPresenter()` 调用。

