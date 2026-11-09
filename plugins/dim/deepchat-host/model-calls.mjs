import { withNativeClient } from './native-client.mjs'
import { createHash } from 'node:crypto'
import { definePlugin } from '@arcships/rutis'

// alpha.21 exposes model execution as a service, and provider editing as native management
// methods. Keep that small configuration boundary here; never delegate a model call to desktop.

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    )
  return value
}

function providerId(config) {
  // Each connection/model configuration is immutable. Reuse it on restart; changing credentials
  // never silently repoints a provider used by an existing native Session. Only the native owner
  // stores credentials; this digest and the in-memory admission map contain no plaintext secret.
  const bytes = createHash('sha256')
    .update('deepchat/provider/v1\0')
    .update(JSON.stringify(canonical(config)))
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export default definePlugin({
  name: 'DeepChatModel',
  inject: ['managementMethods', 'auxiliaryModel', 'callChannel'],
  async apply(ctx, config) {
    const auxiliary = ctx.use('auxiliaryModel')
    const admitted = new Set()
    const configuring = new Map()
    const configure = async (params) => {
      if (!params || typeof params.key !== 'string' || !params.connection || !params.model?.modelId)
        throw new Error('Invalid product model configuration')
      const id = providerId(params)
      if (admitted.has(id)) return { providerId: id, modelId: params.model.modelId }
      if (configuring.has(id)) return configuring.get(id)
      if (configuring.size >= 64) throw new Error('Too many model configurations in progress')
      const task = withNativeClient(
        config.hostAddress,
        { profile: 'product', methods: ['provider.management', 'provider.create'] },
        async (call) => {
          const view = await call('provider.management', { providerId: id }).catch((error) => {
            if (error.code !== 'provider_not_found') throw error
            return { providers: [], errors: [] }
          })
          if (view.errors.length) throw new Error('Native provider configuration cannot be read')
          const existing = view.providers.find((provider) => provider.providerId === id)
          if (!existing) {
            await call('provider.create', {
              providerId: id,
              displayName: params.displayName,
              connection: params.connection,
              models: [params.model],
              enabled: true
            })
          } else if (
            existing.credentialAuthority !== 'static' ||
            !existing.enabled ||
            existing.connection?.driverKind !== params.connection.driverKind ||
            existing.connection?.baseUrl !== params.connection.baseUrl ||
            !existing.models?.some((item) => item.model.modelId === params.model.modelId)
          ) {
            throw new Error('Native product provider identity has conflicting configuration')
          }
          admitted.add(id)
          return { providerId: id, modelId: params.model.modelId }
        }
      )
      configuring.set(id, task)
      try {
        return await task
      } finally {
        configuring.delete(id)
      }
    }
    await ctx.use('managementMethods').register(
      'deepchat.model',
      [
        {
          name: 'deepchat.model.capabilities',
          mutating: false,
          interruption: 'report',
          progress: false
        },
        {
          name: 'deepchat.model.configure',
          mutating: true,
          interruption: 'drain',
          progress: false
        },
        {
          name: 'deepchat.model.complete',
          mutating: false,
          interruption: 'report',
          progress: false
        }
      ],
      async (call, cancelled) => {
        if (call.method === 'deepchat.model.capabilities')
          return { kind: 'value', value: { plugin: 'deepchat-model', apiVersion: 1 } }
        try {
          if (call.method === 'deepchat.model.configure')
            return { kind: 'value', value: await configure(call.params) }
          const closed = call.origin?.connectionId
            ? ctx.use('callChannel').closed({ connectionId: call.origin.connectionId })
            : new Promise(() => {})
          return {
            kind: 'value',
            value: await auxiliary.complete(call.params, () => Promise.race([cancelled, closed]))
          }
        } catch (error) {
          return {
            code: error.code ?? 'model_failed',
            message: error.message ?? 'Native model request failed'
          }
        }
      }
    )
  }
})
