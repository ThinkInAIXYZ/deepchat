import { PluginToolPolicyStore, type StoredToolPolicy } from '../../src/main/plugin/toolPolicyStore'

export function createPluginToolPolicies(): PluginToolPolicyStore {
  let policies: StoredToolPolicy[] = []
  return new PluginToolPolicyStore({
    get: () => structuredClone(policies),
    set: (_key, next) => {
      policies = structuredClone(next)
    }
  })
}
