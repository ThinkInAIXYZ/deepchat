import { afterEach, expect, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { requireDatabase, describeIfNativeSqlite } from '../nativeSqliteHarness'
import { SyncReplicaStore } from '@/sync/replica/store'
import { SyncReplicaEndpoint } from '@/sync/replica/endpoint'
import { AutomaticSync } from '@/sync/replica/automatic'
import { SyncBatchFiles } from '@/sync/replica/batches'

vi.unmock('fs')
vi.unmock('node:fs')

// Real sockets, SQLite and private staging exercise the protocol without a public tunnel.
describeIfNativeSqlite('Automatic device sync transport', () => {
  const cleanups: (() => void | Promise<void>)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    cleanups.length = 0
    vi.restoreAllMocks()
  })

  function device() {
    const directory = mkdtempSync(join(tmpdir(), 'deepchat-sync-wire-'))
    const db = new (requireDatabase())(join(directory, 'agent.db'))
    db.exec('CREATE TABLE new_sessions(id TEXT PRIMARY KEY,title TEXT,updated_at INTEGER)')
    const store = new SyncReplicaStore({
      database: () => db,
      directory,
      canApply: () => true,
      applied: () => {}
    })
    cleanups.push(() => {
      store.close()
      db.close()
      rmSync(directory, { recursive: true, force: true })
    })
    return { directory, db, store }
  }

  it('exchanges edits in both directions, persists acknowledgements, and rejects revoked writes', async () => {
    const host = device(),
      peer = device()
    host.db.exec("INSERT INTO new_sessions VALUES('host-session','From host',1)")
    peer.db.exec("INSERT INTO new_sessions VALUES('peer-session','From peer',1)")
    let writable = true
    const endpoint = new SyncReplicaEndpoint({
      store: host.store,
      directory: host.directory,
      hostId: () => 'host',
      available: () => true
    })
    const server = createServer((request, response) => {
      void endpoint.handle(request, response, 'peer', peer.store.replicaId, () => writable)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    cleanups.push(async () => {
      endpoint.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const automatic = new AutomaticSync({
      store: peer.store,
      directory: peer.directory,
      connection: async () => ({
        hostUrl: 'https://sync.example.test',
        hostId: 'host',
        token: 'test-token'
      }),
      available: () => true,
      changed: () => {},
      fetch: (url, options) =>
        fetch(String(url).replace('https://sync.example.test', origin), options)
    })
    cleanups.push(() => automatic.close())
    await automatic.setEnabled(true)
    await vi.waitFor(() => expect(automatic.status().lastSuccessAt).not.toBeNull(), {
      timeout: 5000
    })
    expect(host.db.prepare('SELECT title FROM new_sessions ORDER BY id').all()).toEqual([
      { title: 'From host' },
      { title: 'From peer' }
    ])
    expect(peer.db.prepare('SELECT title FROM new_sessions ORDER BY id').all()).toEqual([
      { title: 'From host' },
      { title: 'From peer' }
    ])
    peer.db.exec("UPDATE new_sessions SET title='Continued on peer' WHERE id='host-session'")
    await new Promise((resolve) => setTimeout(resolve, 350))
    const now = Date.now() + 61_000
    vi.spyOn(Date, 'now').mockReturnValue(now)
    automatic.request(true)
    await vi.waitFor(
      () =>
        expect(
          host.db.prepare("SELECT title FROM new_sessions WHERE id='host-session'").get()
        ).toEqual({ title: 'Continued on peer' }),
      { timeout: 5000 }
    )
    await vi.waitFor(() => expect(automatic.status().phase).toBe('idle'))
    await automatic.setEnabled(false)
    const cursor = host.store.cursor(peer.store.replicaId)
    expect(cursor).toBeGreaterThan(0)
    const other = device()
    other.db.exec("INSERT INTO new_sessions VALUES('forged','Forged',1)")
    const forged = await new SyncBatchFiles(join(other.directory, 'outgoing')).prepare(
      other.store.export(0)
    )
    const rejected = await fetch(origin + '/sync/v2/upload', {
      method: 'POST',
      body: JSON.stringify(forged)
    })
    expect(rejected.status).toBe(403)
    expect(host.store.cursor(other.store.replicaId)).toBe(0)
    const falseCursor = await fetch(origin + `/sync/v2/cursor?replica=${other.store.replicaId}`)
    expect(falseCursor.status).toBe(403)
    writable = false
    endpoint.revoke('peer')
    const denied = await fetch(origin + '/sync/v2/upload', { method: 'POST', body: '{}' })
    expect(denied.status).toBe(403)
    expect(host.store.cursor(peer.store.replicaId)).toBe(cursor)
    await expect(automatic.setEnabled(true)).rejects.toThrow('writeConsentRequired')
    expect(automatic.status().enabled).toBe(false)
  })

  it('resumes staged parts after restart and discards corrupt data without applying it', async () => {
    const source = device(),
      target = device()
    source.db.exec("INSERT INTO new_sessions VALUES('session','Durable transfer',1)")
    const outgoing = new SyncBatchFiles(join(source.directory, 'outgoing'))
    const manifest = await outgoing.prepare(source.store.export(0))
    let incoming = new SyncBatchFiles(join(target.directory, 'incoming'))
    await incoming.receive(manifest, 0, Buffer.alloc(manifest.size))
    await expect(incoming.assemble(manifest)).rejects.toThrow('integrityFailed')
    expect(await incoming.missing(manifest)).toEqual([0])
    await incoming.receive(manifest, 0, await outgoing.part(manifest.id, 0))
    incoming = new SyncBatchFiles(join(target.directory, 'incoming'))
    expect(await incoming.missing(manifest)).toEqual([])
    await target.store.apply(await incoming.assemble(manifest))
    expect(target.db.prepare('SELECT title FROM new_sessions').get()).toEqual({
      title: 'Durable transfer'
    })
  })
})
