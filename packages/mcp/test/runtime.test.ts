import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  McpClient,
  createManagedMcpStdio,
  type McpClientHost,
  type McpClientRuntime
} from '../dist/index.js'

function fixture() {
  const records = new Map<string, number>()
  let confirmTermination = false
  const host: McpClientHost = {
    identity: { name: 'fixture-host', version: '1' },
    home: process.cwd(),
    initializeRuntimes() {},
    expandPath: (value) => value,
    rewriteCommand: (command, args) => ({ command, args }),
    runtimeRoot: () => process.cwd(),
    resolvedBinDirs: () => [],
    getDefaultPaths: () => [],
    getPathEntriesFromEnv: () => [],
    setPathEntriesOnEnv() {},
    awaitWithAbort: async (promise, signal) => {
      signal?.throwIfAborted()
      return promise
    },
    createStdio: (params, recordId) =>
      createManagedMcpStdio(params, recordId, {
        recordLaunch: ({ recordId, pid }) => records.set(recordId, pid),
        terminateTree: async (pid) => {
          try {
            process.kill(pid, 0)
            return false
          } catch {
            /* The fixture has exited. */
          }
          return confirmTermination
        },
        clearLaunch: (id) => {
          records.delete(id)
        }
      })
  }
  const runtime: McpClientRuntime = {
    sampling: {
      handleSamplingRequest: async () => {
        throw new Error('Sampling unavailable')
      },
      cancelSamplingRequest() {}
    },
    elicitation: {
      handleElicitationRequest: async () => {
        throw new Error('Elicitation unavailable')
      },
      cancelElicitationRequest() {}
    },
    completion: {
      generateCompletionStandalone: async () => {
        throw new Error('Completion unavailable')
      }
    },
    config: { getProviderModels: () => [], getCustomModels: () => [] }
  }
  const client = (config: Record<string, unknown>) =>
    new McpClient(
      'fixture',
      config,
      null,
      null,
      undefined,
      undefined,
      runtime,
      () => {},
      () => {},
      host
    )
  return {
    client,
    records,
    confirm: () => {
      confirmTermination = true
    }
  }
}

describe('portable MCP artifact', () => {
  it('records a real child before a failed handshake and retains recovery ownership', async () => {
    const { client, records, confirm } = fixture()
    const connection = client({
      type: 'stdio',
      forceLegacyWire: true,
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
      inheritEnv: 'minimal'
    })
    try {
      await expect(connection.connect({ waitForConnection: true })).rejects.toThrow()
      expect(records.size).toBe(1)
      confirm()
      expect(await connection.forceTerminateStdioProcessTree('failed fixture cleanup')).toBe(true)
      expect(records.size).toBe(0)
    } finally {
      confirm()
      await connection.disconnect()
      await connection.forceTerminateStdioProcessTree('failed fixture final cleanup')
    }
  })
  it('runs a real bounded stdio session and retains unconfirmed recovery records', async () => {
    const { client, records, confirm } = fixture()
    const connection = client({
      type: 'stdio',
      forceLegacyWire: true,
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixture-server.mjs', import.meta.url))],
      inheritEnv: 'minimal',
      env: { MCP_FIXTURE_VALUE: 'fixture-value' }
    })
    try {
      await connection.connect({ waitForConnection: true })
      expect(records.size).toBe(1)
      expect((await connection.listTools())[0].name).toBe('echo')
      expect(await connection.callTool('echo', {})).toMatchObject({
        content: [{ text: 'fixture-value' }]
      })
      const abort = new AbortController()
      abort.abort()
      await expect(connection.callTool('echo', {}, { signal: abort.signal })).rejects.toThrow()
      await connection.disconnect()
      expect(records.size).toBe(1)
      confirm()
      expect(await connection.forceTerminateStdioProcessTree('fixture cleanup')).toBe(true)
      expect(records.size).toBe(0)
    } finally {
      confirm()
      await connection.disconnect()
      await connection.forceTerminateStdioProcessTree('fixture final cleanup')
    }
  })

  it('uses a real HTTP endpoint and preserves configured Bearer headers', async () => {
    const seen: string[] = []
    const server = createServer(async (request, response) => {
      seen.push(request.headers.authorization ?? '')
      if (request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }
      let body = ''
      for await (const chunk of request) body += chunk
      const message = JSON.parse(body)
      if (message.id === undefined) {
        response.writeHead(202).end()
        return
      }
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2025-03-26',
              capabilities: {},
              serverInfo: { name: 'http-fixture', version: '1' }
            }
          : {}
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    const connection = fixture().client({
      type: 'http',
      forceLegacyWire: true,
      baseUrl: `http://127.0.0.1:${address.port}/mcp`,
      customHeaders: { Authorization: 'Bearer fixture-only' }
    })
    try {
      await connection.connect({ waitForConnection: true })
      expect(connection.isServerRunning()).toBe(true)
      expect(seen).toContain('Bearer fixture-only')
    } finally {
      await connection.disconnect()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })
})
