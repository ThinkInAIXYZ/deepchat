import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  computerUseCheckPermissionsRoute,
  computerUseGetStatusRoute,
  computerUseOpenPermissionGuideRoute,
  computerUseRestartMcpServerRoute,
  computerUseSetEnabledRoute
} from '@shared/contracts/routes'
import type { ComputerUsePermissionTarget } from '@shared/types/computerUse'
import { getDeepchatBridge } from './core'

export function createComputerUseClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getStatus() {
    const result = await bridge.invoke(computerUseGetStatusRoute.name, {})
    return result.status
  }

  async function setEnabled(enabled: boolean) {
    const result = await bridge.invoke(computerUseSetEnabledRoute.name, { enabled })
    return result.status
  }

  async function openPermissionGuide(target?: ComputerUsePermissionTarget) {
    await bridge.invoke(computerUseOpenPermissionGuideRoute.name, { target })
  }

  async function checkPermissions() {
    const result = await bridge.invoke(computerUseCheckPermissionsRoute.name, {})
    return result.permissions
  }

  async function restartMcpServer() {
    const result = await bridge.invoke(computerUseRestartMcpServerRoute.name, {})
    return result.status
  }

  return {
    getStatus,
    setEnabled,
    openPermissionGuide,
    checkPermissions,
    restartMcpServer
  }
}

export type ComputerUseClient = ReturnType<typeof createComputerUseClient>
