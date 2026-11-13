import { expect, it, vi } from 'vitest'
import { createServer, type ServerResponse } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimProfileBackups } from '@/agent/dim/profileBackups'
import { DimSessionRuntime } from '@/agent/dim/sessionRuntime'
import { dimDatabase } from './fixtures/database'

vi.unmock('fs')
vi.unmock('node:fs')

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'keeps an internal native title request alive while profile capture is refused',
  async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-profile-'))
    let title: ServerResponse | undefined
    let agent: ServerResponse | undefined
    let titleCancelled = false
    let automatic = false
    const tools: Array<{ name: string; arguments: Record<string, unknown> }> = []
    const reply = (response: ServerResponse, text: string) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'profile', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    }
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks).toString()
      if (body.includes('Write a short title for this conversation:')) {
        title = response
        response.once('close', () => {
          if (!response.writableFinished) titleCancelled = true
        })
      } else if (automatic) {
        const tool = tools.shift()
        if (tool) {
          response.writeHead(200, { 'Content-Type': 'text/event-stream' })
          response.end(
            `data: ${JSON.stringify({ id: 'profile-tool', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: randomUUID(), type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
          )
        } else reply(response, 'Profile tool complete')
      } else agent = response
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const host = new DimRuntimeSupervisor({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: profile,
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true
    })
    let observer: Awaited<ReturnType<DimRuntimeSupervisor['openConnection']>> | undefined
    try {
      const client = await host.start()
      const model = await new DimModelBridge(host).configure({
        key: 'profile-readiness',
        displayName: 'Profile fixture',
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
            maxOutputTokens: 1000
          }
        }
      })
      const created = await client.call<{ sessionId: string }>('deepchat.host.launch', {
        cwd: profile,
        model: { ...model },
        policy: { preset: 'full-access', allowedTools: [], disallowedTools: [] }
      })
      const ref = { sessionId: created.sessionId, branchId: 'main' }
      observer = await host.openConnection()
      await observer.call('session.attach', { sessionId: ref.sessionId })
      await client.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'Profile capture must wait for native work.' }]
      })
      await expect.poll(() => !!agent && !!title, { timeout: 10_000 }).toBe(true)
      expect(await client.call('deepchat.storage.readiness')).toMatchObject({
        idle: false,
        sessions: true,
        provider: true
      })
      observer.close()
      reply(agent!, 'Agent ready')
      await client.call('deepchat.host.idle', ref, 30_000)
      await expect
        .poll(async () => (await client.call<{ connections: number }>('daemon.ping')).connections)
        .toBe(1)
      expect(await client.call('deepchat.storage.readiness')).toMatchObject({
        idle: false,
        sessions: true,
        provider: true
      })
      let copied = false
      await expect(
        host.withStopped(
          async () => {
            copied = true
          },
          { ifIdle: true }
        )
      ).rejects.toMatchObject({ data: { appError: 'daemon_busy' } })
      expect(copied).toBe(false)
      expect(titleCancelled).toBe(false)
      expect(title!.destroyed).toBe(false)
      reply(title!, 'PROFILE_NATIVE_TITLE')
      await expect
        .poll(
          async () =>
            (
              await client.call<{ title: { text: string } | null }>('deepchat.storage.scope', {
                sessionId: ref.sessionId
              })
            ).title?.text
        )
        .toBe('PROFILE_NATIVE_TITLE')
      await expect
        .poll(async () => (await client.call<{ idle: boolean }>('deepchat.storage.readiness')).idle)
        .toBe(true)
      automatic = true
      const quote = (value: string) =>
        process.platform === 'win32'
          ? `'${value.replaceAll("'", "''")}'`
          : `'${value.replaceAll("'", "'\\''")}'`
      const command = `${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} -e 'process.stdout.write(String.fromCharCode(120).repeat(262161));setInterval(()=>{},1000)'`
      tools.push({ name: 'exec', arguments: { command, runInBackground: true, timeoutMs: -1 } })
      await client.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'Launch the profile background task.' }]
      })
      await client.call('deepchat.host.idle', ref, 30_000)
      const events = await client.call<{
        events: Array<{
          type: string
          name: string
          data: { task_id?: string; output_path?: string }
        }>
      }>('deepchat.storage.history', { ...ref, limit: 200 })
      const taskId = events.events.findLast(
        (event) => event.type === 'exec' && event.name === 'started'
      )?.data.task_id
      const originalOutput = events.events.findLast(
        (event) => event.type === 'exec' && event.name === 'started'
      )?.data.output_path
      expect(typeof originalOutput).toBe('string')
      await expect
        .poll(async () => (await readFile(originalOutput!)).length)
        .toBeGreaterThanOrEqual(262161)
      expect(typeof taskId).toBe('string')
      expect(await client.call('deepchat.storage.readiness')).toMatchObject({
        idle: false,
        sessions: true
      })
      await expect(
        host.withStopped(
          async () => {
            copied = true
          },
          { ifIdle: true }
        )
      ).rejects.toMatchObject({ data: { appError: 'daemon_busy' } })
      expect(copied).toBe(false)
      const database = dimDatabase()
      try {
        const desktop = new DimSessionRuntime({
          database: database.data,
          host,
          launch: async () => {
            throw new Error('Snapshot must not launch an agent')
          },
          projected: () => {},
          failed: (_id, error) => {
            throw error
          }
        })
        const attempts = vi.spyOn(desktop, 'withSuspendedReaders')
        const capturing = new DimProfileBackups({
          runtimeRoot: path.resolve('runtime/dim'),
          profileRoot: profile,
          temporaryRoot: os.tmpdir(),
          host,
          readers: () => desktop
        }).capture(async () => {
          copied = true
          return 'product boundary'
        })
        void capturing.catch(() => {})
        await expect.poll(() => attempts.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(copied).toBe(false)
        expect(await client.call('deepchat.storage.readiness')).toMatchObject({
          idle: false,
          sessions: true
        })
        await client.call('session.exec.stop', { ...ref, taskId: taskId! })
        const snapshot = await capturing
        try {
          expect(snapshot.value).toBe('product boundary')
          const originalBytes = await readFile(originalOutput!)
          expect(originalBytes.length).toBeGreaterThanOrEqual(262161)
          const mergedRoot = path.join(profile, 'merged')
          await mkdir(mergedRoot, { recursive: true })
          const mergedHost = host.createIsolatedProfile(mergedRoot)
          try {
            await mergedHost.start()
            await mergedHost.stop()
            const workingSource = path.join(profile, 'merge-source')
            await cp(snapshot.profile.directory, workingSource, { recursive: true })
            const coordinator = await host.start()
            await coordinator.call(
              'deepchat.storage.archive_transfer',
              {
                sourceDirectory: workingSource,
                targetDirectory: path.join(mergedRoot, 'dim'),
                sourceHome: (await snapshot.profile.manifest()).sourceHome!,
                installedDirectory: path.join(mergedRoot, 'dim')
              },
              120_000
            )
            const merged = await mergedHost.start()
            const scope = await merged.call<{ ownedPaths: string[] }>('deepchat.storage.scope', {
              sessionId: ref.sessionId
            })
            expect(scope.ownedPaths.length).toBeGreaterThan(0)
            const nativeRoot = await realpath(path.join(mergedRoot, 'dim/rust'))
            for (const output of scope.ownedPaths) {
              const relative = path.relative(nativeRoot, await realpath(output))
              expect(relative.startsWith('..') || path.isAbsolute(relative)).toBe(false)
              expect(await readFile(output)).toEqual(originalBytes)
            }
          } finally {
            await mergedHost.stop()
          }
          const restoredRoot = path.join(profile, 'restored')
          await mkdir(restoredRoot, { recursive: true })
          const restoredHost = host.createIsolatedProfile(restoredRoot)
          const owner = new DimProfileBackups({
            runtimeRoot: path.resolve('runtime/dim'),
            profileRoot: restoredRoot,
            temporaryRoot: os.tmpdir(),
            host: restoredHost,
            readers: () => {
              throw new Error('Cold restore must not start product readers')
            }
          })
          const prepared = await owner.prepareRestore(
            snapshot.profile.directory,
            await snapshot.profile.manifest()
          )
          try {
            const installed = await prepared.install()
            await installed.commit()
            const restored = await restoredHost.start()
            const scope = await restored.call<{ ownedPaths: string[] }>('deepchat.storage.scope', {
              sessionId: ref.sessionId
            })
            expect(scope.ownedPaths.length).toBeGreaterThan(0)
            const nativeRoot = await realpath(path.join(restoredRoot, 'dim/rust'))
            for (const output of scope.ownedPaths) {
              const relative = path.relative(nativeRoot, await realpath(output))
              expect(relative.startsWith('..') || path.isAbsolute(relative)).toBe(false)
              expect(await readFile(output)).toEqual(originalBytes)
            }
            await restored.call('deepchat.host.delete', { sessionId: ref.sessionId })
            expect(await readFile(originalOutput!)).toEqual(originalBytes)
          } finally {
            await restoredHost.stop()
            await prepared.dispose()
          }

          expect(copied).toBe(true)
          expect(
            (await snapshot.profile.manifest()).files.some(
              (file) => file.path === 'rust/dimcode.sqlite'
            )
          ).toBe(true)
        } finally {
          await snapshot.profile.dispose()
        }
      } finally {
        database.sqlite.close()
      }
    } finally {
      observer?.close()
      if (agent && !agent.writableEnded) reply(agent, 'cleanup')
      if (title && !title.writableEnded) reply(title, 'cleanup')
      await host.stop()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(profile, { recursive: true, force: true })
    }
  },
  60_000
)
