import { withNativeClient } from './native-client.mjs'

const OPERATIONS = {
  queue: ['session.input.pending', false],
  withdraw: ['session.input.withdraw', true],
  permission: ['session.permission.get', false],
  set_permission: ['session.permission.update', true],
  set_model: ['session.model.update', true],
  set_agent: ['session.agent.update', true],
  agent: ['session.agent.get', false],
  refresh_prompt: ['session.prompt.refresh', true],
  context: ['session.context.usage', false],
  compact: ['session.context.compact', true],
  questions: ['session.question.pending', false],
  answer: ['session.question.respond', true],
  approval: ['approval.respond', true],
  fork: ['session.fork', true],
  rename: ['session.rename', true],
  close: ['session.close', true]
}

export async function registerSessionControls(ctx, address, profile) {
  await ctx.use('managementMethods').register(
    'deepchat.session',
    Object.entries(OPERATIONS).map(([name, [, mutating]]) => ({
      name: `deepchat.session.${name}`,
      mutating,
      interruption: 'report',
      progress: false
    })),
    async ({ method, params }) => {
      const operation = OPERATIONS[method.slice('deepchat.session.'.length)]
      if (!operation) return { code: 'unknown_method', message: 'Unknown native session operation' }
      if (!params || typeof params.sessionId !== 'string' || !params.sessionId)
        return { code: 'invalid_params', message: 'Native session identity is required' }
      try {
        const request = { ...params }
        // These protocol-v3 owner commands require JSON safe integers (unlike the u64 service
        // cursors used by storage.history). Never round a persisted decimal cursor to fit them.
        for (const key of ['at', 'expectedVersion', 'through']) {
          if (typeof request[key] !== 'string') continue
          if (!/^\d+$/.test(request[key]) || !Number.isSafeInteger(Number(request[key])))
            return {
              code: 'invalid_params',
              message: 'Cursor exceeds the native command integer range'
            }
          request[key] = Number(request[key])
        }
        return {
          kind: 'value',
          value: await withNativeClient(
            address,
            {
              profile,
              methods: [operation[0]],
              timeoutMs: operation[0] === 'session.context.compact' ? 1800000 : 30000
            },
            (call) => call(operation[0], request)
          )
        }
      } catch (error) {
        return {
          code: error.code ?? 'native_session_failed',
          message: `${operation[0]}: ${error.message ?? 'Native session operation failed'}`
        }
      }
    }
  )
}
