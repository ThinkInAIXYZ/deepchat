import { expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { requireDatabase, describeIfNativeSqlite } from '../../nativeSqliteHarness'
import { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { DimAgentProfiles } from '@/agent/dim/agentProfiles'
import { DimModelBridge } from '@/agent/dim/modelBridge'
import { DimSessionControls } from '@/agent/dim/sessionControls'
import { DimProfileBackups } from '@/agent/dim/profileBackups'
import { DimSessionBindingsTable } from '@/session/data/tables/dimSessionBindings'
import { DimSessionScopesTable } from '@/session/data/tables/dimSessionScopes'
import { DimSessionImportsTable } from '@/session/data/tables/dimSessionImports'
import { DimTimelineInspectorTable } from '@/session/data/tables/dimTimelineInspector'
import { SyncReplicaStore } from '@/sync/replica/store'
import { SyncReplicaNative } from '@/sync/replica/native'
import { SyncReplicaEndpoint } from '@/sync/replica/endpoint'
import { AutomaticSync } from '@/sync/replica/automatic'
import { NativeReplicaRecovery } from '@/sync/replica/nativeRecovery'

vi.unmock('fs')
vi.unmock('node:fs')

describeIfNativeSqlite('Native device sync', () => {
  it.runIf(process.env.DEEPCHAT_DIM_SMOKE === '1')(
    'transfers native files over HTTP, applies a winning divergent history, continues it and propagates deletion',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'dc-native-sync-'))
      const readers = { withSuspendedReaders: <T>(operation: () => Promise<T>) => operation() }
      const devices: Array<ReturnType<typeof device>> = []
      function device(name: string) {
        const home = join(root, name)
        const db = new (requireDatabase())(join(root, `${name}.db`))
        db.exec('CREATE TABLE new_sessions(id TEXT PRIMARY KEY,title TEXT,updated_at INTEGER)')
        for (const table of [
          new DimSessionBindingsTable(db),
          new DimSessionScopesTable(db),
          new DimSessionImportsTable(db),
          new DimTimelineInspectorTable(db)
        ])
          db.exec(table.getCreateTableSQL())
        const host = new DimRuntimeSupervisor({
          runtimeRoot: resolve('runtime/dim'),
          profileRoot: home,
          nodeExecutable: resolve(
            'runtime/node',
            ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node'])
          ),
          nativePlugins: true
        })
        const store = new SyncReplicaStore({
          database: () => db,
          directory: join(root, `${name}-replica`),
          nativeProfiles: true,
          canApply: () => true,
          applied: () => {}
        })
        const backups = new DimProfileBackups({
          runtimeRoot: resolve('runtime/dim'),
          profileRoot: home,
          temporaryRoot: tmpdir(),
          host,
          readers: () => readers
        })
        const native = new SyncReplicaNative({
          root: home,
          database: () => db,
          backups,
          host,
          readers: () => readers,
          exportGuard: (_batch, operation) => operation()
        })
        const result = { home, db, host, store, native }
        devices.push(result)
        return result
      }
      const prompts: string[] = []
      const fixture = createServer(async (request, response) => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks).toString()
        const title = body.includes('Write a short title for this conversation:')
        if (!title) prompts.push(body)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(
          `data: ${JSON.stringify({ id: 'native-sync', object: 'chat.completion.chunk', model: 'fixture', created: 0, choices: [{ index: 0, delta: { role: 'assistant', content: title ? 'Synced chat' : 'SYNC_CONTINUED' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
        )
      })
      await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
      let automatic: AutomaticSync | undefined
      let endpoint: SyncReplicaEndpoint | undefined
      let wire: ReturnType<typeof createServer> | undefined
      const append = async (host: DimRuntimeSupervisor, id: string, text: string) => {
        const client = await host.start()
        await client.call('deepchat.host.input', {
          sessionId: id,
          branchId: 'main',
          mode: 'append',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text }]
        })
        await client.call('deepchat.host.idle', { sessionId: id, branchId: 'main' })
      }
      const history = async (host: DimRuntimeSupervisor, id: string) =>
        (await host.start()).call('deepchat.storage.history', {
          sessionId: id,
          branchId: 'main',
          after: '0',
          limit: 100
        })
      try {
        const source = device('source'),
          peer = device('peer')
        const projection: Parameters<DimModelBridge['configure']>[0] = {
          key: 'native-sync',
          displayName: 'Native sync',
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
        }
        const model = await new DimModelBridge(source.host).configure(projection)
        const agent = await new DimAgentProfiles(source.host).ensure({
          name: 'Sync',
          description: '',
          systemPrompt: 'Native sync fixture',
          tools: []
        })
        const client = await source.host.start()
        const created = await client.call<{ sessionId: string }>('deepchat.host.launch', {
          cwd: root,
          agent,
          model: { ...model },
          tools: []
        })
        const id = created.sessionId
        await append(source.host, id, 'COMMON_SYNC_PREFIX')
        const files: Array<{ id: string; digest: string }> = []
        for (const letter of ['a', 'b']) {
          const text = letter.repeat(9 * 1024 * 1024)
          const attachment = await client.call<{ attachmentId: string }>('attachment.put', {
            sessionId: id,
            name: 'sync.txt',
            text
          })
          files.push({
            id: attachment.attachmentId,
            digest: createHash('sha256').update(text).digest('hex')
          })
        }
        await expect
          .poll(
            async () => (await client.call<{ idle: boolean }>('deepchat.storage.readiness')).idle
          )
          .toBe(true)
        source.db.prepare('INSERT INTO new_sessions VALUES(?,?,?)').run('chat', 'From host', 1)
        source.db
          .prepare(
            "INSERT INTO dim_session_bindings(session_id,dim_session_id,branch_id) VALUES(?,?,'main')"
          )
          .run('chat', id)
        source.db.prepare("INSERT INTO dim_session_scopes VALUES(?,1,?,'main',1)").run('chat', id)
        peer.db.exec("INSERT INTO new_sessions VALUES('unrelated','Keep peer metadata',1)")
        endpoint = new SyncReplicaEndpoint({
          store: source.store,
          native: source.native,
          directory: join(root, 'wire'),
          hostId: () => 'host',
          available: () => true
        })
        wire = createServer((request, response) => {
          void endpoint!.handle(request, response, 'peer', peer.store.replicaId, () => true)
        })
        await new Promise<void>((resolve) => wire!.listen(0, '127.0.0.1', resolve))
        let nativeDownloaded = 0
        let nativeParts = 0
        let interrupted = false
        const exports = vi.spyOn(source.native, 'exportSessions')
        const createAutomatic = () =>
          new AutomaticSync({
            store: peer.store,
            native: peer.native,
            directory: join(root, 'automatic'),
            connection: async () => ({
              hostUrl: 'https://native-sync.example.test',
              hostId: 'host',
              token: 'fixture'
            }),
            available: () => true,
            changed: () => {},
            fetch: async (url, options) => {
              if (String(url).includes('/native-part?') && ++nativeParts === 3 && !interrupted) {
                interrupted = true
                return new Response('Temporary fixture outage', { status: 503 })
              }
              const response = await fetch(
                String(url).replace(
                  'https://native-sync.example.test',
                  `http://127.0.0.1:${(wire!.address() as { port: number }).port}`
                ),
                options
              )
              if (String(url).includes('/native-part?') && response.ok)
                nativeDownloaded += Number(response.headers.get('content-length'))
              return response
            }
          })
        automatic = createAutomatic()
        await automatic.setEnabled(true)
        await expect.poll(() => interrupted, { timeout: 45_000 }).toBe(true)
        await automatic.close()
        expect(automatic.status().lastSuccessAt).toBeNull()
        expect(
          peer.db
            .prepare("SELECT session_id FROM dim_session_bindings WHERE session_id='chat'")
            .get()
        ).toBeUndefined()
        peer.store.started(0)
        const begin = NativeReplicaRecovery.begin
        let journalFlushFailed = false
        const journalFault = vi
          .spyOn(NativeReplicaRecovery, 'begin')
          .mockImplementationOnce(async (...args) => {
            await begin(...args)
            journalFlushFailed = true
            throw Object.assign(
              new Error('Injected directory flush failure after journal publication'),
              { code: 'ENOSPC' }
            )
          })
        automatic = createAutomatic()
        await automatic.start()
        await expect.poll(() => journalFlushFailed, { timeout: 45_000 }).toBe(true)
        await automatic.close()
        journalFault.mockRestore()
        await expect(readFile(join(peer.home, '.dim-replica-import.json'))).rejects.toMatchObject({
          code: 'ENOENT'
        })
        expect(
          peer.db
            .prepare("SELECT session_id FROM dim_session_bindings WHERE session_id='chat'")
            .get()
        ).toBeUndefined()
        peer.store.started(0)
        automatic = createAutomatic()
        await automatic.start()
        await expect
          .poll(() => automatic!.status().lastSuccessAt, { timeout: 45_000 })
          .not.toBeNull()
        await automatic.setEnabled(false)
        expect(nativeDownloaded).toBeGreaterThan(18 * 1024 * 1024)
        expect(exports).toHaveBeenCalledTimes(1)
        expect(
          peer.db
            .prepare('SELECT dim_session_id FROM dim_session_bindings WHERE session_id=?')
            .get('chat')
        ).toEqual({ dim_session_id: id })
        expect(JSON.stringify(await history(peer.host, id))).toContain('COMMON_SYNC_PREFIX')
        for (const file of files) {
          const bytes = await readFile(
            join(peer.home, 'dim/rust/dimcode.sqlite.session-files', file.id, 'sync.txt')
          )
          expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.digest)
        }
        await new DimModelBridge(peer.host).configure(projection)
        const inspector = new DimTimelineInspectorTable(source.db)
        inspector.head({ sessionId: 'chat', dimSessionId: id, branchId: 'main', generation: 1 })
        inspector.head({
          sessionId: 'unrelated',
          dimSessionId: randomUUID(),
          branchId: 'main',
          generation: 1
        })
        await append(source.host, id, 'HOST_LOCAL_TAIL')
        source.db.exec("UPDATE new_sessions SET title='Local divergent history' WHERE id='chat'")
        await append(peer.host, id, 'PEER_SYNC_TAIL')
        peer.db.exec("UPDATE new_sessions SET title='Peer winning history' WHERE id='chat'")
        const hostStamp = source.store
          .export(0)
          .units.find((unit) => unit.id === 'chat')!.modifiedAt
        const peerStamp = peer.store.export(0).units.find((unit) => unit.id === 'chat')!.modifiedAt
        expect(peerStamp).toBeGreaterThan(hostStamp)
        source.store.started(0)
        peer.store.started(0)
        await automatic.setEnabled(true)
        await expect
          .poll(() => source.db.prepare("SELECT title FROM new_sessions WHERE id='chat'").get(), {
            timeout: 45_000
          })
          .toEqual({ title: 'Peer winning history' })
        await automatic.setEnabled(false)
        const adopted = JSON.stringify(await history(source.host, id))
        expect(adopted).toContain('PEER_SYNC_TAIL')
        expect(adopted).not.toContain('HOST_LOCAL_TAIL')
        expect(
          source.db
            .prepare('SELECT session_id FROM dim_timeline_inspector_heads ORDER BY session_id')
            .all()
        ).toEqual([{ session_id: 'unrelated' }])

        expect(
          peer.db.prepare("SELECT title FROM new_sessions WHERE id='unrelated'").get()
        ).toEqual({ title: 'Keep peer metadata' })
        const configured = await new DimModelBridge(source.host).configure(projection)
        await new DimSessionControls(source.host).call(
          'set_model',
          { sessionId: id, branchId: 'main' },
          { ...configured }
        )
        await (
          await source.host.start()
        ).call('deepchat.host.input', {
          sessionId: id,
          branchId: 'main',
          mode: 'queue',
          submissionId: randomUUID(),
          rawBlocks: [],
          content: [{ type: 'text', text: 'CONTINUE_SYNC' }]
        })
        await (
          await source.host.start()
        ).call('deepchat.host.idle', { sessionId: id, branchId: 'main' })
        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('PEER_SYNC_TAIL')
        expect(prompts[0]).not.toContain('HOST_LOCAL_TAIL')
        expect(JSON.stringify(await history(source.host, id))).toContain('SYNC_CONTINUED')
        await expect
          .poll(
            async () =>
              (
                await (
                  await source.host.start()
                ).call<{ idle: boolean }>('deepchat.storage.readiness')
              ).idle
          )
          .toBe(true)
        await (await peer.host.start()).call('deepchat.host.delete', { sessionId: id })
        peer.db.exec("DELETE FROM new_sessions WHERE id='chat'")
        source.store.started(0)
        peer.store.started(0)
        await automatic.setEnabled(true)
        await expect
          .poll(() => source.db.prepare("SELECT id FROM new_sessions WHERE id='chat'").get(), {
            timeout: 45_000
          })
          .toBeUndefined()
        await automatic.setEnabled(false)
        await expect(history(source.host, id)).rejects.toThrow()
        expect(
          source.db.prepare("SELECT title FROM new_sessions WHERE id='unrelated'").get()
        ).toEqual({ title: 'Keep peer metadata' })
      } finally {
        await automatic?.close()
        endpoint?.close()
        wire?.closeAllConnections()
        if (wire) await new Promise<void>((resolve) => wire!.close(() => resolve()))
        await Promise.all(devices.map((device) => device.host.stop()))
        for (const device of devices) {
          device.store.close()
          device.db.close()
        }
        fixture.closeAllConnections()
        await new Promise<void>((resolve) => fixture.close(() => resolve()))
        await rm(root, { recursive: true, force: true })
      }
    },
    180_000
  )
})
