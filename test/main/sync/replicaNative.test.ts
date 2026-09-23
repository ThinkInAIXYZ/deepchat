import { afterEach, expect, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { requireDatabase, describeIfNativeSqlite } from '../nativeSqliteHarness'
import { MainDatabase } from '@/data/mainDatabase'
import { buildMemoryTombstoneIdentities } from '@/memory/core/tombstone'
import { SyncReplicaStore } from '@/sync/replica/store'

vi.unmock('fs')
vi.unmock('node:fs')

const schema = `
 CREATE TABLE new_sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL, project_dir TEXT,
   created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
 CREATE TABLE deepchat_messages(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL,
   updated_at INTEGER NOT NULL);
 CREATE TABLE deepchat_user_messages(message_id TEXT PRIMARY KEY, text TEXT NOT NULL);
 CREATE TABLE app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
`

describeIfNativeSqlite('Device sync durable merge', () => {
  const cleanups: (() => void)[] = []
  afterEach(() => {
    for (const cleanup of cleanups.reverse()) cleanup()
    cleanups.length = 0
  })
  function device() {
    const directory = mkdtempSync(join(tmpdir(), 'deepchat-replica-'))
    const db = new (requireDatabase())(join(directory, 'agent.db'))
    db.exec(schema)
    let busy = false
    let store = new SyncReplicaStore({
      directory,
      database: () => db,
      canApply: () => !busy,
      applied: () => {}
    })
    cleanups.push(() => {
      store.close()
      db.close()
      rmSync(directory, { recursive: true, force: true })
    })
    return {
      db,
      get store() {
        return store
      },
      busy: (value: boolean) => {
        busy = value
      },
      restart() {
        store.close()
        store = new SyncReplicaStore({
          directory,
          database: () => db,
          canApply: () => !busy,
          applied: () => {}
        })
      }
    }
  }

  it('continues a session on another device, preserves its local path and keeps newer edits', async () => {
    const a = device(),
      b = device()
    a.db.exec(
      "INSERT INTO new_sessions VALUES('s','First','/a',1,1); INSERT INTO deepchat_messages VALUES('m','s','hello',1); INSERT INTO deepchat_user_messages VALUES('m','hello')"
    )
    expect(await b.store.apply(a.store.export(0))).toBe(true)
    b.db.exec("UPDATE new_sessions SET project_dir='/b' WHERE id='s'")
    const before = b.store.revision()
    b.db.exec("UPDATE deepchat_user_messages SET text='edited on B' WHERE message_id='m'")
    expect(b.store.revision()).toBeGreaterThan(before)
    expect(await a.store.apply(b.store.export(0))).toBe(true)
    expect(a.db.prepare('SELECT text FROM deepchat_user_messages').get()).toEqual({
      text: 'edited on B'
    })
    expect(a.db.prepare('SELECT project_dir FROM new_sessions').get()).toEqual({
      project_dir: '/a'
    })
    const revision = a.store.revision()
    await a.store.apply(b.store.export(0))
    expect(a.store.revision()).toBe(revision)
    a.restart()
    expect(a.store.revision()).toBe(revision)
  })

  it('retains deletions through restart and does not publish rolled-back writes', async () => {
    const a = device(),
      b = device()
    a.db.exec("INSERT INTO new_sessions VALUES('s','First',NULL,1,1)")
    const old = a.store.export(0)
    await b.store.apply(old)
    a.db.exec("DELETE FROM new_sessions WHERE id='s'")
    a.restart()
    await b.store.apply(a.store.export(b.store.cursor(a.store.replicaId)))
    expect(b.db.prepare('SELECT * FROM new_sessions').all()).toEqual([])
    await b.store.apply(old)
    expect(b.db.prepare('SELECT * FROM new_sessions').all()).toEqual([])
    const revision = a.store.revision()
    expect(() =>
      a.db.transaction(() => {
        a.db.exec("INSERT INTO new_sessions VALUES('rolled','No',NULL,1,1)")
        throw new Error('rollback')
      })()
    ).toThrow('rollback')
    expect(a.store.revision()).toBe(revision)
  })

  it('tracks writes from a connection without the local notification function', () => {
    const a = device()
    const writer = new (requireDatabase())(a.db.name)
    try {
      writer.exec("INSERT INTO new_sessions VALUES('external','From another connection',NULL,1,1)")
      expect(a.store.export(0).units.map((unit) => unit.id)).toContain('external')
    } finally {
      writer.close()
    }
  })

  it('waits for an active session without acknowledging it, and rejects unrelated rows atomically', async () => {
    const a = device(),
      b = device()
    a.db.exec("INSERT INTO new_sessions VALUES('s','First',NULL,1,1)")
    const batch = a.store.export(0)
    b.busy(true)
    expect(await b.store.apply(batch)).toBe(false)
    expect(b.store.cursor(a.store.replicaId)).toBe(0)
    b.busy(false)
    const invalid = structuredClone(batch)
    invalid.units[0].tables.new_sessions[0].id = 'another-session'
    await expect(b.store.apply(invalid)).rejects.toThrow('Invalid sync root')
    expect(b.store.cursor(a.store.replicaId)).toBe(0)
    expect(b.db.prepare('SELECT * FROM new_sessions').all()).toEqual([])
    expect(await b.store.apply(batch)).toBe(true)
  })

  it('rejects a future peer timestamp without advancing its delivery cursor', async () => {
    const a = device(),
      b = device()
    a.db.exec("INSERT INTO new_sessions VALUES('s','First',NULL,1,1)")
    const batch = a.store.export(0)
    batch.units[0].modifiedAt = Number.MAX_SAFE_INTEGER
    await expect(b.store.apply(batch)).rejects.toThrow('clockSkew')
    expect(b.store.cursor(a.store.replicaId)).toBe(0)
  })
  it('preserves memory deletion and local session revisions with the complete application schema', async () => {
    function fullDevice() {
      const directory = mkdtempSync(join(tmpdir(), 'deepchat-replica-full-'))
      const main = new MainDatabase(join(directory, 'agent.db'))
      const db = main.getDatabase()
      const store = new SyncReplicaStore({
        directory,
        database: () => db,
        canApply: () => true,
        applied: () => {}
      })
      cleanups.push(() => {
        store.close()
        main.close()
        rmSync(directory, { recursive: true, force: true })
      })
      return { db, store }
    }
    const a = fullDevice(),
      b = fullDevice()
    for (const [device, id] of [
      [a, 'a-memory'],
      [b, 'b-memory']
    ] as const) {
      device.db
        .prepare(
          "INSERT INTO agent_memory(id,agent_id,kind,content,created_at) VALUES(?,'agent','semantic','Remember this',1)"
        )
        .run(id)
    }
    a.db.exec(
      "INSERT INTO app_settings(key,value_json,sensitive,updated_at) VALUES('copyWithCotEnabled','true',0,1)"
    )
    await b.store.apply(a.store.export(0))
    expect(
      b.db.prepare("SELECT value_json FROM app_settings WHERE key='copyWithCotEnabled'").get()
    ).toEqual({ value_json: 'true' })
    a.db.exec(
      "INSERT INTO new_sessions(id,agent_id,title,created_at,updated_at,revision) VALUES('s','agent','Original',1,1,100)"
    )
    await b.store.apply(a.store.export(b.store.cursor(a.store.replicaId)))
    b.db.exec("UPDATE new_sessions SET title='Continued on B',revision=revision+1 WHERE id='s'")
    await a.store.apply(b.store.export(0))
    expect(a.db.prepare("SELECT title,revision FROM new_sessions WHERE id='s'").get()).toEqual({
      title: 'Continued on B',
      revision: 101
    })
    const tombstones = buildMemoryTombstoneIdentities({
      agentId: 'agent',
      content: 'Remember this',
      provenanceKey: null,
      scope: { type: 'agent' }
    })
    for (const identity of tombstones)
      a.db
        .prepare("INSERT INTO agent_memory_tombstone VALUES('agent',?,?,2,'selective_delete')")
        .run(identity.identityKind, identity.identityHash)
    a.db.exec("DELETE FROM agent_memory WHERE id='a-memory'")
    await b.store.apply(a.store.export(b.store.cursor(a.store.replicaId)))
    expect(b.db.prepare('SELECT id FROM agent_memory').all()).toEqual([])
    await a.store.apply(b.store.export(0))
    expect(a.db.prepare('SELECT id FROM agent_memory').all()).toEqual([])
  })
})
