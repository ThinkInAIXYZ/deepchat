import type { PluginToolPolicyDecision } from '@shared/types/plugin'

export type StoredToolPolicy = {
  pluginId: string
  serverId: string
  tools: Record<string, PluginToolPolicyDecision>
  enabled: boolean
}

export type PluginToolPolicyLookup = {
  managed: boolean
  decision: PluginToolPolicyDecision | null
}

export class PluginToolPolicyStore {
  constructor(
    private readonly store: {
      get(key: 'policies'): StoredToolPolicy[] | undefined
      set(key: 'policies', policies: StoredToolPolicy[]): void
    }
  ) {}

  register(policy: StoredToolPolicy): void {
    const policies = this.store.get('policies') ?? []
    const filtered = policies.filter(
      (item) => !(item.pluginId === policy.pluginId && item.serverId === policy.serverId)
    )
    this.store.set('policies', [...filtered, policy])
  }

  unregister(pluginId: string): void {
    const policies = this.store.get('policies') ?? []
    this.store.set(
      'policies',
      policies.filter((policy) => policy.pluginId !== pluginId)
    )
  }

  deniedTools(serverId: string): string[] {
    const matches = this.getEnabledServerPolicies(serverId)
    if (matches.length !== 1) return []
    return Object.entries(matches[0].tools)
      .filter(([, decision]) => decision === 'deny')
      .map(([toolName]) => toolName)
  }

  resolve(serverId: string, toolName: string): PluginToolPolicyLookup {
    const matches = this.getEnabledServerPolicies(serverId)
    if (matches.length === 0) return { managed: false, decision: null }
    // Ambiguous owners retain a closed policy, including undeclared tools.
    if (matches.length !== 1) return { managed: true, decision: null }
    const decision = matches[0].tools[toolName]
    return {
      managed: true,
      decision: decision === 'allow' || decision === 'ask' || decision === 'deny' ? decision : null
    }
  }

  private getEnabledServerPolicies(serverId: string): StoredToolPolicy[] {
    const policies = this.store.get('policies') ?? []
    return policies.filter((policy) => policy.enabled && policy.serverId === serverId)
  }
}
