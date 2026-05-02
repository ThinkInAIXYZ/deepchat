# Hooks Commands V2 Plan

## Summary

- 删除旧 Hooks 的 Telegram / Discord / Confirmo 通道能力
- 重建为纯 command hooks
- 支持多组 hooks 配置与单组测试
- 拆除 Telegram remote 对 hooks 配置的依赖

## Implementation

### Shared / Main

- 更新 `src/shared/hooksNotifications.ts`
- 将 hooks 设置模型改为 `hooks: HookCommandItem[]`
- 重写 `src/main/presenter/hooksNotifications/config.ts`
- 重写 `src/main/presenter/hooksNotifications/index.ts`
- 删除 Confirmo、Telegram、Discord 的 hooks 运行时逻辑
- `testHookCommand` 改为按 `hookId` 执行

### Remote

- 更新 `TelegramRemoteRuntimeConfig`，将 `botToken` 写回 remote-control 自己的配置
- 删除 `TelegramRemoteSettings.hookNotifications`
- 删除 `RemoteControlPresenterDeps` 中的 hooks 依赖
- 清理 `RemoteSettings` 中 Telegram hooks UI

### Renderer

- 重写 `NotificationsHooksSettings.vue`
- 改为多组 hook 列表 + 新建 / 删除 / 测试
- 更新 i18n 文案，移除旧 webhook / confirmo 方向描述

## Validation

- `typecheck:node`
- `typecheck:web`
- `test/main/presenter/hooksNotifications.test.ts`
- `test/main/presenter/remoteControlPresenter/remoteControlPresenter.test.ts`
- `test/renderer/components/RemoteSettings.test.ts`
- `format`
- `i18n`
- `lint`
