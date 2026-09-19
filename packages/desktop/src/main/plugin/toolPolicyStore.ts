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

export type PluginToolPolicyLookup = {
  managed: boolean
  decision: PluginToolPolicyDecision | null
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
  return resolvePluginToolPolicy(serverId, toolName).decision
}

function getEnabledServerPolicies(serverId: string): StoredToolPolicy[] {
  const policies = store.get('policies') ?? []
  return policies.filter((policy) => policy.enabled && policy.serverId === serverId)
}

export function getExplicitlyDeniedPluginTools(serverId: string): string[] {
  const matches = getEnabledServerPolicies(serverId)
  if (matches.length !== 1) {
    return []
  }
  return Object.entries(matches[0].tools)
    .filter(([, decision]) => decision === 'deny')
    .map(([toolName]) => toolName)
}

export function resolvePluginToolPolicy(
  serverId: string,
  toolName: string
): PluginToolPolicyLookup {
  const matches = getEnabledServerPolicies(serverId)
  if (matches.length === 0) {
    return { managed: false, decision: null }
  }

  // More than one enabled owner for a server is ambiguous. Treat it like an
  // undeclared tool so stale policy records cannot accidentally widen access.
  if (matches.length !== 1) {
    return { managed: true, decision: null }
  }

  const decision = matches[0].tools[toolName]
  return {
    managed: true,
    decision: decision === 'allow' || decision === 'ask' || decision === 'deny' ? decision : null
  }
}
