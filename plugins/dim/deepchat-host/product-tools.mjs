import { createConnection } from 'node:net'
import { definePlugin } from '@arcships/rutis'

const MAX_FRAME = 16 * 1024 * 1024

// One capability invocation per connection. Cancellation/connection loss ends that invocation;
// nothing retries a product side effect. This socket carries no model request or agent loop.
function request(address, payload, cancelled) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(address)
    let buffer = Buffer.alloc(0)
    let settled = false
    const settle = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(connecting)
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    const connecting = setTimeout(
      () => settle(new Error('DeepChat capability connection timed out')),
      5000
    )
    socket.once('connect', () => {
      clearTimeout(connecting)
      try {
        const frame = JSON.stringify(payload) + '\n'
        if (Buffer.byteLength(frame) > MAX_FRAME)
          throw new Error('Product tool input exceeds frame limit')
        socket.write(frame)
      } catch (error) {
        settle(error)
      }
    })
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])
      if (buffer.length > MAX_FRAME)
        return settle(new Error('Product tool result exceeds frame limit'))
      const end = buffer.indexOf(10)
      if (end < 0) return
      try {
        const reply = JSON.parse(buffer.subarray(0, end).toString('utf8'))
        if (typeof reply.error === 'string') settle(new Error(reply.error))
        else if ('result' in reply) settle(null, reply.result)
        else settle(new Error('Invalid product capability response'))
      } catch (error) {
        settle(error)
      }
    })
    socket.once('error', (error) => settle(error))
    socket.once('close', () =>
      settle(new Error('DeepChat capability connection ended; outcome is unknown'))
    )
    if (cancelled)
      void cancelled.then(
        () => {
          if (!settled) socket.write('{"kind":"cancel"}\n')
        },
        () => {
          if (!settled) socket.write('{"kind":"cancel"}\n')
        }
      )
  })
}

export async function registerProductTools(root, address) {
  const source = definePlugin({
    name: 'DeepChatProductCatalog',
    inject: ['sessionIdentity', 'sessionMethods'],
    provides: { deepchatProductCatalog: { snapshot: 'async', mounted: 'async' } },
    async apply(ctx) {
      const { sessionId } = await ctx.use('sessionIdentity').get()
      let dispose
      let generation = 0
      let ready
      let refreshing = Promise.resolve()
      const mount = async () => {
        const catalog = await request(address, { kind: 'catalog', sessionId })
        const current = ++generation
        let finish
        const mounted = new Promise((resolve) => {
          finish = resolve
        })
        // Withdrawing a scoped service unloads its dependent tool part. Replacing it lets dim
        // unregister the old definitions before registering the new schemas and handlers.
        if (dispose) await dispose()
        ready?.()
        ready = finish
        dispose = ctx.provide('deepchatProductCatalog', {
          async snapshot() {
            return { ...catalog, generation: current }
          },
          async mounted(value) {
            if (value === current) finish()
          }
        })
        await Promise.race([
          mounted,
          new Promise((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error('DeepChat tool part did not become ready')),
              10000
            )
            void mounted.then(() => clearTimeout(timer))
          })
        ])
        return { version: catalog.version, count: catalog.tools.length }
      }
      // Publishing the scoped service during apply is enough; dependent part readiness cannot
      // hold this part's apply open, because the host first has to publish its provided service.
      const catalog = await request(address, { kind: 'catalog', sessionId })
      dispose = ctx.provide('deepchatProductCatalog', {
        async snapshot() {
          return { ...catalog, generation: 0 }
        },
        async mounted() {}
      })
      ctx.effect(() => {
        ready?.()
      })
      await ctx.use('sessionMethods').register(
        'session.deepchat_tools',
        [
          {
            name: 'session.deepchat_tools.refresh',
            mutating: true,
            interruption: 'report',
            progress: false
          }
        ],
        async () => {
          const updated = refreshing.catch(() => {}).then(mount)
          refreshing = updated
          return { kind: 'value', value: await updated }
        }
      )
    }
  })
  const tools = definePlugin({
    name: 'DeepChatProductTools',
    inject: ['deepchatProductCatalog', 'toolRegistry'],
    async apply(ctx) {
      const source = ctx.use('deepchatProductCatalog')
      const catalog = await source.snapshot()
      const registry = ctx.use('toolRegistry')
      const ended = new Promise((resolve) =>
        ctx.signal.addEventListener('abort', resolve, { once: true })
      )
      for (const tool of catalog.tools) {
        await registry.register(tool, async (call, cancelled) => {
          try {
            return await request(
              address,
              {
                kind: 'execute',
                version: catalog.version,
                name: tool.name,
                sessionId: call.sessionId,
                branchId: call.branchId,
                turnId: call.turnId,
                callId: call.callId,
                arguments: call.arguments
              },
              Promise.race([cancelled, ended])
            )
          } catch (error) {
            return {
              content: String(error instanceof Error ? error.message : error),
              isError: true
            }
          }
        })
      }
      await source.mounted(catalog.generation)
    }
  })
  await root.use('partRegistry').registerDefinition('session', 'DeepChatProductCatalog', source)
  await root.use('partRegistry').registerDefinition('session', 'DeepChatProductTools', tools)
}
