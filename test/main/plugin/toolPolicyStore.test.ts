import { describe, expect, it } from 'vitest'
import { PluginToolPolicyStore, type StoredToolPolicy } from '@/plugin/toolPolicyStore'
import { createPluginToolPolicies } from '../../helpers/pluginToolPolicies'

const policy: StoredToolPolicy = {
  pluginId: 'fixture-owner',
  serverId: 'fixture-server',
  tools: { allowed: 'allow', prompted: 'ask', blocked: 'deny' },
  enabled: true
}

describe('PluginToolPolicyStore', () => {
  it('preserves decisions and closes undeclared or ambiguous owned tools', () => {
    const owner = createPluginToolPolicies()
    expect(owner.resolve('fixture-server', 'allowed')).toEqual({ managed: false, decision: null })
    owner.register(policy)
    for (const [tool, decision] of Object.entries(policy.tools))
      expect(owner.resolve(policy.serverId, tool)).toEqual({ managed: true, decision })
    expect(owner.resolve(policy.serverId, 'undeclared')).toEqual({ managed: true, decision: null })
    expect(owner.deniedTools(policy.serverId)).toEqual(['blocked'])
    owner.register({ ...policy, pluginId: 'another-owner' })
    expect(owner.resolve(policy.serverId, 'allowed')).toEqual({ managed: true, decision: null })
    expect(owner.deniedTools(policy.serverId)).toEqual([])
    owner.register({ ...policy, pluginId: 'another-owner', enabled: false })
    expect(owner.resolve(policy.serverId, 'allowed').decision).toBe('allow')
  })

  it('replaces one owner/server pair and removes only the requested owner', () => {
    const owner = createPluginToolPolicies()
    owner.register(policy)
    owner.register({ ...policy, serverId: 'another-server' })
    owner.register({ ...policy, pluginId: 'another-owner', serverId: 'unrelated-server' })
    owner.register({ ...policy, tools: { allowed: 'deny' } })
    expect(owner.resolve(policy.serverId, 'allowed').decision).toBe('deny')
    owner.unregister(policy.pluginId)
    expect(owner.resolve(policy.serverId, 'allowed').managed).toBe(false)
    expect(owner.resolve('another-server', 'allowed').managed).toBe(false)
    expect(owner.resolve('unrelated-server', 'allowed').decision).toBe('allow')
  })

  it('keeps disabled policies unmanaged and isolates separate profile owners', () => {
    const owner = createPluginToolPolicies()
    owner.register({ ...policy, enabled: false })
    expect(owner.resolve(policy.serverId, 'blocked')).toEqual({ managed: false, decision: null })
    owner.register(policy)
    expect(createPluginToolPolicies().resolve(policy.serverId, 'blocked').managed).toBe(false)
  })

  it('does not acknowledge failed persistence or retain an independent decision cache', () => {
    let policies = [policy]
    const owner = new PluginToolPolicyStore({
      get: () => structuredClone(policies),
      set: () => {
        throw new Error('Policy persistence failed')
      }
    })
    expect(() => owner.register({ ...policy, tools: { allowed: 'deny' } })).toThrow('persistence')
    expect(() => owner.unregister(policy.pluginId)).toThrow('persistence')
    expect(owner.resolve(policy.serverId, 'allowed').decision).toBe('allow')
    policies = [{ ...policy, tools: { allowed: 'ask' } }]
    expect(owner.resolve(policy.serverId, 'allowed').decision).toBe('ask')
  })
})
