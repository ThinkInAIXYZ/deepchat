import { definePlugin } from '@arcships/rutis'

// Reads belong to dim. This plugin never opens its SQLite database or copies its event log.
export default definePlugin({
  name: 'DeepChatStorage',
  inject: ['managementMethods', 'sessions'],
  async apply(ctx) {
    const sessions = ctx.use('sessions')
    await ctx.use('managementMethods').register(
      'deepchat.storage',
      ['capabilities', 'history'].map((name) => ({
        name: `deepchat.storage.${name}`,
        mutating: false,
        interruption: 'report',
        progress: false
      })),
      async ({ method, params }) => {
        if (method === 'deepchat.storage.capabilities') {
          return {
            kind: 'value',
            value: { plugin: 'deepchat-storage', apiVersion: 1, operations: ['history'] }
          }
        }
        let reply
        if (method === 'deepchat.storage.history') {
          if (
            !params ||
            !Number.isSafeInteger(params.limit) ||
            params.limit < 1 ||
            params.limit > 200
          ) {
            return { code: 'invalid_params', message: 'History requires a limit between 1 and 200' }
          }
          reply = await sessions.history(params)
        } else return { code: 'unknown_method', message: 'Unknown DeepChat storage operation' }
        if (!reply.ok) return { code: reply.error.code, message: reply.error.message }
        return { kind: 'value', value: reply.value }
      }
    )
  }
})
