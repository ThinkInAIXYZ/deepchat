import { expect, it } from 'vitest'
import { createConnection } from 'node:net'
import { DimProductGateway } from '@/agent/dim/productGateway'

function request(address: string, value: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(address)
    let response = ''
    socket.once('connect', () => socket.write(JSON.stringify(value) + '\n'))
    socket.on('data', (data) => {
      response += data.toString()
    })
    socket.once('end', () => {
      socket.destroy()
      resolve(JSON.parse(response))
    })
    socket.once('error', reject)
  })
}

it('rejects stale catalogs, unknown tools and missing execution identity before a product side effect', async () => {
  let executions = 0
  const gateway = new DimProductGateway({
    resolve: async (id) => {
      if (id !== 'native') throw new Error('Unknown native session')
      return {
        version: 'current',
        tools: [
          {
            name: 'product',
            description: '',
            source: 'extension',
            risk: 'session',
            inputSchema: { type: 'object' }
          }
        ],
        execute: async () => {
          executions++
          return { content: 'ok' }
        }
      }
    }
  })
  const address = await gateway.start()
  const call = {
    kind: 'execute',
    sessionId: 'native',
    branchId: 'main',
    turnId: 'turn',
    callId: 'call',
    name: 'product',
    version: 'current',
    arguments: {}
  }
  try {
    expect(await request(address, { ...call, version: 'old' })).toMatchObject({
      error: expect.stringContaining('replaced')
    })
    expect(await request(address, { ...call, name: 'removed' })).toMatchObject({
      error: expect.stringContaining('authorized')
    })
    expect(await request(address, { ...call, turnId: '' })).toMatchObject({
      error: expect.stringContaining('identity')
    })
    expect(await request(address, { ...call, sessionId: 'other' })).toEqual({
      error: 'Unknown native session'
    })
    expect(executions).toBe(0)
    expect(await request(address, call)).toEqual({ result: { content: 'ok' } })
    expect(executions).toBe(1)
  } finally {
    await gateway.stop()
  }
})

it('aborts an in-flight product invocation on disconnect without retrying it', async () => {
  let aborted = false
  let executions = 0
  const gateway = new DimProductGateway({
    resolve: async () => ({
      version: 'current',
      tools: [
        {
          name: 'product',
          description: '',
          source: 'extension',
          risk: 'session',
          inputSchema: { type: 'object' }
        }
      ],
      execute: async (_, signal) => {
        executions++
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              resolve()
            },
            { once: true }
          )
        )
        return { content: 'cancelled' }
      }
    })
  })
  const address = await gateway.start()
  const socket = createConnection(address)
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    socket.write(
      JSON.stringify({
        kind: 'execute',
        sessionId: 'native',
        branchId: 'main',
        turnId: 'turn',
        callId: 'call',
        name: 'product',
        version: 'current',
        arguments: {}
      }) + '\n'
    )
    await expect.poll(() => executions).toBe(1)
    socket.destroy()
    await expect.poll(() => aborted).toBe(true)
    expect(executions).toBe(1)
  } finally {
    socket.destroy()
    await gateway.stop()
  }
})
