import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimSessionControls } from '@/agent/dim/sessionControls'
import { DimSessionConnection, type DimEvent } from '@/agent/dim/sessionConnection'
import { DimContent } from '@/agent/dim/content'
import { dimHistoryHash, dimHistoryPlan } from '@/agent/dim/historyImport'
import { DimPluginClient } from '@/agent/dim/pluginClient'
import { DimSessionRuntime } from '@/agent/dim/sessionRuntime'
import { DimScopeTransitions } from '@/agent/dim/scopeTransitions'
import { dimDatabase } from './fixtures/database'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'runs native Code Mode with pinned tools, child permissions and cancellation across restart',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dim-native-code-'))
    const inputFile = path.join(profile, 'input.txt')
    const deniedFile = path.join(profile, 'denied.txt')
    await writeFile(inputFile, 'NATIVE_CODE_READ_RESULT')
    let nextCode: string | undefined
    let mcpCalls = 0
    const requests: Array<{
      tools?: Array<{ function: { name: string } }>
      messages: Array<{ role: string; content: unknown; tool_calls?: unknown[] }>
    }> = []
    const server = createServer(async (request, response) => {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      if (request.url === '/mcp') {
        if (body.id === undefined) {
          response.writeHead(202).end()
          return
        }
        let result: object = {}
        if (body.method === 'initialize')
          result = {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'code-mcp', version: '1' }
          }
        if (body.method === 'tools/list')
          result = {
            tools: [
              {
                name: 'echo',
                description: 'Code Mode native MCP fixture',
                inputSchema: { type: 'object', properties: {} }
              }
            ]
          }
        if (body.method === 'tools/call') {
          mcpCalls++
          result = { content: [{ type: 'text', text: 'NATIVE_CODE_MCP_RESULT' }] }
        }
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
        return
      }
      if (body.tools?.length) requests.push(body)
      const code = body.tools?.some(
        (tool: { function: { name: string } }) => tool.function.name === 'codemode'
      )
        ? nextCode
        : undefined
      if (code) nextCode = undefined
      response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(
        `data: ${JSON.stringify({
          id: 'native-code',
          object: 'chat.completion.chunk',
          model: 'fixture',
          created: 0,
          choices: [
            {
              index: 0,
              delta: code
                ? {
                    role: 'assistant',
                    tool_calls: [
                      {
                        index: 0,
                        id: randomUUID(),
                        type: 'function',
                        function: { name: 'codemode', arguments: JSON.stringify({ code }) }
                      }
                    ]
                  }
                : { role: 'assistant', content: 'Native code complete' },
              finish_reason: code ? 'tool_calls' : 'stop'
            }
          ]
        })}\n\ndata: [DONE]\n\n`
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve(process.env.DEEPCHAT_DIM_TEST_RUNTIME_ROOT ?? 'runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin/node'])
      ),
      nativePlugins: true
    })
    let connection: DimSessionConnection | undefined
    try {
      const model = await new DimModelBridge(host).configure({
        key: 'native-code',
        displayName: 'Native Code Mode fixture',
        connection: {
          driverKind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
          auth: { type: 'anonymous' }
        },
        model: {
          modelId: 'fixture',
          displayName: 'Fixture',
          status: 'active',
          capabilities: {
            modalities: ['text'],
            toolCalling: true,
            streaming: true,
            structuredOutput: false,
            vision: false,
            audio: false,
            reasoning: false,
            contextWindow: 64000,
            maxOutputTokens: 1000
          }
        }
      })
      let client = await host.start()
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        model: { ...model },
        policy: { preset: 'full-access', allowedTools: [], disallowedTools: [] }
      })
      const ref = { sessionId, branchId: 'main' }
      const controls = new DimSessionControls(host)
      const send = async (text: string) => {
        await client.call('deepchat.host.input', {
          ...ref,
          mode: 'queue',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text }]
        })
        await client.call('deepchat.host.idle', ref)
      }
      const mode = (toolMode: string) =>
        controls.call('native_configure', ref, {
          config: {},
          toolMode
        })
      await send('Agent mode')
      expect(requests.at(-1)!.tools!.map((tool) => tool.function.name)).toContain('read')
      expect(requests.at(-1)!.tools!.map((tool) => tool.function.name)).not.toContain('codemode')
      await mode('code')
      const bindingId = randomUUID()
      await client.call('session.mcp_temporary.attach', {
        sessionId,
        bindingId,
        servers: {
          code: {
            type: 'http',
            url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`,
            headers: {}
          }
        }
      })
      const catalog = await client.call<Array<{ name: string; description: string }>>(
        'session.deepchat_tools.catalog',
        ref
      )
      const mcpName = catalog.find((tool) =>
        tool.description.includes('Code Mode native MCP fixture')
      )!.name
      nextCode = `const list = await tools.list();
        if (list.some(t => t.name === 'codemode') || typeof process !== 'undefined') throw Error('unsafe');
        const spec = await tools.describe('read');
        if (!spec) throw Error('missing pinned tool');
        const read = await tools.call('read', {path:${JSON.stringify(inputFile)}});
        const mcp = await tools.call(${JSON.stringify(mcpName)}, {});
        return [read.content, mcp.content];`
      const events: DimEvent[] = []
      connection = new DimSessionConnection(
        client,
        ref,
        (event) => {
          events.push(event)
        },
        (error) => {
          throw error
        }
      )
      await connection.start()
      await send('Run native code')
      await connection.waitIdle()
      const wire = requests.at(-1)!
      expect(wire.tools!.map((tool) => tool.function.name)).toEqual(['codemode'])
      expect(JSON.stringify(wire.messages)).toContain('NATIVE_CODE_READ_RESULT')
      expect(JSON.stringify(wire.messages)).toContain('NATIVE_CODE_MCP_RESULT')
      expect(mcpCalls).toBe(1)
      expect(wire.messages.flatMap((message) => message.tool_calls ?? [])).toHaveLength(1)
      expect(wire.messages.filter((message) => message.role === 'tool')).toHaveLength(1)
      const child = events.find(
        (event) => event.type === 'step' && event.name === 'tool-call' && event.parent_call_id
      )
      expect(child).toBeTruthy()
      expect(child!.data.calls).toMatchObject([{ name: 'read' }])
      expect(
        events.some(
          (event) => event.name === 'tool-result' && event.parent_call_id === child!.parent_call_id
        )
      ).toBe(true)
      const transcript = await new DimContent(host).transcript(ref, 'code-history')
      const restored = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        model: { ...model },
        policy: { preset: 'full-access', allowedTools: [], disallowedTools: [] }
      })
      const restoredRef = { sessionId: restored.sessionId, branchId: 'main' }
      const plan = dimHistoryPlan({
        formatVersion: 1,
        productSessionId: 'code-history',
        messages: transcript.messages,
        summary: null,
        contextText: transcript.contextText
      })
      await client.call('session.deepchat_migration.begin', {
        ...restoredRef,
        migrationId: plan.migrationId,
        manifest: {
          migrationId: plan.migrationId,
          productSessionId: plan.productSessionId,
          digest: plan.digest,
          chunks: plan.chunks.length
        }
      })
      for (const [index, payload] of plan.chunks.entries()) {
        await client.call('session.deepchat_migration.chunk', {
          ...restoredRef,
          migrationId: plan.migrationId,
          index,
          payload,
          checksum: dimHistoryHash(payload)
        })
      }
      await client.call('session.deepchat_migration.commit', {
        ...restoredRef,
        migrationId: plan.migrationId
      })
      await client.call('deepchat.host.input', {
        ...restoredRef,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'Rebuilt history' }]
      })
      await client.call('deepchat.host.idle', restoredRef)
      const historicalCalls = requests
        .at(-1)!
        .messages.flatMap((message) => message.tool_calls ?? [])
      expect(historicalCalls).toHaveLength(1)
      expect(historicalCalls[0]).toMatchObject({ function: { name: 'codemode' } })
      await client.call('session.mcp_temporary.detach', { sessionId, bindingId })
      const policy = await controls.call<{ version: string }>('permission', ref)
      await controls.call('set_permission', ref, {
        expectedVersion: String(policy.version),
        policy: { preset: 'full-access', allowedTools: [], disallowedTools: ['write'] }
      })
      nextCode = `try { await tools.call('write', {path:${JSON.stringify(deniedFile)},content:'denied'});
        return 'UNEXPECTED_WRITE'; } catch (error) {
          try { await tools.call(${JSON.stringify(mcpName)}, {}); return 'UNEXPECTED_MCP'; }
          catch (error) { return 'CHILD_DENIED MCP_REVOKED'; }
        }`
      await send('Deny native child')
      expect(JSON.stringify(requests.at(-1)!.messages)).toContain('CHILD_DENIED')
      expect(JSON.stringify(requests.at(-1)!.messages)).toContain('MCP_REVOKED')
      expect(mcpCalls).toBe(1)
      await expect(readFile(deniedFile)).rejects.toMatchObject({ code: 'ENOENT' })
      const rows = JSON.parse(
        await readFile(path.join(profile, 'dim/deepchat-plugin-rows.json'), 'utf8')
      )
      const legacy = await DimPluginClient.connect(rows[0].config.hostAddress)
      let old: { sessionId: string }
      try {
        await legacy.call('hello', {
          protocolVersion: 3,
          clientKind: 'other',
          clientName: 'Legacy fixture'
        })
        old = await legacy.call('session.create', {
          cwd: profile,
          model: { provider: model.providerId, modelId: model.modelId },
          permissionPolicy: { preset: 'full-access', allowedTools: [], disallowedTools: [] },
          interactive: true
        })
      } finally {
        legacy.close()
      }
      const oldRef = { sessionId: old!.sessionId, branchId: 'main' }
      expect(await controls.call('native_identity', oldRef)).toMatchObject({
        excludedTools: ['codemode']
      })
      await client.call('deepchat.host.input', {
        ...oldRef,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'V3_PRESERVED_HISTORY' }]
      })
      await client.call('deepchat.host.idle', oldRef)
      const database = dimDatabase()
      database.data.dimSessionBindingsTable.bind('legacy-v3', old!.sessionId, 'main', 44)
      const product = new DimSessionRuntime({
        database: database.data,
        host,
        launch: async () => {
          throw new Error('A bound legacy scope must not launch twice')
        },
        projected: () => {},
        failed: (_id, error) => {
          throw error
        }
      })
      try {
        const transitions = new DimScopeTransitions({
          database: database.data,
          host,
          runtime: product,
          installed: () => {}
        })
        const before = requests.length
        const upgraded = await transitions.ensureCreation('legacy-v3', { cwd: profile })
        expect(upgraded.dimSessionId).not.toBe(old!.sessionId)
        expect(upgraded.generation).toBe(2)
        expect(requests).toHaveLength(before)
        expect(await transitions.ensureCreation('legacy-v3', { cwd: profile })).toEqual(upgraded)
        const upgradedRef = { sessionId: upgraded.dimSessionId, branchId: upgraded.branchId }
        await controls.call('native_configure', upgradedRef, { config: {}, toolMode: 'code' })
        nextCode = 'return "UPGRADED_NATIVE_CODE_OK";'
        await client.call('deepchat.host.input', {
          ...upgradedRef,
          mode: 'queue',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text: 'V4_CONTINUATION' }]
        })
        await client.call('deepchat.host.idle', upgradedRef)
        expect(requests.at(-1)!.tools!.map((tool) => tool.function.name)).toEqual(['codemode'])
        expect(JSON.stringify(requests.at(-1)!.messages)).toContain('V3_PRESERVED_HISTORY')
        expect(JSON.stringify(requests.at(-1)!.messages)).toContain('UPGRADED_NATIVE_CODE_OK')
      } finally {
        await product.close('legacy-v3')
        database.sqlite.close()
      }
      nextCode = 'while (true) {}'
      const before = events.length
      await client.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'Cancel native code' }]
      })
      await expect
        .poll(() => events.slice(before).some((event) => event.name === 'tool-call'), {
          timeout: 10000
        })
        .toBe(true)
      await client.call('deepchat.host.stop', { ...ref, reason: 'Code Mode cancellation' })
      await client.call('deepchat.host.idle', ref)
      await connection.close()
      connection = undefined
      await host.stop()
      client = await host.start()
      await mode('minimal')
      await send('Continue after cancelled code')
      expect(requests.at(-1)!.tools!.map((tool) => tool.function.name)).not.toContain('codemode')
      await expect(readFile(deniedFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await connection?.close()
      await host.stop()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  60000
)
