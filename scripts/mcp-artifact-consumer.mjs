import { createServer } from 'node:http'
import { McpClient, createManagedMcpStdio } from '@deepchat/mcp'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function fixture() {
  const records = new Map()
  let confirmTermination = false
  const host = {
    identity: { name: 'artifact-fixture-host', version: '1' },
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
            return confirmTermination
          }
        },
        clearLaunch: (id) => records.delete(id)
      })
  }
  const runtime = {
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
  return {
    client: (config) =>
      new McpClient('artifact-fixture', config, null, null, undefined, undefined, runtime, () => {}, () => {}, host),
    records,
    confirm: () => {
      confirmTermination = true
    }
  }
}

async function assertStdioTransport() {
  const { client, records, confirm } = fixture()
  const connection = client({
    type: 'stdio',
    forceLegacyWire: true,
    command: process.execPath,
    args: ['fixture-server.mjs'],
    inheritEnv: 'minimal',
    env: { MCP_FIXTURE_VALUE: 'artifact-value' }
  })
  try {
    await connection.connect({ waitForConnection: true })
    assert(records.size === 1, 'stdio launch was not recorded')
    assert((await connection.listTools())[0]?.name === 'echo', 'stdio tool discovery failed')
    const result = await connection.callTool('echo', {})
    assert(result.content?.[0]?.text === 'artifact-value', 'stdio tool response failed')
    const abort = new AbortController()
    abort.abort()
    await connection.callTool('echo', {}, { signal: abort.signal }).then(
      () => {
        throw new Error('aborted stdio request unexpectedly resolved')
      },
      () => {}
    )
    await connection.disconnect()
    assert(records.size === 1, 'unconfirmed stdio record was cleared')
    confirm()
    assert(await connection.forceTerminateStdioProcessTree('artifact cleanup'), 'stdio cleanup was not confirmed')
    assert(records.size === 0, 'stdio cleanup record was retained')
  } finally {
    confirm()
    await connection.disconnect()
    await connection.forceTerminateStdioProcessTree('artifact final cleanup')
  }
}

async function assertHttpTransport() {
  const seen = []
  const server = createServer(async (request, response) => {
    seen.push(request.headers.authorization ?? '')
    if (request.method !== 'POST') return response.writeHead(405).end()
    let body = ''
    for await (const chunk of request) body += chunk
    const message = JSON.parse(body)
    if (message.id === undefined) return response.writeHead(202).end()
    const result =
      message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'http-fixture', version: '1' } }
        : {}
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const connection = fixture().client({
    type: 'http',
    forceLegacyWire: true,
    baseUrl: `http://127.0.0.1:${port}/mcp`,
    customHeaders: { Authorization: 'Bearer artifact-only' }
  })
  try {
    await connection.connect({ waitForConnection: true })
    assert(connection.isServerRunning(), 'HTTP connection did not start')
    assert(seen.includes('Bearer artifact-only'), 'HTTP Bearer header was not sent')
  } finally {
    await connection.disconnect()
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

await assertStdioTransport()
await assertHttpTransport()
console.log('MCP isolated artifact transport fixture passed')
