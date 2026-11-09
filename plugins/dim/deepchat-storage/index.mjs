import { definePlugin } from '@arcships/rutis'
import { withNativeClient } from '../deepchat-host/native-client.mjs'

// Reads belong to dim. This plugin never opens its SQLite database or copies its event log.
export default definePlugin({
  name: 'DeepChatStorage',
  inject: ['managementMethods', 'sessions', 'partRegistry'],
  async apply(ctx, config) {
    const sessions = ctx.use('sessions')
    await ctx.use('partRegistry').registerDefinition(
      'session',
      'DeepChatStorageQueries',
      definePlugin({
        name: 'DeepChatStorageQueries',
        inject: ['sessionMethods', 'treeCommands'],
        async apply(session) {
          const tree = session.use('treeCommands')
          await session.use('sessionMethods').register(
            'session.deepchat_storage',
            [
              {
                name: 'session.deepchat_storage.query',
                mutating: false,
                interruption: 'report',
                progress: false
              },
              {
                name: 'session.deepchat_storage.branches',
                mutating: false,
                interruption: 'report',
                progress: false
              }
            ],
            async ({ method, params }) => {
              if (method.endsWith('.branches')) return { kind: 'value', value: await tree.list() }
              if (!params.query || typeof params.branchId !== 'string')
                return { code: 'invalid_params', message: 'Timeline query requires a branch' }
              const limit = params.query.page?.limit ?? 100
              if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
                return {
                  code: 'invalid_params',
                  message: 'Timeline requires a limit between 1 and 200'
                }
              const query = {
                ...params.query,
                include_publishing: false,
                page: { ...params.query.page, limit }
              }
              if (query.through != null) query.through = BigInt(query.through)
              if (query.from?.sequence != null)
                query.from = { ...query.from, sequence: BigInt(query.from.sequence) }
              return { kind: 'value', value: await tree.query(params.branchId, query) }
            }
          )
        }
      })
    )
    await ctx.use('managementMethods').register(
      'deepchat.storage',
      ['capabilities', 'history', 'scope'].map((name) => ({
        name: `deepchat.storage.${name}`,
        mutating: false,
        interruption: 'report',
        progress: false
      })),
      async ({ method, params }) => {
        if (method === 'deepchat.storage.capabilities') {
          return {
            kind: 'value',
            value: {
              plugin: 'deepchat-storage',
              apiVersion: 1,
              operations: config.rawHistory ? ['history', 'scope'] : ['history']
            }
          }
        }
        if (method === 'deepchat.storage.scope') {
          if (!config.rawHistory)
            return { code: 'unsupported', message: 'Native scope owner is unavailable' }
          return {
            kind: 'value',
            value: await withNativeClient(
              config.hostAddress,
              {
                profile: config.profile,
                methods: ['deepchat.native_scope.describe']
              },
              (call) => call('deepchat.native_scope.describe', params)
            )
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
          const request = { ...params }
          if (config.rawHistory) {
            return {
              kind: 'value',
              value: await withNativeClient(
                config.hostAddress,
                {
                  profile: config.profile,
                  methods: ['deepchat.native_storage.history']
                },
                (call) => call('deepchat.native_storage.history', request)
              )
            }
          }
          for (const key of ['after', 'through', 'atLeast']) {
            if (typeof request[key] === 'string') {
              if (!/^\d+$/.test(request[key]) || BigInt(request[key]) > 18446744073709551615n) {
                return { code: 'invalid_params', message: 'Invalid timeline cursor' }
              }
              request[key] = BigInt(request[key])
            }
          }
          reply = await sessions.history(request)
        } else return { code: 'unknown_method', message: 'Unknown DeepChat storage operation' }
        if (!reply.ok) return { code: reply.error.code, message: reply.error.message }
        return { kind: 'value', value: reply.value }
      }
    )
  }
})
