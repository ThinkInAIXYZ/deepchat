import { expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimAgentProfiles } from '@/agent/dim/agentProfiles'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimSessionControls } from '@/agent/dim/sessionControls'
import { DimProfileBackups } from '@/agent/dim/profileBackups'
import { captureDimProfile, validateDimProfile } from '@/agent/dim/profileSnapshot'
import { createServer } from 'node:http'

vi.unmock('fs')
vi.unmock('node:fs')

interface ArchivePage {
  storeFormat: number
  totalSessions: number
  sessions: Array<{
    sessionId: string
    agentId: string
    protocolVersion: number
    config: { cwd: string }
    title: { text: string; source: 'auto' | 'manual' } | null
    titleRevision: string
    ownedPaths: string[]
    grants: unknown[]
  }>
  agents: Record<string, { profile: { systemPrompt: string }; ownerSessionId: string | null }>
  next: string | null
}

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'merges closed Native histories and file ownership, preserves the source, and continues restored sessions',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-archive-'))
    const options = (name: string) => ({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: path.join(root, name),
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true
    })
    const source = new DimRuntimeSupervisor(options('source'))
    const target = new DimRuntimeSupervisor(options('target'))
    let requests = 0
    let allowInference = false
    const requestBodies: string[] = []
    const fixture = createServer(async (request, response) => {
      requests++
      if (!allowInference) {
        response.writeHead(400).end()
        return
      }
      try {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        requestBodies.push(Buffer.concat(chunks).toString('utf8'))
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(
          `data: ${JSON.stringify({
            id: 'native-archive',
            object: 'chat.completion.chunk',
            model: 'fixture',
            created: 0,
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'Native archive continuation' },
                finish_reason: 'stop'
              }
            ]
          })}\n\ndata: [DONE]\n\n`
        )
      } catch {
        response.writeHead(400).end()
      }
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    try {
      const client = await source.start()
      const projection: Parameters<DimModelBridge['configure']>[0] = {
        key: 'archive-only',
        displayName: 'Archive fixture',
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
            toolCalling: false,
            streaming: true,
            structuredOutput: true,
            vision: false,
            audio: false,
            reasoning: false,
            contextWindow: 8192,
            maxOutputTokens: 1024
          }
        }
      }
      const model = await new DimModelBridge(source).configure(projection)
      const agentId = await new DimAgentProfiles(source).ensure({
        name: 'Archive owner',
        description: '',
        systemPrompt: 'ARCHIVE_ONLY_PROFILE',
        tools: []
      })
      const ids: string[] = []
      for (let index = 0; index < 3; index++) {
        const created = await client.call<{ sessionId: string }>('deepchat.host.launch', {
          agent: agentId,
          model: { ...model },
          cwd: root,
          tools: []
        })
        ids.push(created.sessionId)
        await client.call('deepchat.storage.rename_title', {
          sessionId: created.sessionId,
          title: `归档会话 ${index}`
        })
      }
      const attachment = await client.call<{ attachmentId: string; path: string }>(
        'attachment.put',
        {
          sessionId: ids[0],
          name: 'archive.txt',
          text: 'Immutable Native attachment：归档字节'
        }
      )
      await client.call('deepchat.host.input', {
        sessionId: ids[0],
        branchId: 'main',
        mode: 'append',
        submissionId: 'archive-append',
        content: [{ type: 'text', text: '归档输入：保持事件身份与批次' }],
        rawBlocks: []
      })
      await client.call('deepchat.host.idle', { sessionId: ids[0], branchId: 'main' })
      await source.stop()
      const closedReader = await source.start()
      let originalHistory = await closedReader.call('deepchat.storage.history', {
        sessionId: ids[0],
        branchId: 'main',
        after: '0',
        limit: 100
      })
      await source.stop()
      const archive = path.join(root, 'archive')
      await cp(path.join(root, 'source/dim'), archive, { recursive: true })
      const database = path.join(archive, 'rust/dimcode.sqlite')
      const digest = async () =>
        createHash('sha256')
          .update(await readFile(database))
          .digest('hex')
      const before = await digest()
      let reader = await target.start()
      let after: string | null = null
      const found: string[] = []
      do {
        const page: ArchivePage = await reader.call('deepchat.storage.archive_catalog', {
          directory: archive,
          after,
          limit: 1
        })
        expect(page.storeFormat).toBe(44)
        expect(page.totalSessions).toBe(3)
        expect(page.sessions).toHaveLength(1)
        const session = page.sessions[0]
        expect(session.agentId).toBe(agentId)
        expect(session.protocolVersion).toBe(3)
        expect(await realpath(session.config.cwd)).toBe(await realpath(root))
        expect(session.title).toMatchObject({ source: 'manual' })
        expect(session.title?.text).toMatch(/^归档会话 [0-2]$/)
        expect(session.titleRevision).toBe('1')
        expect(session.ownedPaths).toHaveLength(session.sessionId === ids[0] ? 1 : 0)
        if (session.sessionId === ids[0])
          expect(path.basename(session.ownedPaths[0])).toBe(attachment.attachmentId)
        expect(session.grants).toEqual([])
        expect(page.agents[agentId].profile.systemPrompt).toBe('ARCHIVE_ONLY_PROFILE')
        found.push(session.sessionId)
        after = page.next
      } while (after)
      expect(found).toEqual([...ids].sort())
      expect(await digest()).toBe(before)
      await expect(reader.call('deepchat.storage.scope', { sessionId: ids[0] })).rejects.toThrow()
      await expect(
        reader.call('deepchat.storage.archive_catalog', { directory: archive, limit: 0 })
      ).rejects.toThrow('limit')
      expect(await digest()).toBe(before)
      await target.stop()
      expect(await digest()).toBe(before)
      const staging = path.join(root, 'staging')
      await cp(path.join(root, 'target/dim'), staging, { recursive: true })
      reader = await target.start()
      const transferred = await reader.call<{
        imported: string[]
        skipped: string[]
        events: string
      }>('deepchat.storage.archive_transfer', {
        sourceDirectory: archive,
        targetDirectory: staging
      })
      expect(transferred.imported.sort()).toEqual([...ids].sort())
      expect(transferred.skipped).toEqual([])
      expect(BigInt(transferred.events)).toBeGreaterThan(0n)
      const imported = await reader.call<ArchivePage>('deepchat.storage.archive_catalog', {
        directory: staging,
        limit: 64
      })
      expect(imported.sessions.map((session) => session.sessionId)).toEqual([...ids].sort())
      expect(imported.sessions.every((session) => session.title?.source === 'manual')).toBe(true)
      await expect(
        reader.call('deepchat.storage.archive_transfer', {
          sourceDirectory: archive,
          targetDirectory: staging
        })
      ).resolves.toEqual({ imported: [], skipped: [...ids].sort(), events: '0' })
      const advanced = await source.start()
      await advanced.call('deepchat.host.input', {
        sessionId: ids[0],
        branchId: 'main',
        mode: 'append',
        submissionId: 'compatible-tail',
        rawBlocks: [],
        content: [{ type: 'text', text: 'Compatible Native history tail' }]
      })
      await advanced.call('deepchat.host.idle', { sessionId: ids[0], branchId: 'main' })
      await source.stop()
      const historyReader = await source.start()
      originalHistory = await historyReader.call('deepchat.storage.history', {
        sessionId: ids[0],
        branchId: 'main',
        after: '0',
        limit: 100
      })
      await source.stop()
      const advancedArchive = path.join(root, 'advanced-archive')
      await cp(path.join(root, 'source/dim'), advancedArchive, { recursive: true })
      const appended = await reader.call<{ imported: string[]; skipped: string[]; events: string }>(
        'deepchat.storage.archive_transfer',
        { sourceDirectory: advancedArchive, targetDirectory: staging }
      )
      expect(appended.imported).toEqual([])
      expect(appended.skipped.sort()).toEqual([...ids].sort())
      expect(BigInt(appended.events)).toBeGreaterThan(0n)
      const divergent = new DimRuntimeSupervisor(options('divergent'))
      const conflictingTarget = path.join(root, 'conflicting-target')
      try {
        await mkdir(path.join(root, 'divergent'), { recursive: true })
        await cp(archive, path.join(root, 'divergent/dim'), { recursive: true })
        const conflicting = await divergent.start()
        await conflicting.call('deepchat.host.input', {
          sessionId: ids[0],
          branchId: 'main',
          mode: 'append',
          submissionId: 'divergent-tail',
          rawBlocks: [],
          content: [{ type: 'text', text: 'Different Native history tail' }]
        })
        await conflicting.call('deepchat.host.idle', { sessionId: ids[0], branchId: 'main' })
        await divergent.stop()
        await cp(staging, conflictingTarget, { recursive: true })
        await expect(
          reader.call('deepchat.storage.archive_transfer', {
            sourceDirectory: path.join(root, 'divergent/dim'),
            targetDirectory: conflictingTarget
          })
        ).rejects.toThrow(/diverged/)
      } finally {
        await divergent.stop()
        await rm(conflictingTarget, { recursive: true, force: true })
      }
      await expect(
        reader.call('deepchat.storage.archive_transfer', {
          sourceDirectory: archive,
          targetDirectory: path.join(root, 'target/dim')
        })
      ).rejects.toThrow()
      expect(await digest()).toBe(before)
      const identity = JSON.parse(
        await readFile(path.resolve('runtime/dim/plugins/native-host-lock.json'), 'utf8')
      )
      const snapshot = await captureDimProfile(path.join(root, 'source/dim'), os.tmpdir(), identity)
      try {
        const manifest = await snapshot.manifest()
        await target.withStopped(async () => {
          const prepared = await new DimProfileBackups({
            runtimeRoot: path.resolve('runtime/dim'),
            profileRoot: path.join(root, 'target'),
            temporaryRoot: os.tmpdir(),
            host: target,
            readers: () => {
              throw new Error('Cold merge must not start session readers')
            }
          }).prepareMerge(snapshot.directory, manifest)
          try {
            expect([...(prepared.nativeSessionIds ?? [])].sort()).toEqual([...ids].sort())
            const installed = await prepared.install()
            await installed.commit()
          } finally {
            await prepared.dispose()
          }
        })
        await validateDimProfile(snapshot.directory, manifest, identity)
      } finally {
        await snapshot.dispose()
      }
      reader = await target.start()
      expect(
        await reader.call('deepchat.storage.history', {
          sessionId: ids[0],
          branchId: 'main',
          after: '0',
          limit: 100
        })
      ).toEqual(originalHistory)
      const restoredFile = path.join(
        root,
        'target/dim/rust/dimcode.sqlite.session-files',
        attachment.attachmentId,
        'archive.txt'
      )
      expect(await readFile(restoredFile, 'utf8')).toBe('Immutable Native attachment：归档字节')
      await target.stop()
      const orphan = path.join(root, 'target/dim/rust/dimcode.sqlite.session-files', randomUUID())
      await mkdir(orphan, { recursive: true, mode: 0o700 })
      await writeFile(path.join(orphan, 'orphan.txt'), 'unowned', { mode: 0o600 })
      reader = await target.start()
      await reader.call('attachment.put', {
        sessionId: ids[1],
        name: 'sweep.txt',
        text: 'trigger native cleanup'
      })
      await vi.waitFor(
        async () => {
          await expect(readFile(path.join(orphan, 'orphan.txt'))).rejects.toMatchObject({
            code: 'ENOENT'
          })
        },
        { timeout: 5000, interval: 25 }
      )
      const scope = await reader.call<{ ownedPaths: string[] }>('deepchat.storage.scope', {
        sessionId: ids[0]
      })
      expect(scope.ownedPaths.map((value) => path.basename(value))).toContain(
        attachment.attachmentId
      )
      expect(await readFile(restoredFile, 'utf8')).toBe('Immutable Native attachment：归档字节')
      expect(requests).toBe(0)
      allowInference = true
      const restoredModel = await new DimModelBridge(target).configure(projection)
      const ref = { sessionId: ids[0], branchId: 'main' }
      await new DimSessionControls(target).call('set_model', ref, { ...restoredModel })
      await reader.call('deepchat.host.input', {
        ...ref,
        mode: 'queue',
        submissionId: 'continued-after-archive',
        rawBlocks: [],
        content: [{ type: 'text', text: 'Continue the imported Native session' }]
      })
      await reader.call('deepchat.host.idle', ref)
      expect(requests).toBe(1)
      expect(requestBodies[0]).toContain('归档输入：保持事件身份与批次')
      expect(requestBodies[0]).toContain('Compatible Native history tail')
      expect(
        JSON.stringify(
          await reader.call('deepchat.storage.history', { ...ref, after: '0', limit: 100 })
        )
      ).toContain('Native archive continuation')
      expect(await readFile(restoredFile, 'utf8')).toBe('Immutable Native attachment：归档字节')
      expect(await digest()).toBe(before)
    } finally {
      await Promise.all([source.stop(), target.stop()])
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'selects independent Native sessions without exporting unrelated histories, including nondefault Agents',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-selected-'))
    const options = (name: string) => ({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: path.join(root, name),
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true
    })
    const source = new DimRuntimeSupervisor(options('source'))
    const coordinator = new DimRuntimeSupervisor(options('coordinator'))
    let held: import('node:http').ServerResponse | undefined
    let cancelled = false
    let requests = 0
    const reply = (response: import('node:http').ServerResponse, text: string) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'live-export', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
      )
    }
    const fixture = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      if (Buffer.concat(chunks).toString().includes('Write a short title for this conversation:')) {
        reply(response, 'Live owner')
        return
      }
      requests++
      held = response
      response.once('close', () => {
        if (!response.writableFinished) cancelled = true
      })
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    const backups = new DimProfileBackups({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: path.join(root, 'source'),
      temporaryRoot: os.tmpdir(),
      host: source,
      readers: () => {
        throw new Error('Selection must not restore session readers')
      }
    })
    try {
      const client = await source.start()
      const model = await new DimModelBridge(source).configure({
        key: 'selected-archive',
        displayName: 'Selected archive',
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
      const sessions: Array<{
        id: string
        agent: string
        file: string
        text: string
        label: string
      }> = []
      for (const label of ['first', 'second']) {
        const agent = await new DimAgentProfiles(source).ensure({
          name: label,
          description: '',
          systemPrompt: `Selected ${label}`,
          tools: []
        })
        const created = await client.call<{ sessionId: string }>('deepchat.host.launch', {
          agent,
          cwd: root,
          model: { ...model },
          tools: []
        })
        const text = `Immutable ${label} selected file`
        const file = await client.call<{ attachmentId: string }>('attachment.put', {
          sessionId: created.sessionId,
          name: 'owned.txt',
          text
        })
        sessions.push({ id: created.sessionId, agent, file: file.attachmentId, text, label })
        await client.call('deepchat.host.input', {
          sessionId: created.sessionId,
          branchId: 'main',
          mode: 'append',
          submissionId: randomUUID(),
          content: [{ type: 'text', text: label }],
          rawBlocks: []
        })
      }
      const busy = { sessionId: sessions[1].id, branchId: 'main' }
      await client.call('deepchat.host.input', {
        ...busy,
        mode: 'queue',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text: 'Keep this unrelated inference running during export.' }]
      })
      await expect.poll(() => !!held, { timeout: 10_000 }).toBe(true)
      await expect(backups.exportSessions([busy.sessionId])).rejects.toMatchObject({
        data: { appError: 'daemon_busy' }
      })
      const live = await backups.exportSessions([sessions[0].id])
      try {
        expect(await source.start()).toBe(client)
        await client.call('daemon.ping')
        expect(cancelled).toBe(false)
        expect(held!.writableFinished).toBe(false)
        expect(requests).toBe(1)
        const reader = await coordinator.start()
        const page = await reader.call<ArchivePage>('deepchat.storage.archive_catalog', {
          directory: live.directory,
          limit: 64
        })
        expect(page.totalSessions).toBe(1)
        expect(page.sessions[0].sessionId).toBe(sessions[0].id)
        expect(
          await readFile(
            path.join(
              live.directory,
              'rust/dimcode.sqlite.session-files',
              sessions[0].file,
              'owned.txt'
            ),
            'utf8'
          )
        ).toBe(sessions[0].text)
      } finally {
        await live.dispose()
      }
      reply(held!, 'Unrelated inference completed after export')
      await client.call('deepchat.host.idle', busy)
      expect(requests).toBe(1)
      expect(cancelled).toBe(false)
      await source.stop()
      const reader = await coordinator.start()
      const identity = JSON.parse(
        await readFile(path.resolve('runtime/dim/plugins/native-host-lock.json'), 'utf8')
      )
      const snapshot = await captureDimProfile(path.join(root, 'source/dim'), os.tmpdir(), identity)
      try {
        for (const session of sessions) {
          const selected = await backups.selectSessions(snapshot, [session.id])
          try {
            const directory = selected.directory
            const page = await reader.call<ArchivePage>('deepchat.storage.archive_catalog', {
              directory,
              limit: 64
            })
            expect(page.totalSessions).toBe(1)
            expect(page.sessions.map((value) => value.sessionId)).toEqual([session.id])
            expect(page.agents[session.agent].profile.systemPrompt).toBe(
              `Selected ${session.label}`
            )
            expect(
              await readFile(
                path.join(
                  directory,
                  'rust/dimcode.sqlite.session-files',
                  session.file,
                  'owned.txt'
                ),
                'utf8'
              )
            ).toBe(session.text)
          } finally {
            await selected.dispose()
          }
        }
        await expect(backups.selectSessions(snapshot, [randomUUID()])).rejects.toThrow(
          'Selected archive Session ownership'
        )
        await validateDimProfile(snapshot.directory, await snapshot.manifest(), identity)
      } finally {
        await snapshot.dispose()
      }
      const original = await reader.call<ArchivePage>('deepchat.storage.archive_catalog', {
        directory: path.join(root, 'source/dim'),
        limit: 64
      })
      expect(original.totalSessions).toBe(2)
    } finally {
      await source.stop()
      await coordinator.stop()
      fixture.closeAllConnections()
      await new Promise<void>((resolve) => fixture.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000
)

it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
  'replaces only selected Native histories in cold staging and rolls back an uncommitted admission',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dc-dim-replica-'))
    const options = (name: string) => ({
      runtimeRoot: path.resolve('runtime/dim'),
      profileRoot: path.join(root, name),
      nodeExecutable: path.resolve(
        'runtime/node',
        ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
      ),
      nativePlugins: true
    })
    const source = new DimRuntimeSupervisor(options('source'))
    const target = new DimRuntimeSupervisor(options('target'))
    const backups = (host: DimRuntimeSupervisor, name: string) =>
      new DimProfileBackups({
        ...options(name),
        temporaryRoot: os.tmpdir(),
        host,
        readers: () => {
          throw new Error('Cold admission must not restore readers')
        }
      })
    const append = async (host: DimRuntimeSupervisor, sessionId: string, text: string) => {
      const client = await host.start()
      await client.call('deepchat.host.input', {
        sessionId,
        branchId: 'main',
        mode: 'append',
        submissionId: randomUUID(),
        rawBlocks: [],
        content: [{ type: 'text', text }]
      })
      await client.call('deepchat.host.idle', { sessionId, branchId: 'main' })
    }
    const history = async (host: DimRuntimeSupervisor, sessionId: string) =>
      (await host.start()).call('deepchat.storage.history', {
        sessionId,
        branchId: 'main',
        after: '0',
        limit: 100
      })
    try {
      const client = await source.start()
      const model = await new DimModelBridge(source).configure({
        key: 'replica',
        displayName: 'Replica',
        connection: {
          driverKind: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:1/v1',
          auth: { type: 'anonymous' }
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
      const agent = await new DimAgentProfiles(source).ensure({
        name: 'Replica',
        description: '',
        systemPrompt: 'Replica',
        tools: []
      })
      const ids: string[] = []
      for (let i = 0; i < 2; i++) {
        const created = await client.call<{ sessionId: string }>('deepchat.host.launch', {
          cwd: root,
          model: { ...model },
          agent,
          tools: []
        })
        ids.push(created.sessionId)
        await client.call('deepchat.storage.rename_title', {
          sessionId: created.sessionId,
          title: `Replica ${i}`
        })
        await append(source, created.sessionId, `Common prefix ${i}`)
      }
      await source.stop()
      await mkdir(path.join(root, 'target'), { recursive: true })
      await cp(path.join(root, 'source/dim'), path.join(root, 'target/dim'), { recursive: true })
      await append(target, ids[0], 'LOCAL_DIVERGENT')
      await append(target, ids[1], 'LOCAL_UNRELATED')
      // Native shutdown publishes its final stop fact. Compare the committed cold baseline.
      await target.stop()
      const before = await history(target, ids[0])
      const unrelated = await history(target, ids[1])
      await append(source, ids[0], 'REMOTE_WINNER')
      const attachment = await (
        await source.start()
      ).call<{ attachmentId: string }>('attachment.put', {
        sessionId: ids[0],
        name: 'winner.txt',
        text: 'Native replica winner bytes'
      })
      await expect
        .poll(
          async () =>
            (await (await source.start()).call<{ idle: boolean }>('deepchat.storage.readiness'))
              .idle
        )
        .toBe(true)
      const remote = await history(source, ids[0])
      const incoming = await backups(source, 'source').exportSessions([ids[0]])
      try {
        const manifest = await incoming.manifest()
        for (const commit of [false, true]) {
          await target.withStopped(async () => {
            const prepared = await backups(target, 'target').prepareReplica(
              { directory: incoming.directory, manifest },
              [ids[0]],
              [ids[0]]
            )
            try {
              const installed = await prepared.install()
              if (commit) await installed.commit()
              else await installed.rollback()
            } finally {
              await prepared.dispose()
            }
          })
          expect(await history(target, ids[0])).toEqual(commit ? remote : before)
          expect(await history(target, ids[1])).toEqual(unrelated)
        }
        expect(
          await readFile(
            path.join(
              root,
              'target/dim/rust/dimcode.sqlite.session-files',
              attachment.attachmentId,
              'winner.txt'
            ),
            'utf8'
          )
        ).toBe('Native replica winner bytes')
        const identity = JSON.parse(
          await readFile(path.resolve('runtime/dim/plugins/native-host-lock.json'), 'utf8')
        )
        await validateDimProfile(incoming.directory, manifest, identity)
        expect(await history(source, ids[0])).toEqual(remote)
        await target.withStopped(async () => {
          const prepared = await backups(target, 'target').prepareReplica(undefined, [], [ids[0]])
          try {
            await (await prepared.install()).commit()
          } finally {
            await prepared.dispose()
          }
        })
        await expect(history(target, ids[0])).rejects.toThrow()
        expect(await history(target, ids[1])).toEqual(unrelated)
        expect(await history(source, ids[0])).toEqual(remote)
      } finally {
        await incoming.dispose()
      }
    } finally {
      await Promise.all([source.stop(), target.stop()])
      await rm(root, { recursive: true, force: true })
    }
  },
  90_000
)
