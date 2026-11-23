import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'preserves overlapping MCP tool constraints in Gemini and Vertex requests',
  async () => {
    const inputSchema = {
      type: 'object',
      allOf: [
        {
          type: 'object',
          properties: { limit: { type: 'integer', minimum: 1 } },
          required: ['limit']
        },
        {
          type: 'object',
          properties: { limit: { type: 'integer', maximum: 100 } },
          required: ['limit']
        }
      ]
    }
    const description = 'Return a bounded result set'
    const requests: Array<{
      url: string
      tools?: Array<{ functionDeclarations?: Array<{ description?: string }> }>
    }> = []
    const fixture = createServer(async (request, response) => {
      let raw = ''
      for await (const chunk of request) raw += chunk
      if (request.url === '/mcp') {
        if (request.method !== 'POST') return response.writeHead(405).end()
        const { id, method } = JSON.parse(raw)
        if (id === undefined) return response.writeHead(202).end()
        const result =
          method === 'initialize'
            ? {
                protocolVersion: '2025-03-26',
                capabilities: { tools: {} },
                serverInfo: { name: 'tool-schema-fixture', version: '1' }
              }
            : { tools: [{ name: 'bounded_search', description, inputSchema }] }
        return response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id, result }))
      }
      if (!request.url?.includes(':streamGenerateContent')) return response.writeHead(404).end()
      requests.push({ url: request.url, tools: JSON.parse(raw).tools })
      const reply = {
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Done' }] }, finishReason: 'STOP' }
        ]
      }
      response
        .writeHead(200, { 'Content-Type': 'text/event-stream' })
        .end(`data: ${JSON.stringify(reply)}\n\n`)
    })
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-tool-schema-'))
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve(process.env.DEEPCHAT_DIM_TEST_RUNTIME_ROOT ?? 'runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        process.platform === 'win32' ? 'node.exe' : 'bin/node'
      ),
      nativePlugins: true
    })
    try {
      await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`
      const client = await host.start()
      const bridge = new DimModelBridge(host)
      for (const endpoint of ['/v1beta', '/v1/publishers/google']) {
        const modelId = 'gemini-2.5-flash'
        const model = await bridge.configure({
          key: `tool-schema-fixture${endpoint}`,
          displayName: 'Tool schema fixture',
          connection: {
            driverKind: 'gemini',
            baseUrl: `${base}${endpoint}`,
            auth: { type: 'anonymous' }
          },
          model: {
            modelId,
            displayName: modelId,
            status: 'active',
            capabilities: {
              modalities: ['text'],
              toolCalling: true,
              streaming: true,
              structuredOutput: false,
              vision: false,
              audio: false,
              reasoning: false,
              contextWindow: 32768,
              maxOutputTokens: 1024
            }
          }
        })
        const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
          cwd: profile,
          model: { ...model },
          policy: { preset: 'full-access', allowedTools: [], disallowedTools: [] }
        })
        await client.call('session.mcp_temporary.attach', {
          sessionId,
          bindingId: randomUUID(),
          servers: { schema: { type: 'http', url: `${base}/mcp`, headers: {} } }
        })
        const ref = { sessionId, branchId: 'main' }
        const before = requests.length
        await client.call('deepchat.host.input', {
          ...ref,
          mode: 'queue',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text: 'Search with a bounded limit' }]
        })
        await client.call('deepchat.host.idle', ref)
        const captured = requests.slice(before).find(({ tools }) => tools?.length)
        expect(captured?.url).toContain(`${endpoint}/models/${modelId}:streamGenerateContent`)
        const declaration = captured?.tools
          ?.flatMap((tool) => tool.functionDeclarations ?? [])
          .find((tool) => tool.description === description)
        expect(declaration).toHaveProperty('parametersJsonSchema', inputSchema)
        expect(declaration).not.toHaveProperty('parameters')
      }
    } finally {
      await host.stop()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)
