import { expect, it } from 'vitest'
import { createConnection } from 'node:net'
import { DimProductGateway } from '@/agent/dim/productGateway'

it('admits declared hook configuration only for a valid current native owner', async () => {
  let reads = 0
  const gateway = new DimProductGateway({
    resolve: async () => {
      throw new Error('Hook configuration cannot execute tools')
    },
    pluginHooks: async (query, signal) => {
      reads++
      signal.throwIfAborted()
      if (query.sessionId !== 'current') throw new Error('Hook owner was replaced')
      return [
        { pluginId: 'fixture', digest: 'revision', root: '/plugin', data: '/data', hooks: [] }
      ]
    }
  })
  const address = await gateway.start()
  try {
    for (const query of [
      { sessionId: '', event: 'SessionStart', matcher: 'startup' },
      { sessionId: 'current', event: 'PermissionRequest', matcher: '' },
      { sessionId: 'current', event: 'SubagentStart', matcher: 'x'.repeat(4097) }
    ])
      expect(await request(address, { kind: 'plugin_hooks', ...query })).toMatchObject({
        error: expect.any(String)
      })
    expect(reads).toBe(0)
    expect(
      await request(address, {
        kind: 'plugin_hooks',
        sessionId: 'replaced',
        event: 'SessionStart',
        matcher: 'resume'
      })
    ).toEqual({ error: 'Hook owner was replaced' })
    expect(
      await request(address, {
        kind: 'plugin_hooks',
        sessionId: 'current',
        event: 'SessionStart',
        matcher: 'startup'
      })
    ).toMatchObject({ result: { sources: [{ pluginId: 'fixture', digest: 'revision' }] } })
  } finally {
    await gateway.stop()
  }
})

it('returns an optional title model selection without executing an inference request', async () => {
  let reads = 0
  const gateway = new DimProductGateway({
    resolve: async () => {
      throw new Error('Title preferences must not execute a product tool')
    },
    titleModel: async (id, signal) => {
      signal.throwIfAborted()
      reads++
      if (id === 'default') return null
      if (id !== 'bound') throw new Error('Title preference has no current owner')
      return { providerId: 'native-provider', modelId: 'assistant' }
    }
  })
  const address = await gateway.start()
  try {
    expect(await request(address, { kind: 'title_model', sessionId: '' })).toMatchObject({
      error: expect.any(String)
    })
    expect(reads).toBe(0)
    expect(await request(address, { kind: 'title_model', sessionId: 'foreign' })).toMatchObject({
      error: expect.stringContaining('current owner')
    })
    expect(await request(address, { kind: 'title_model', sessionId: 'default' })).toEqual({
      result: null
    })
    expect(await request(address, { kind: 'title_model', sessionId: 'bound' })).toEqual({
      result: { providerId: 'native-provider', modelId: 'assistant' }
    })
  } finally {
    await gateway.stop()
  }
})

it('resolves MCP configuration only for an authorized native owner', async () => {
  let reads = 0
  const gateway = new DimProductGateway({
    resolve: async () => {
      throw new Error('MCP configuration must not execute a product tool')
    },
    mcp: async (id, signal) => {
      signal.throwIfAborted()
      reads++
      if (id !== 'authorized-child') throw new Error('Unknown native owner')
      return { fixture: { type: 'http', url: 'https://example.test/mcp', headers: {} } }
    }
  })
  const address = await gateway.start()
  try {
    expect(await request(address, { kind: 'mcp', sessionId: '' })).toMatchObject({
      error: expect.any(String)
    })
    expect(reads).toBe(0)
    expect(await request(address, { kind: 'mcp', sessionId: 'foreign' })).toEqual({
      error: 'Unknown native owner'
    })
    expect(await request(address, { kind: 'mcp', sessionId: 'authorized-child' })).toEqual({
      result: {
        servers: { fixture: { type: 'http', url: 'https://example.test/mcp', headers: {} } }
      }
    })
  } finally {
    await gateway.stop()
  }
})

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

it('authorizes credential references separately and redacts owner failures', async () => {
  const gateway = new DimProductGateway({
    resolve: async () => {
      throw new Error('No session catalog expected')
    },
    credential: async (providerId, reference) => {
      if (providerId === 'admitted' && reference === 'known') return 'fixture-credential'
      throw new Error('Owner error containing fixture-credential')
    }
  })
  try {
    const address = await gateway.start()
    expect(
      await request(address, { kind: 'credential', providerId: 'other', reference: 'known' })
    ).toEqual({ error: 'Credential reference is unavailable' })
    expect(
      await request(address, { kind: 'credential', providerId: 'admitted', reference: 'known' })
    ).toEqual({ result: 'fixture-credential' })
  } finally {
    await gateway.stop()
  }
})

it('validates native context identities and full u64 positions before reading desktop context', async () => {
  let reads = 0
  const gateway = new DimProductGateway({
    resolve: async () => {
      throw new Error('Context does not resolve a tool catalog')
    },
    context: async (input) => {
      if (input.sessionId !== 'native') throw new Error('Unknown native session')
      reads++
      return {
        messages: [{ role: 'user', content: `context at ${input.through}` }],
        receipts: [{ source: 'fixture' }]
      }
    }
  })
  const address = await gateway.start()
  const input = {
    kind: 'context',
    sessionId: 'native',
    turnId: 'turn',
    requestId: 'request',
    providerId: 'provider',
    modelId: 'model',
    through: '18446744073709551615',
    query: 'user input'
  }
  try {
    for (const through of ['18446744073709551616', '01', 9007199254740992])
      expect(await request(address, { ...input, through })).toEqual({
        error: 'Invalid native context request'
      })
    expect(await request(address, { ...input, requestId: '' })).toEqual({
      error: 'Invalid native context request'
    })
    expect(reads).toBe(0)
    expect(await request(address, { ...input, sessionId: 'other' })).toEqual({
      error: 'Unknown native session'
    })
    expect(await request(address, input)).toEqual({
      result: {
        messages: [{ role: 'user', content: 'context at 18446744073709551615' }],
        receipts: [{ source: 'fixture' }]
      }
    })
    expect(reads).toBe(1)
  } finally {
    await gateway.stop()
  }
})

it('validates OAuth recovery leases and redacts connection-owner failures', async () => {
  let reads = 0
  const gateway = new DimProductGateway({
    resolve: async () => {
      throw new Error('No product tool expected')
    },
    connectionAuth: async (providerId, modelId, rejectedLease, signal) => {
      signal.throwIfAborted()
      reads++
      if (providerId === 'ordinary') return null
      if (providerId !== 'bound' || modelId !== 'model') throw new Error('private OAuth token')
      expect(rejectedLease).toBe('a'.repeat(64))
      return { preset: 'openai-codex', bearer: 'private OAuth token', lease: 'b'.repeat(64) }
    }
  })
  try {
    const address = await gateway.start()
    for (const rejectedLease of ['', 'wrong', 1])
      expect(
        await request(address, {
          kind: 'model_connection',
          providerId: 'bound',
          modelId: 'model',
          rejectedLease
        })
      ).toEqual({ error: 'Provider connection is unavailable' })
    expect(reads).toBe(0)
    expect(
      await request(address, { kind: 'model_connection', providerId: 'other', modelId: 'model' })
    ).toEqual({ error: 'Provider connection is unavailable' })
    expect(
      await request(address, { kind: 'model_connection', providerId: 'ordinary', modelId: 'model' })
    ).toEqual({ result: null })
    expect(
      await request(address, {
        kind: 'model_connection',
        providerId: 'bound',
        modelId: 'model',
        rejectedLease: 'a'.repeat(64)
      })
    ).toMatchObject({ result: { preset: 'openai-codex', bearer: 'private OAuth token' } })
  } finally {
    await gateway.stop()
  }
})
