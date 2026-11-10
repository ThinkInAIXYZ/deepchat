import { definePlugin } from '@arcships/rutis'
import { withNativeClient } from '../deepchat-host/native-client.mjs'

// Desktop coordinates cross JSON as decimal strings. The public query owner expects numeric
// sequence operands; convert only this declared field without rounding u64 through Number.
function nativeFilter(filter) {
  if (!filter || typeof filter !== 'object') return filter
  if (filter.op === 'and' || filter.op === 'or')
    return { ...filter, conditions: filter.conditions.map(nativeFilter) }
  if (filter.op === 'not') return { ...filter, condition: nativeFilter(filter.condition) }
  if (
    filter.op === 'compare' &&
    filter.left?.kind === 'field' &&
    filter.left.path === 'position.sequence' &&
    filter.right?.kind === 'value' &&
    typeof filter.right.value === 'string'
  ) {
    if (!/^\d+$/.test(filter.right.value)) throw new Error('Invalid timeline sequence operand')
    const value = BigInt(filter.right.value)
    if (value > 18446744073709551615n) throw new Error('Timeline sequence exceeds u64')
    return { ...filter, right: { ...filter.right, value } }
  }
  return filter
}

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
                query: {
                  ...params.query.query,
                  filter: nativeFilter(params.query.query?.filter)
                },
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
      ['capabilities', 'history', 'scope', 'seed_title', 'readiness'].map((name) => ({
        name: `deepchat.storage.${name}`,
        mutating: name === 'seed_title',
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
              operations: config.rawHistory
                ? ['history', 'scope', 'seed_title', 'readiness']
                : ['history']
            }
          }
        }
        if (
          [
            'deepchat.storage.scope',
            'deepchat.storage.seed_title',
            'deepchat.storage.readiness'
          ].includes(method)
        ) {
          if (!config.rawHistory)
            return { code: 'unsupported', message: 'Native scope owner is unavailable' }
          const operation = method.endsWith('.readiness')
            ? 'deepchat.native_profile.readiness'
            : method.endsWith('.seed_title')
              ? 'deepchat.native_scope.seed_title'
              : 'deepchat.native_scope.describe'
          return {
            kind: 'value',
            value: await withNativeClient(
              config.hostAddress,
              {
                profile: config.profile,
                methods: [operation]
              },
              (call) => call(operation, params)
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
