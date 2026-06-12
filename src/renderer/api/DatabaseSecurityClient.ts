import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  databaseSecurityChangePasswordRoute,
  databaseSecurityDisableRoute,
  databaseSecurityEnableRoute,
  databaseSecurityGetStatusRoute,
  databaseSecurityRepairSchemaRoute,
  type DatabaseRepairReport,
  type DatabaseSecurityStatus
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createDatabaseSecurityClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getStatus(): Promise<DatabaseSecurityStatus> {
    const result = await bridge.invoke(databaseSecurityGetStatusRoute.name, {})
    return result.status
  }

  async function enable(password: string): Promise<DatabaseSecurityStatus> {
    const result = await bridge.invoke(databaseSecurityEnableRoute.name, { password })
    return result.status
  }

  async function changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<DatabaseSecurityStatus> {
    const result = await bridge.invoke(databaseSecurityChangePasswordRoute.name, {
      currentPassword,
      newPassword
    })
    return result.status
  }

  async function disable(currentPassword: string): Promise<DatabaseSecurityStatus> {
    const result = await bridge.invoke(databaseSecurityDisableRoute.name, { currentPassword })
    return result.status
  }

  async function repairSchema(): Promise<DatabaseRepairReport> {
    const result = await bridge.invoke(databaseSecurityRepairSchemaRoute.name, {})
    return result.report
  }

  return {
    getStatus,
    enable,
    changePassword,
    disable,
    repairSchema
  }
}

export type DatabaseSecurityClient = ReturnType<typeof createDatabaseSecurityClient>
