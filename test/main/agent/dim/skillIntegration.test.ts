import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimProductGateway } from '@/agent/dim/productGateway'
import { DimProductContext } from '@/agent/dim/productContext'
import { DimSkillContext } from '@/agent/dim/skillContext'
import { DimSkillCatalog } from '@/agent/dim/skillCatalog'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimContent } from '@/agent/dim/content'
import { DimMemorySource } from '@/agent/dim/memorySource'
import { DimMemoryViews } from '@/agent/dim/memoryViews'
import { DimTitles } from '@/agent/dim/titles'
import { dimDatabase } from './fixtures/database'

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1').each([true, false])(
  'loads assigned private skills with native tools (explicit selection: %s)',
  async (selected) => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-skills-'))
    const root = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-private-skill-'))
    const manifest = path.join(root, 'SKILL.md')
    const script = path.join(root, 'run.mjs')
    await writeFile(manifest, '# PRIVATE_SKILL_INSTRUCTIONS\nUse the bundled run.mjs script.')
    await writeFile(script, 'console.log("SKILL_EXECUTED_BY_NATIVE_EXEC")')
    const database = dimDatabase()
    let context!: DimProductContext
    let modelRequests = 0
    let observedInstructions = false
    let firstRequestHadInstructions: boolean | undefined
    let bodyReads = 0
    let observedCatalog = false
    let titles: DimTitles | undefined
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const title = JSON.stringify(body.messages).includes(
        'Write a short title for this conversation:'
      )
      const text = body.messages
        .map((message: { content: unknown }) =>
          typeof message.content === 'string' ? message.content : ''
        )
        .join('\n')
      let catalogPath: string | undefined
      try {
        const marker = 'Agent skills catalog: '
        const line = text.split('\n').find((line: string) => line.startsWith(marker))
        catalogPath = line ? JSON.parse(line.slice(marker.length)) : undefined
      } catch {
        /* Record failed discovery outside the asynchronous HTTP handler. */
      }
      const tools = body.messages.filter((message: { role: string }) => message.role === 'tool')
      observedCatalog ||= JSON.stringify(tools).includes('Private test skill')
      const finished = tools.some((message: { content: unknown }) =>
        JSON.stringify(message.content).includes('SKILL_EXECUTED_BY_NATIVE_EXEC')
      )
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
      const powershellQuote = (value: string) => `'${value.replaceAll("'", "''")}'`
      const command =
        process.platform === 'win32'
          ? `& ${powershellQuote(process.execPath)} ${powershellQuote(script)}`
          : `${quote(process.execPath)} ${quote(script)}`
      const tool =
        title || finished
          ? undefined
          : tools.length > 1
            ? { id: 'skill-exec', name: 'exec', arguments: { command } }
            : tools.length
              ? { id: 'skill-read', name: 'read', arguments: { path: manifest } }
              : {
                  id: 'catalog-read',
                  name: 'read',
                  arguments: { path: catalogPath ?? 'missing-native-catalog' }
                }
      if (!title) {
        modelRequests++
        firstRequestHadInstructions ??= JSON.stringify(body.messages).includes(
          'PRIVATE_SKILL_INSTRUCTIONS'
        )
        observedInstructions ||= JSON.stringify(body.messages).includes(
          'PRIVATE_SKILL_INSTRUCTIONS'
        )
      }
      const delta = tool
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: tool.id,
                type: 'function',
                function: { name: tool.name, arguments: JSON.stringify(tool.arguments) }
              }
            ]
          }
        : { role: 'assistant', content: 'Native skill complete' }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'skill-model', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'none',
        tools: [],
        execute: async () => {
          throw new Error('Native tools must execute directly')
        }
      }),
      context: (request, signal) => context.prepare(request, signal)
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true,
      contextBridge: true,
      gatewayAddress: await gateway.start()
    })
    const skills = new DimSkillContext({
      catalog: new DimSkillCatalog(host),
      session: () => ({ agentId: 'private-agent', projectDir: profile }),
      skills: {
        getActiveSkills: async () => (selected ? ['private'] : []),
        getMetadataList: async () => [
          { name: 'private', description: 'Private test skill', path: manifest, skillRoot: root }
        ],
        viewSkillForAgent: async () => {
          bodyReads++
          return {
            success: true,
            content: await readFile(manifest, 'utf8'),
            skillRoot: root
          }
        }
      }
    })
    context = new DimProductContext({
      database: database.data,
      content: new DimContent(host),
      authorize: () => {},
      prepare: (binding, _request, signal) => skills.contribute(binding, signal)
    })
    try {
      const client = await host.start()
      const model = await new DimModelBridge(host).configure({
        key: 'fixture/private-skills',
        displayName: 'Private skill fixture',
        connection: {
          driverKind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
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
            structuredOutput: true,
            vision: false,
            audio: false,
            reasoning: false,
            contextWindow: 64000,
            maxOutputTokens: 1024
          }
        }
      })
      const created = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        model: { ...model },
        policy: { preset: 'full-access', allowedTools: [], disallowedTools: [] }
      })
      const ref = { sessionId: created.sessionId, branchId: 'main' }
      database.data.newSessionsTable.create('desktop-private', 'private-agent', 'Private', profile)
      const binding = database.data.dimSessionBindingsTable.bind(
        'desktop-private',
        ref.sessionId,
        ref.branchId
      )
      titles = new DimTitles({
        database: database.data,
        host,
        project: (id, title) => database.data.newSessionsTable.update(id, { title })
      })
      await titles.open(binding)
      await client.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'Use the selected private skill.' }]
      })
      await client.call('deepchat.host.idle', ref, 60_000)
      expect(observedInstructions).toBe(true)
      expect(firstRequestHadInstructions).toBe(selected)
      expect(bodyReads > 0).toBe(selected)
      expect(observedCatalog).toBe(true)
      expect(modelRequests).toBe(4)
      await expect
        .poll(() => database.data.newSessionsTable.get('desktop-private')?.title, {
          timeout: 10_000
        })
        .toBe('Native skill complete')
      const manualTitle = '从桌面设置的较长手动会话标题'.repeat(12)
      await titles.rename('desktop-private', manualTitle)
      await expect(titles.rename('desktop-private', 'Invalid\nname')).rejects.toThrow()
      await titles.seed(binding, { text: 'Late migration seed', source: 'auto' })
      expect(database.data.newSessionsTable.get('desktop-private')?.title).toBe(manualTitle)
      const titleScope = await client.call<{ title: { text: string; source: string } }>(
        'deepchat.storage.scope',
        { sessionId: ref.sessionId }
      )
      expect(titleScope.title).toEqual({ text: manualTitle, source: 'manual' })
      const carried = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        model: { ...model },
        policy: { preset: 'full-access', allowedTools: [], disallowedTools: [] }
      })
      database.data.newSessionsTable.create('desktop-carried', 'private-agent', 'Carry', profile)
      const target = database.data.dimSessionBindingsTable.bind(
        'desktop-carried',
        carried.sessionId
      )
      await titles.preserve(binding, target, { kind: 'clear' })
      await client.call('deepchat.session.close', { sessionId: carried.sessionId })
      expect(
        await client.call('deepchat.storage.scope', { sessionId: carried.sessionId })
      ).toMatchObject({
        title: { text: manualTitle, source: 'manual' }
      })
      const history = await new DimContent(host).transcript(ref, 'desktop-private')
      expect(JSON.stringify(history.messages)).toContain('Native skill complete')
      const user = history.messages.find((message) => message.role === 'user')!
      const turnId = JSON.parse(user.metadata).dim.turnId
      expect(turnId).toEqual(JSON.parse(history.messages.at(-1)!.metadata).runId)
      expect(typeof turnId).toBe('string')
      const content = new DimContent(host)
      const memory = new DimMemorySource({ database: database.data, host, content })
      const views = new DimMemoryViews({ database: database.data, content })
      const receipt = await memory.audit({
        sessionId: 'desktop-private',
        name: 'memory/view_assembled',
        state: { selected: [{ id: 'native-memory' }], tokenBudget: 1000 },
        meta: { messageId: turnId }
      })
      expect(
        await views.list('private-agent', {
          sessionId: 'desktop-private',
          messageId: user.id,
          limit: 1
        })
      ).toEqual([
        expect.objectContaining({
          messageId: user.id,
          entryId: null,
          selectedIds: ['native-memory'],
          timeline: receipt.timeline
        })
      ])
      const older = await content.events(ref, ['deepchat/memory-audit'], 1, {
        op: 'compare',
        left: { kind: 'field', path: 'position.sequence' },
        comparison: 'lt',
        right: { kind: 'value', value: receipt.timeline!.sequence }
      })
      expect(older.events).toEqual([])
      expect(modelRequests).toBe(4)
      const raw = await client.call<{
        events: Array<{ type: string; name: string; data: Record<string, unknown> }>
      }>('deepchat.storage.history', { ...ref, limit: 100 })
      expect(JSON.stringify(raw.events)).toContain('deepchat/skills')
      expect(
        raw.events.filter((event) => event.type === 'deepchat' && event.name === 'skill-catalog')
      ).toHaveLength(1)
      expect(
        raw.events.filter((event) => event.type === 'step' && event.name === 'tool-call')
      ).toHaveLength(3)
    } finally {
      await titles?.close('desktop-private')
      await host.stop()
      await gateway.stop()
      database.sqlite.close()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    }
  },
  90_000
)
