# QQBot and WeChat iLink Tasks

## Phase 1: Shared Contract

- [x] Extend remote shared presenter types with `RemoteChannelId`, channel descriptors, and QQBot settings / status / pairing types.
- [x] Add `listRemoteChannels()` to the remote presenter contract.
- [x] Keep Telegram compatibility methods intact.

## Phase 2: QQBot Main Runtime

- [x] Add QQBot config normalization and binding-store support under `remoteControl.qqbot`.
- [x] Add official QQBot HTTP client and gateway session modules.
- [x] Add QQBot parser, auth guard, command router, runtime, and adapter.
- [x] Register QQBot through `ChannelManager` instead of adding another presenter-owned runtime branch.

## Phase 3: Registry-Driven Renderer

- [x] Update Remote settings overview cards and tab headers to use remote channel descriptors.
- [x] Add a built-in QQBot settings panel.
- [x] Update the sidebar remote-status button to aggregate implemented channels from descriptors.
- [x] Add a built-in WeChat iLink settings panel with QR login and account management.

## Phase 4: Documentation and Coverage

- [x] Add focused QQBot unit tests for parser, auth guard, command router, and adapter.
- [x] Update presenter regression coverage for descriptor listing and WeChat iLink login persistence.
- [x] Update renderer regression coverage for WeChat iLink QR login UI.
- [x] Update the remote multi-channel spec / plan / tasks documents to reflect QQBot + WeChat iLink delivery.

## Phase 5: Validation

- [x] Run focused remote main-process Vitest suites.
- [x] Run focused renderer Remote settings and sidebar Vitest suites.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
