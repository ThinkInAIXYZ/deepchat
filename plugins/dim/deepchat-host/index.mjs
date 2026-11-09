import { definePlugin } from '@arcships/rutis'

// This part contributes product methods; dim's sessions service remains the execution owner.
export default definePlugin({
  name: 'DeepChatHost',
  inject: ['managementMethods', 'sessions'],
  async apply(ctx) {
    const sessions = ctx.use('sessions')
    const operations = {
      launch: (params) => sessions.launch(params),
      input: (params) => sessions.input(params),
      lookup: (params) => sessions.lookup(params),
      stop: (params) => sessions.stop(params),
      idle: (params) => sessions.idle(params),
      withdraw: (params) => sessions.withdraw(params)
    }
    await ctx.use('managementMethods').register(
      'deepchat.host',
      [
        {
          name: 'deepchat.host.capabilities',
          mutating: false,
          interruption: 'report',
          progress: false
        },
        ...Object.keys(operations).map((name) => ({
          name: `deepchat.host.${name}`,
          mutating: !['lookup', 'idle'].includes(name),
          interruption: 'report',
          progress: false
        }))
      ],
      async ({ method, params }) => {
        if (method === 'deepchat.host.capabilities') {
          return {
            kind: 'value',
            value: { plugin: 'deepchat-host', apiVersion: 1, operations: Object.keys(operations) }
          }
        }
        const operation = operations[method.slice('deepchat.host.'.length)]
        if (!operation)
          return { code: 'unknown_method', message: 'Unknown DeepChat host operation' }
        const reply = await operation(params)
        if (!reply.ok) return { code: reply.error.code, message: reply.error.message }
        return { kind: 'value', value: reply.value }
      }
    )
  }
})
