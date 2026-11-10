import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimProductGateway } from '@/agent/dim/productGateway'
import { DimProductContext } from '@/agent/dim/productContext'
import { DimSkillContext } from '@/agent/dim/skillContext'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimContent } from '@/agent/dim/content'
import { dimDatabase } from './fixtures/database'

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'loads assigned private skill context and executes its script with native tools',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-skills-'))
    const root = path.join(profile, 'private-skill')
    const manifest = path.join(root, 'SKILL.md')
    const script = path.join(root, 'run.mjs')
    await mkdir(root)
    await writeFile(manifest, '# PRIVATE_SKILL_INSTRUCTIONS\nUse the bundled run.mjs script.')
    await writeFile(script, 'console.log("SKILL_EXECUTED_BY_NATIVE_EXEC")')
    const database = dimDatabase()
    let context!: DimProductContext
    let modelRequests = 0
    let observedInstructions = false
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const title = JSON.stringify(body.messages).includes(
        'Write a short title for this conversation:'
      )
      const tools = body.messages.filter((message: { role: string }) => message.role === 'tool')
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
          : tools.length
            ? { id: 'skill-exec', name: 'exec', arguments: { command } }
            : { id: 'skill-read', name: 'read', arguments: { path: manifest } }
      if (!title) {
        modelRequests++
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
      session: () => ({ agentId: 'private-agent', projectDir: profile }),
      skills: {
        getActiveSkills: async () => ['private'],
        getMetadataList: async () => [
          { name: 'private', description: 'Private test skill', path: manifest, skillRoot: root }
        ],
        viewSkillForAgent: async () => ({
          success: true,
          content: await readFile(manifest, 'utf8'),
          skillRoot: root
        })
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
      database.data.dimSessionBindingsTable.bind('desktop-private', ref.sessionId, ref.branchId)
      await client.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'Use the selected private skill.' }]
      })
      await client.call('deepchat.host.idle', ref, 60_000)
      expect(observedInstructions).toBe(true)
      expect(modelRequests).toBe(3)
      const history = await new DimContent(host).transcript(ref, 'desktop-private')
      expect(JSON.stringify(history.messages)).toContain('Native skill complete')
      const raw = await client.call<{
        events: Array<{ type: string; name: string; data: Record<string, unknown> }>
      }>('deepchat.storage.history', { ...ref, limit: 100 })
      expect(JSON.stringify(raw.events)).toContain('deepchat/skills')
      expect(
        raw.events.filter((event) => event.type === 'step' && event.name === 'tool-call')
      ).toHaveLength(2)
    } finally {
      await host.stop()
      await gateway.stop()
      database.sqlite.close()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  90_000
)
