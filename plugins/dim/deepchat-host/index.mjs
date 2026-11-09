import { randomUUID } from 'node:crypto'
import { definePlugin } from '@arcships/rutis'
import { registerSessionControls } from './session-controls.mjs'
import { registerAgentProfiles } from './agent-profiles.mjs'
import { withNativeClient } from './native-client.mjs'

export default definePlugin({
  name: 'DeepChatHost',
  inject: ['managementMethods', 'sessions', 'partRegistry', 'callChannel'],
  async apply(ctx, config) {
    const sessions = ctx.use('sessions')
    const channel = ctx.use('callChannel')
    const watches = new Map()
    const connections = new Set()
    ctx.effect(() => {
      watches.clear()
      connections.clear()
    })

    // Delivery is an observer of committed facts, never an execution loop. A slow desktop must
    // resynchronize from storage instead of retaining an unbounded notification backlog.
    const observer = definePlugin({
      name: 'DeepChatDesktopEvents',
      inject: ['dispatcher', 'timelineIdentity'],
      async apply(branch) {
        const identity = await branch.use('timelineIdentity').get()
        await branch.use('dispatcher').listen('deepchat-desktop-events', ['*'], (event) => {
          for (const [watchId, watch] of watches) {
            if (watch.sessionId !== identity.sessionId || watch.branchId !== identity.branchId)
              continue
            if (watch.pending >= 64) {
              watches.delete(watchId)
              void channel
                .notify({
                  ...watch.route,
                  method: 'deepchat.host.gap',
                  params: { watchId, ...identity }
                })
                .catch(() => {})
              continue
            }
            watch.pending++
            void channel
              .notify({
                ...watch.route,
                method: 'deepchat.host.event',
                params: { watchId, ...identity, event }
              })
              .catch(() => watches.delete(watchId))
              .finally(() => {
                watch.pending--
              })
          }
        })
      }
    })
    await ctx.use('partRegistry').registerDefinition('branch', 'DeepChatDesktopEvents', observer)
    await registerSessionControls(ctx, config.hostAddress, config.profile)
    await registerAgentProfiles(ctx, config.hostAddress, config.profile)
    const operations = {
      // sessions.launch is intentionally non-interactive (delegation). Desktop sessions use
      // the native client creation command, so ask_user and approvals have a human client.
      launch: async (params) => {
        if (!params || typeof params.cwd !== 'string' || params.starter)
          return {
            ok: false,
            error: { code: 'invalid_params', message: 'Invalid desktop session creation' }
          }
        try {
          const value = await withNativeClient(
            config.hostAddress,
            { profile: config.profile, methods: ['session.create'] },
            (call) =>
              call('session.create', {
                cwd: params.cwd,
                ...(params.agent ? { agentId: params.agent } : {}),
                ...(params.model
                  ? { model: { provider: params.model.providerId, modelId: params.model.modelId } }
                  : {}),
                ...(params.modelFromSession ? { modelFromSession: params.modelFromSession } : {}),
                ...(params.tools ? { tools: params.tools } : {}),
                ...(params.policy ? { permissionPolicy: params.policy } : {}),
                interactive: true
              })
          )
          return { ok: true, value }
        } catch (error) {
          return {
            ok: false,
            error: {
              code: error.code ?? 'session_creation_failed',
              message: error.message ?? 'Native session creation failed'
            }
          }
        }
      },
      input: (params) => sessions.input(params),
      lookup: (params) => sessions.lookup(params),
      stop: (params) => sessions.stop(params),
      idle: (params) => sessions.idle(params),
      withdraw: (params) => sessions.withdraw(params),
      delete: (params) => sessions.delete(params)
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
        {
          name: 'deepchat.host.subscribe',
          mutating: false,
          interruption: 'report',
          progress: false,
          notifications: ['deepchat.host.event', 'deepchat.host.gap']
        },
        {
          name: 'deepchat.host.unsubscribe',
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
      async (call) => {
        const { method, params } = call
        if (method === 'deepchat.host.capabilities') {
          return {
            kind: 'value',
            value: {
              plugin: 'deepchat-host',
              apiVersion: 1,
              operations: [...Object.keys(operations), 'subscribe', 'unsubscribe']
            }
          }
        }
        if (method === 'deepchat.host.subscribe') {
          if (
            !call.origin?.connectionId ||
            !params ||
            typeof params.sessionId !== 'string' ||
            typeof params.branchId !== 'string'
          ) {
            return {
              code: 'invalid_params',
              message: 'Subscription requires a local connection and session/branch identity'
            }
          }
          // Read through dim's owner before granting a watch. This also acquires/restores a cold Session.
          const result = await sessions.history({
            sessionId: params.sessionId,
            branchId: params.branchId,
            limit: 1
          })
          if (!result.ok) return { code: result.error.code, message: result.error.message }
          const watchId = randomUUID()
          if (watches.size >= 1024)
            return { code: 'capacity', message: 'Too many desktop subscriptions' }
          const route = { connectionId: call.origin.connectionId, callId: call.callId }
          watches.set(watchId, {
            sessionId: params.sessionId,
            branchId: params.branchId,
            route,
            pending: 0
          })
          if (!connections.has(route.connectionId)) {
            connections.add(route.connectionId)
            const ended = () => {
              connections.delete(route.connectionId)
              for (const [id, watch] of watches)
                if (watch.route.connectionId === route.connectionId) watches.delete(id)
            }
            void channel.closed({ connectionId: route.connectionId }).then(ended, ended)
          }
          return { kind: 'value', value: { watchId } }
        }
        if (method === 'deepchat.host.unsubscribe') {
          const watch = watches.get(params?.watchId)
          if (watch && watch.route.connectionId === call.origin?.connectionId)
            watches.delete(params.watchId)
          return { kind: 'value', value: {} }
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
