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
import { DimLegacyMigration } from '@/agent/dim/legacyMigration'
import type { UserPluginHook, UserPluginHookSource } from '@shared/types/userPlugin'
import { dimDatabase } from './fixtures/database'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'executes declared plugin hooks through native process ownership and canonical Timeline with dedupe, revoke, cancellation and restart recovery',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-hooks-'))
    const database = dimDatabase(path.join(profile, 'desktop.sqlite'))
    const hooks = new UserPluginHooks(() => ({
      ...Object.fromEntries(
        Object.entries(createMinimalProcessEnvironment(process.env, process.platform)).filter(
          ([key]) => key.toLowerCase() !== 'path'
        )
      ),
      PATH: profile + path.delimiter + (process.env.PATH ?? ''),
      DEEPCHAT_HOOK_TEST_SECRET: 'must-not-reach-hook'
    }))
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
        matcher: '^startup$',
        command: `exec ${command}`,
        commandWindows: command,
        timeout: 5.5
      },
      {
        id: 'compact',
        event: 'SessionStart',
        matcher: '^compact$',
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
    hooks.register({
      ...source,
      pluginId: 'resume-only',
      hooks: [{ ...declared[0], id: 'resume', matcher: '^resume$' }]
    })
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
          hooks: source.hooks.filter(
            (hook) =>
              hook.event === request.event &&
              (request.includeUnmatched ||
                !hook.matcher ||
                new RegExp(hook.matcher).test(request.matcher))
          )
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
    let prepareLegacy = async (_id: string): Promise<void> => {
      throw new Error('Unexpected archive conversion')
    }
    const connect = () => {
      const native = new DimPluginHooks({
        database: database.data,
        host,
        hooks,
        resolve: scopes.context,
        prepareLegacy: (id) => prepareLegacy(id)
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
      expect(await native.diagnostics('resume-only')).toEqual([])
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
      const finalRequest = bodies
        .filter(
          (body) => !JSON.stringify(body).includes('Write a short title for this conversation:')
        )
        .at(-1)
      expect(JSON.stringify(finalRequest)).toContain('native-hook:startup')
      expect(JSON.stringify(finalRequest)).toContain('native-hook:compact')
      expect(JSON.stringify(finalRequest)).toContain('resume-only')
      expect(
        (await native.diagnostics('resume-only')).filter((row) => row.status === 'completed')
      ).toHaveLength(1)
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

      // A legacy archive remains read-only. Its successful startup context survives;
      // a started command becomes uncertain and executes only after explicit retry.
      database.sqlite.exec(database.data.deepchatTapeEntriesTable.getCreateTableSQL())
      database.data.newSessionsTable.create('archived', 'agent', 'Archive', profile)
      const old = (
        pluginId: string,
        hookId: string,
        boundaryId: string,
        state: Record<string, unknown>
      ) => {
        const invocationId = createHash('sha256')
          .update(
            JSON.stringify([
              pluginId,
              source.digest,
              'archived',
              hookId,
              ...(hookId === '$session' ? [] : [boundaryId])
            ])
          )
          .digest('hex')
        return {
          invocationId,
          pluginId,
          digest: source.digest,
          hookId,
          boundaryId,
          messageId: 'old-message',
          sessionId: 'archived',
          event: 'SessionStart',
          status: 'completed',
          at: 1,
          source: 'old-launch',
          ...state
        }
      }
      const started = old('fixture', 'prompt', 'input:old-message:old-hash', {
        event: 'UserPromptSubmit',
        status: 'started',
        input: {
          sessionId: 'archived',
          messageId: 'old-message',
          prompt: 'legacy retry',
          cwd: profile,
          model: 'fixture'
        }
      })
      const archived = [
        old('fixture', 'startup', 'startup', { content: 'LEGACY_STARTUP_CONTEXT' }),
        started,
        old('resume-only', '$session', 'session-observed', {})
      ]
      for (const [index, state] of archived.entries())
        database.sqlite
          .prepare(`INSERT INTO deepchat_tape_entries
          (session_id,entry_id,kind,name,payload_json,meta_json,created_at)
          VALUES (?,?, 'anchor','plugin/context-hook',?,'{}',1)`)
          .run('archived', index + 1, JSON.stringify({ state }))
      const originalArchive = database.sqlite.prepare('SELECT * FROM deepchat_tape_entries').all()
      const before = (await calls()).length
      expect(await native.diagnostics('fixture')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            invocationId: started.invocationId,
            sessionId: 'archived',
            status: 'uncertain'
          })
        ])
      )
      expect(database.data.dimSessionBindingsTable.get('archived')).toBeNull()
      expect((await calls()).length).toBe(before)
      let archivedRef: { sessionId: string; branchId: string } | undefined
      prepareLegacy = async (id) => {
        expect(id).toBe('archived')
        const launched = await client.call<{ sessionId: string }>('deepchat.host.launch', {
          model: { ...model },
          cwd: profile,
          tools: []
        })
        database.data.dimSessionBindingsTable.bind(id, launched.sessionId)
        archivedRef = { sessionId: launched.sessionId, branchId: 'main' }
      }
      await native.retry('fixture', started.invocationId)
      expect((await calls()).length).toBe(before + 1)
      expect((await calls()).at(-1)).toMatchObject({ prompt: 'legacy retry' })
      await client.call('deepchat.host.input', {
        ...archivedRef!,
        mode: 'queue',
        submissionId: 'archive-continuation',
        rawBlocks: [],
        content: [{ type: 'text', text: 'continue migrated hooks' }]
      })
      await client.call('deepchat.host.idle', archivedRef!)
      const archiveCalls = (await calls()).slice(before)
      expect(archiveCalls.filter((call) => call.source === 'startup')).toEqual([])
      expect(archiveCalls.filter((call) => call.source === 'resume')).toHaveLength(1)
      expect(archiveCalls.filter((call) => call.prompt === 'legacy retry')).toHaveLength(1)
      expect(JSON.stringify(bodies.at(-1))).toContain('LEGACY_STARTUP_CONTEXT')
      expect(database.sqlite.prepare('SELECT * FROM deepchat_tape_entries').all()).toEqual(
        originalArchive
      )
      const captured = await new DimContent(host).transcript(archivedRef!, 'archived')
      const replace = async (state: typeof captured.pluginHookState) => {
        const previous = database.data.dimSessionBindingsTable.get('archived')!
        const launched = await client.call<{ sessionId: string }>('deepchat.host.launch', {
          model: { ...model },
          cwd: profile,
          tools: []
        })
        const binding = {
          ...previous,
          dimSessionId: launched.sessionId,
          generation: previous.generation + 1,
          cursor: '0',
          nextOrderSeq: 1,
          status: 'idle' as const,
          activeTurnId: null,
          assistantMessageId: null
        }
        database.data.dimSessionBindingsTable.replace(previous, binding)
        await new DimLegacyMigration({
          database: database.data,
          host,
          snapshot: async () => ({
            formatVersion: 1,
            productSessionId: 'archived',
            messages: [],
            summary: null,
            pluginHookState: state
          })
        }).prepare(binding)
        const ref = { sessionId: launched.sessionId, branchId: 'main' }
        await client.call('deepchat.host.input', {
          ...ref,
          mode: 'queue',
          submissionId: `generation-${binding.generation}`,
          rawBlocks: [],
          content: [{ type: 'text', text: 'after native generation replacement' }]
        })
        await client.call('deepchat.host.idle', ref)
      }
      await replace(captured.pluginHookState)
      expect(JSON.stringify(bodies.at(-1))).toContain('LEGACY_STARTUP_CONTEXT')
      const beforeClear = (await calls()).length
      await replace([])
      expect(JSON.stringify(bodies.at(-1))).not.toContain('LEGACY_STARTUP_CONTEXT')
      expect(
        (await calls()).slice(beforeClear).filter((call) => call.source === 'startup')
      ).toHaveLength(1)
      await expect(native.retry('fixture', started.invocationId)).rejects.toThrow('scope changed')
      expect(database.sqlite.prepare('SELECT * FROM deepchat_tape_entries').all()).toEqual(
        originalArchive
      )
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
