import ElectronStore from 'electron-store'
import type { PluginToolPolicyDecision } from '@shared/types/plugin'

type StoredToolPolicy = {
  pluginId: string
  serverId: string
  tools: Record<string, PluginToolPolicyDecision>
  enabled: boolean
}

type ToolPolicySettings = {
  policies: StoredToolPolicy[]
}

const store = new ElectronStore<ToolPolicySettings>({
  name: 'plugin-tool-policies',
  defaults: {
    policies: []
  }
})

export function registerPluginToolPolicy(policy: StoredToolPolicy): void {
  const policies = store.get('policies') ?? []
  const filtered = policies.filter(
    (item) => !(item.pluginId === policy.pluginId && item.serverId === policy.serverId)
  )
  store.set('policies', [...filtered, policy])
}

export function unregisterPluginToolPolicies(pluginId: string): void {
  const policies = store.get('policies') ?? []
  store.set(
    'policies',
    policies.filter((policy) => policy.pluginId !== pluginId)
  )
}

export function getPluginToolPolicy(
  serverId: string,
  toolName: string
): PluginToolPolicyDecision | null {
  const policies = store.get('policies') ?? []
  for (const policy of policies) {
    if (!policy.enabled || policy.serverId !== serverId) {
      continue
    }
    const decision = policy.tools[toolName]
    if (decision === 'allow' || decision === 'ask' || decision === 'deny') {
      return decision
    }
  }
  return null
}
