import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { UserPluginHooks } from '@/plugin/userPluginHooks'
import { createMinimalProcessEnvironment } from '@/mcp/processEnvironment'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimProductGateway } from '@/agent/dim/productGateway'
import { DimPluginHooks } from '@/agent/dim/pluginHooks'
import { DimProductContext } from '@/agent/dim/productContext'
import { DimScopes } from '@/agent/dim/scopes'
import { DimContent } from '@/agent/dim/content'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import type { UserPluginHook, UserPluginHookSource } from '@shared/types/userPlugin'
import { dimDatabase } from './fixtures/database'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'executes declared plugin hooks through native process ownership and canonical Timeline with dedupe, revoke, cancellation and restart recovery',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-hooks-'))
    const database = dimDatabase(path.join(profile, 'desktop.sqlite'))
    const failTape = () => {
      throw new Error('Native hooks must never access Tape')
    }
    const hooks = new UserPluginHooks(
      {
        appendAnchor: failTape,
        getBySession: failTape,
        getTapeIncarnationId: failTape
      },
      () => ({
        ...Object.fromEntries(
          Object.entries(createMinimalProcessEnvironment(process.env, process.platform)).filter(
            ([key]) => key.toLowerCase() !== 'path'
          )
        ),
        PATH: profile + path.delimiter + (process.env.PATH ?? ''),
        DEEPCHAT_HOOK_TEST_SECRET: 'must-not-reach-hook'
      })
    )
    const script = path.join(profile, 'hook.cjs')
    await writeFile(
      script,
      `
const fs = require('node:fs'); const path = require('node:path');
let input = ''; process.stdin.on('data', x => input += x); process.stdin.on('end', () => {
  const p = JSON.parse(input); const root = process.env.PLUGIN_ROOT;
  fs.writeFileSync(path.join(root, 'environment.json'),JSON.stringify({path:process.env.PATH,secret:process.env.DEEPCHAT_HOOK_TEST_SECRET}));
  fs.appendFileSync(path.join(root, 'calls'), JSON.stringify(p) + '\\n');
  if (p.prompt === 'slow' || p.prompt === 'revoked' || (p.prompt === 'crash' && !fs.existsSync(path.join(root, 'crashed-once')))) {
    if (p.prompt === 'crash') fs.writeFileSync(path.join(root, 'crashed-once'), 'yes');
    fs.writeFileSync(path.join(root, p.prompt + '-pid'), JSON.stringify([process.pid, process.ppid]));
    setInterval(() => fs.appendFileSync(path.join(root, p.prompt + '-heartbeat'), '.'), 20); return;
  }
  if (p.prompt === 'control') { console.log(JSON.stringify({decision:'deny'})); return; }
  console.log(JSON.stringify({hookSpecificOutput:{hookEventName:p.hook_event_name,additionalContext:'native-hook:' + (p.source || p.prompt || p.agent_type)},systemMessage:'native audit'}));
});
`
    )
    const command = `"${process.execPath}" "${script}"`
    const declared: UserPluginHook[] = [
      {
        id: 'startup',
        event: 'SessionStart',
        command: `exec ${command}`,
        commandWindows: command,
        timeout: 5.5
      },
      {
        id: 'prompt',
        event: 'UserPromptSubmit',
        command: `exec ${command}`,
        commandWindows: command,
        timeout: 5.5
      }
    ]
    const source: UserPluginHookSource = {
      pluginId: 'fixture',
      digest: 'fixture-digest',
      root: profile,
      data: profile,
      hooks: declared
    }
    hooks.register(source)
    const bodies: unknown[] = []
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      bodies.push(JSON.parse(Buffer.concat(chunks).toString()))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'hook-model', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', content: 'Native hook reply' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    let context!: DimProductContext
    const gateway = new DimProductGateway({
      resolve: async () => ({
        version: 'empty',
        tools: [],
        execute: async () => {
          throw new Error('No desktop tools')
        }
      }),
      context: (request, signal) => context.prepare(request, signal),
      pluginHooks: async (request, signal) =>
        (await hooks.nativeSources(signal)).map((source) => ({
          ...source,
          hooks: source.hooks.filter((hook) => hook.event === request.event)
        }))
    })
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nativePlugins: true,
      contextBridge: true,
      gatewayAddress: await gateway.start(),
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      )
    })
    const scopes = new DimScopes({ database: database.data, host })
    const connect = () => {
      const native = new DimPluginHooks({
        database: database.data,
        host,
        hooks,
        resolve: scopes.context
      })
      hooks.useNative(native)
      context = new DimProductContext({
        database: database.data,
        content: new DimContent(host),
        resolve: scopes.context,
        authorize: () => {},
        prepare: (binding, request, signal) => native.contribute(binding, request, signal)
      })
      return native
    }
    let native = connect()
    const calls = async () =>
      (await readFile(path.join(profile, 'calls'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    const heartbeat = async (name: string) =>
      readFile(path.join(profile, `${name}-heartbeat`), 'utf8').catch(() => '')
    try {
      const model = await new DimModelBridge(host).configure({
        key: 'hooks',
        displayName: 'Hooks',
        connection: {
          driverKind: 'openai-compatible',
          auth: { type: 'anonymous' },
          baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`
        },
        model: {
          modelId: 'fixture',
          displayName: 'Fixture',
          status: 'active',
          capabilities: {
            modalities: ['text'],
            toolCalling: false,
            streaming: true,
            structuredOutput: false,
            vision: false,
            audio: false,
            reasoning: false,
            contextWindow: 8192,
            maxOutputTokens: 1024
          }
        }
      })
      let client = await host.start()
      const { sessionId } = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        model: { ...model },
        cwd: profile,
        tools: []
      })
      database.data.newSessionsTable.create('desktop', 'agent', 'Hooks', profile)
      database.data.dimSessionBindingsTable.bind('desktop', sessionId)
      const ref = { sessionId, branchId: 'main' }
      const send = async (prompt: string, id: string) => {
        await client.call('deepchat.host.input', {
          ...ref,
          mode: 'queue',
          submissionId: id,
          rawBlocks: [],
          content: [{ type: 'text', text: prompt }]
        })
        await client.call('deepchat.host.idle', ref)
      }
      await send('first prompt', 'first')
      expect(await native.diagnostics('fixture')).toEqual([
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' })
      ])
      expect((await calls()).map((p) => [p.hook_event_name, p.source ?? p.prompt])).toEqual([
        ['SessionStart', 'startup'],
        ['UserPromptSubmit', 'first prompt']
      ])
      expect(JSON.stringify(bodies)).toContain('native-hook:startup')
      expect(JSON.stringify(bodies)).toContain('native-hook:first prompt')
      expect(JSON.parse(await readFile(path.join(profile, 'environment.json'), 'utf8'))).toEqual({
        path: profile + path.delimiter + (process.env.PATH ?? '')
      })
      expect((await native.diagnostics('fixture')).map((row) => row.status)).toEqual([
        'completed',
        'completed'
      ])
      await send('compact source '.repeat(200), 'compaction-source')
      expect(await client.call('deepchat.session.compact', ref)).toMatchObject({
        status: 'completed'
      })
      await send('after compaction', 'after-compaction')
      expect(await calls()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ hook_event_name: 'SessionStart', source: 'compact' })
        ])
      )
      expect(JSON.stringify(bodies)).toContain('native-hook:compact')
      const invoke = async (prompt: string, boundaryId = prompt) => {
        const invocationId = createHash('sha256')
          .update(
            JSON.stringify(['fixture', source.digest, sessionId, 'main', 'prompt', boundaryId])
          )
          .digest('hex')
        const params = {
          ...ref,
          invocationId,
          pluginId: 'fixture',
          digest: source.digest,
          hookId: 'prompt',
          boundaryId,
          messageId: boundaryId,
          launchId: 'fixture',
          event: 'UserPromptSubmit',
          matcher: '',
          contextBudget: 8192,
          payload: {
            session_id: 'desktop',
            hook_event_name: 'UserPromptSubmit',
            cwd: profile,
            transcript_path: null,
            model: 'fixture',
            prompt
          }
        }
        return {
          params,
          pending: client.call<{ status: string; message?: string }>(
            'session.deepchat_hooks.run',
            params
          )
        }
      }
      const ordinary = await invoke('dedupe')
      expect(await ordinary.pending).toMatchObject({ status: 'completed' })
      const count = (await calls()).length
      expect(await client.call('session.deepchat_hooks.run', ordinary.params)).toMatchObject({
        status: 'completed'
      })
      expect((await calls()).length).toBe(count)
      const control = await invoke('control')
      expect(await control.pending).toMatchObject({
        status: 'failed',
        message: expect.stringContaining('control fields')
      })
      const slow = await invoke('slow')
      await expect
        .poll(async () => readFile(path.join(profile, 'slow-pid'), 'utf8').catch(() => null))
        .not.toBeNull()
      await client.call('session.deepchat_hooks.cancel', {
        ...ref,
        invocationId: slow.params.invocationId
      })
      expect(await slow.pending).toMatchObject({
        status: 'failed',
        message: expect.stringContaining('cancelled')
      })
      const stopped = await heartbeat('slow')
      await delay(100)
      expect(await heartbeat('slow')).toBe(stopped)
      const revoked = await invoke('revoked')
      await expect
        .poll(async () => readFile(path.join(profile, 'revoked-pid'), 'utf8').catch(() => null))
        .not.toBeNull()
      hooks.unregister('fixture')
      expect(await revoked.pending).toMatchObject({ status: 'failed' })
      const revokedStopped = await heartbeat('revoked')
      await delay(100)
      expect(await heartbeat('revoked')).toBe(revokedStopped)
      hooks.register(source)
      if (process.platform !== 'win32') {
        const crash = await invoke('crash')
        const outcome = crash.pending.catch((error: unknown) => error)
        await expect
          .poll(async () => readFile(path.join(profile, 'crash-pid'), 'utf8').catch(() => null))
          .not.toBeNull()
        const [hookPid, nativePid] = JSON.parse(
          await readFile(path.join(profile, 'crash-pid'), 'utf8')
        ) as [number, number]
        process.kill(nativePid, 'SIGKILL')
        process.kill(-hookPid, 'SIGKILL')
        expect(await outcome).toBeInstanceOf(Error)
        await host.stop().catch(() => undefined)
        client = await host.start()
        const count = (await calls()).length
        expect(await client.call('session.deepchat_hooks.run', crash.params)).toMatchObject({
          status: 'uncertain'
        })
        expect((await calls()).length).toBe(count)
        native = connect()
        expect(await native.diagnostics('fixture')).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              invocationId: crash.params.invocationId,
              status: 'uncertain'
            })
          ])
        )
        await native.retry('fixture', crash.params.invocationId)
        expect((await calls()).length).toBe(count + 1)
      } else {
        await host.stop()
        client = await host.start()
        native = connect()
      }
      await send('after restart', 'second')
      expect(await calls()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ hook_event_name: 'SessionStart', source: 'resume' })
        ])
      )
      expect(JSON.stringify(bodies)).toContain('native-hook:after restart')
      expect(
        JSON.stringify(await client.call('deepchat.storage.history', { ...ref, limit: 100 }))
      ).not.toContain('must-not-reach-hook')
      expect(
        database.sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%tape%'").all()
      ).toEqual([])
    } finally {
      await host.stop().catch(() => undefined)
      await gateway.stop()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      database.sqlite.close()
      await rm(profile, { recursive: true, force: true })
    }
  },
  60000
)
