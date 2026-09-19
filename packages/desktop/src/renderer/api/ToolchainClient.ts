import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  type DeepchatEventPayload,
  toolchainsChangedEvent,
  toolchainsMissingEvent,
  toolchainsProgressEvent
} from '@shared/contracts/events'
import {
  toolchainsCancelInstallRoute,
  toolchainsGetStatusRoute,
  toolchainsInstallRoute,
  toolchainsPickCustomRoute,
  toolchainsRepairRoute,
  toolchainsRevertRoute,
  toolchainsSetSourceRoute
} from '@shared/contracts/routes'
import type { ToolchainKind, ToolchainSelection } from '@shared/types/toolchains'
import { getDeepchatBridge } from './core'

export function createToolchainClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getStatus() {
    return await bridge.invoke(toolchainsGetStatusRoute.name, {})
  }

  async function setSource(kind: ToolchainKind, selection: ToolchainSelection) {
    return await bridge.invoke(toolchainsSetSourceRoute.name, { kind, selection })
  }

  async function install(kind: ToolchainKind) {
    return await bridge.invoke(toolchainsInstallRoute.name, { kind })
  }

  async function cancelInstall(kind: ToolchainKind) {
    return await bridge.invoke(toolchainsCancelInstallRoute.name, { kind })
  }

  async function repair(kind: ToolchainKind) {
    return await bridge.invoke(toolchainsRepairRoute.name, { kind })
  }

  async function revert(kind: ToolchainKind) {
    return await bridge.invoke(toolchainsRevertRoute.name, { kind })
  }

  async function pickCustom(kind: ToolchainKind) {
    return await bridge.invoke(toolchainsPickCustomRoute.name, { kind })
  }

  function onProgress(listener: (payload: DeepchatEventPayload<'toolchains.progress'>) => void) {
    return bridge.on(toolchainsProgressEvent.name, listener)
  }

  function onMissing(listener: (payload: DeepchatEventPayload<'toolchains.missing'>) => void) {
    return bridge.on(toolchainsMissingEvent.name, listener)
  }

  function onChanged(listener: (payload: DeepchatEventPayload<'toolchains.changed'>) => void) {
    return bridge.on(toolchainsChangedEvent.name, listener)
  }

  return {
    getStatus,
    setSource,
    install,
    cancelInstall,
    repair,
    revert,
    pickCustom,
    onProgress,
    onMissing,
    onChanged
  }
}

export type ToolchainClient = ReturnType<typeof createToolchainClient>
