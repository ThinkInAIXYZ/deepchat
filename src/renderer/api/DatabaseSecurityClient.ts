import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
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

  async function repairSchema(): Promise<DatabaseRepairReport> {
    const result = await bridge.invoke(databaseSecurityRepairSchemaRoute.name, {})
    return result.report
  }

  return {
    getStatus,
    repairSchema
  }
}

export type DatabaseSecurityClient = ReturnType<typeof createDatabaseSecurityClient>
