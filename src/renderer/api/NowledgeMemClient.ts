import { createPluginClient } from './PluginClient'
import {
  NOWLEDGE_PLUGIN_ID,
  type NowledgePluginState,
  type NowledgeConnectionInput,
  type NowledgeExportInput
} from '@shared/types/nowledgeMemPlugin'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  nowledgeMemGetConfigRoute,
  nowledgeMemTestConnectionRoute,
  nowledgeMemUpdateConfigRoute,
  type NowledgeMemConfig,
  type NowledgeMemConnectionResult
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createNowledgeMemClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getConfig(): Promise<NowledgeMemConfig> {
    const result = await bridge.invoke(nowledgeMemGetConfigRoute.name, {})
    return result.config
  }

  async function updateConfig(config: Partial<NowledgeMemConfig>): Promise<NowledgeMemConfig> {
    const result = await bridge.invoke(nowledgeMemUpdateConfigRoute.name, { config })
    return result.config
  }

  async function testConnection(config?: NowledgeMemConfig): Promise<NowledgeMemConnectionResult> {
    const result = await bridge.invoke(
      nowledgeMemTestConnectionRoute.name,
      config ? { config } : {}
    )
    return result.result
  }

  const plugins = createPluginClient(bridge)
  async function connectionAction(
    actionId: string,
    payload?: NowledgeConnectionInput
  ): Promise<NowledgePluginState> {
    const result = await plugins.invokeAction({
      pluginId: NOWLEDGE_PLUGIN_ID,
      actionId,
      ...(payload
        ? {
            payload: Object.fromEntries(
              Object.entries(payload).filter(([, value]) => value !== undefined)
            )
          }
        : {})
    })
    if (!result.ok) throw new Error(result.error || 'Nowledge Mem operation failed')
    return result.data as unknown as NowledgePluginState
  }

  return {
    sendSession: async (input: NowledgeExportInput): Promise<void> => {
      const result = await plugins.invokeAction({
        pluginId: NOWLEDGE_PLUGIN_ID,
        actionId: 'nowledge.export',
        payload: { ...input }
      })
      if (!result.ok) throw new Error(result.error || 'Nowledge export failed')
    },
    getConnections: () => connectionAction('nowledge.get'),
    clearConnections: () => connectionAction('nowledge.clear'),
    saveConnection: (input: NowledgeConnectionInput) => connectionAction('nowledge.save', input),
    getConfig,
    updateConfig,
    testConnection
  }
}

export type NowledgeMemClient = ReturnType<typeof createNowledgeMemClient>
