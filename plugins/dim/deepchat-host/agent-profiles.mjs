import { createHash } from 'node:crypto'
import { withNativeClient } from './native-client.mjs'

// Profiles are immutable native Agent records. Reopening the same product configuration finds
// its stable content identity through the Rust owner; no desktop copy becomes an execution profile.
export async function registerAgentProfiles(ctx, address, profile) {
  const creating = new Map()
  await ctx.use('managementMethods').register(
    'deepchat.agent',
    [
      {
        name: 'deepchat.agent.ensure',
        mutating: true,
        interruption: 'drain',
        progress: false
      }
    ],
    async ({ params }) => {
      const canonical = (value) =>
        Array.isArray(value)
          ? value.map(canonical)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .map((key) => [key, canonical(value[key])])
              )
            : value
      const key = JSON.stringify(canonical(params))
      const marker = createHash('sha256').update('deepchat/agent/v1\0').update(key).digest('hex')
      const nativeProfile = {
        ...params,
        description: `${params.description ?? ''}\n[deepchat-profile:${marker}]`
      }
      if (creating.has(key)) return creating.get(key)
      if (creating.size >= 64)
        return { code: 'agent_busy', message: 'Too many profile changes in progress' }
      const task = withNativeClient(
        address,
        {
          profile,
          methods: ['agent.list', 'agent.create']
        },
        async (call) => {
          const agents = await call('agent.list', {})
          const found = agents.find(
            (agent) =>
              agent.name === nativeProfile.name && agent.description === nativeProfile.description
          )
          if (found) return { kind: 'value', value: { agentId: found.agentId } }
          return { kind: 'value', value: await call('agent.create', { profile: nativeProfile }) }
        }
      ).catch((error) => ({
        code: error.code ?? 'agent_failed',
        message: error.message ?? 'Native Agent profile failed'
      }))
      creating.set(key, task)
      try {
        return await task
      } finally {
        creating.delete(key)
      }
    }
  )
}
