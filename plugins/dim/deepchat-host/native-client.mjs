import { createConnection } from 'node:net'

// The release exposes some owner commands as protected-local management methods.
// Each caller supplies a fixed allowlist; no method name from a desktop payload is relayed.
export async function withNativeClient(address, { profile, methods, timeoutMs = 30000 }, work) {
  const socket = createConnection(address)
  let nextId = 0
  let buffer = Buffer.alloc(0)
  const pending = new Map()
  const close = () => {
    for (const call of pending.values()) {
      clearTimeout(call.timer)
      call.reject(new Error('Native provider connection ended'))
    }
    pending.clear()
    socket.destroy()
  }
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      if (method !== 'hello' && !methods.includes(method))
        return reject(new Error('Unknown provider operation'))
      const id = ++nextId
      const timer = setTimeout(() => {
        close()
        reject(new Error('Native provider operation timed out'))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data])
    if (buffer.length > 16 * 1024 * 1024) return close()
    let end
    while ((end = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, end).toString('utf8')
      buffer = buffer.subarray(end + 1)
      try {
        const reply = JSON.parse(line, (_key, value, context) =>
          typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)
            ? context.source
            : value
        )
        const task = pending.get(reply.id)
        if (!task) continue
        pending.delete(reply.id)
        clearTimeout(task.timer)
        if (reply.error)
          task.reject(
            Object.assign(new Error(reply.error.message), { code: reply.error.data?.appError })
          )
        else task.resolve(reply.result)
      } catch {
        close()
        return
      }
    }
  })
  socket.on('error', close)
  socket.on('close', close)
  try {
    const hello = await call('hello', {
      protocolVersion: 3,
      clientKind: 'other',
      clientName: 'DeepChat native plugin'
    })
    if (hello.protocolVersion !== 3 || hello.daemonProfile.kind !== profile)
      throw new Error('Invalid native provider host')
    return await work(call)
  } finally {
    close()
  }
}
