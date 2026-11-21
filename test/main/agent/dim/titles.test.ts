import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { DimTitles } from '@/agent/dim/titles'
import type { DimRuntimeSupervisor } from '@/agent/dim/runtimeSupervisor'
import { dimDatabase } from './fixtures/database'

function fixture() {
  const database = dimDatabase()
  database.data.newSessionsTable.create('product', 'agent', 'Placeholder', null)
  const binding = database.data.dimSessionBindingsTable.bind('product', 'native')
  let title = 'Native auto title'
  const call = vi.fn(async () => ({
    sessionId: 'native',
    title: { text: title, source: 'auto' },
    titleRevision: '9007199254740993'
  }))
  const observer = Object.assign(new EventEmitter(), {
    call: vi.fn(async () => ({})),
    close: vi.fn()
  })
  const host = {
    start: async () => ({ call }),
    openConnection: async () => observer
  } as unknown as DimRuntimeSupervisor
  const project = vi.fn((id: string, title: string) =>
    database.data.newSessionsTable.update(id, { title })
  )
  const titles = new DimTitles({ database: database.data, host, project })
  return {
    ...database,
    binding,
    call,
    observer,
    project,
    titles,
    host,
    setTitle: (value: string) => {
      title = value
    }
  }
}

it('subscribes before reading metadata and refreshes only its owner notices, with disposal', async () => {
  const { data, sqlite, binding, call, observer, titles, setTitle } = fixture()
  try {
    await titles.open(binding)
    expect(observer.call).toHaveBeenCalledWith('session.attach', { sessionId: 'native' })
    expect(data.newSessionsTable.get('product')?.title).toBe('Native auto title')
    setTitle('Native changed title')
    observer.emit('notification', {
      method: 'session.notice',
      params: { sessionId: 'other', source: 'SessionStore', kind: 'title' }
    })
    expect(call).toHaveBeenCalledTimes(1)
    observer.emit('notification', {
      method: 'session.notice',
      params: { sessionId: 'native', source: 'SessionStore', kind: 'title' }
    })
    await vi.waitFor(() =>
      expect(data.newSessionsTable.get('product')?.title).toBe('Native changed title')
    )
    await titles.close('product')
    expect(observer.close).toHaveBeenCalledOnce()
    observer.emit('notification', {
      method: 'session.notice',
      params: { sessionId: 'native', source: 'SessionStore', kind: 'title' }
    })
    expect(call).toHaveBeenCalledTimes(2)
  } finally {
    await titles.close('product')
    sqlite.close()
  }
})

it('discards a title read from a replaced generation', async () => {
  const { data, sqlite, binding, call, project, titles } = fixture()
  let resolve!: (value: Awaited<ReturnType<typeof call>>) => void
  call.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  try {
    const refreshing = titles.refresh(binding)
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce())
    data.dimSessionBindingsTable.replace(binding, {
      ...binding,
      dimSessionId: 'replacement',
      generation: 2
    })
    resolve({
      sessionId: 'native',
      title: { text: 'Stale title', source: 'auto' },
      titleRevision: '99'
    })
    await refreshing
    expect(project).not.toHaveBeenCalled()
  } finally {
    sqlite.close()
  }
})

it('closes a connection that completes after its subscription was revoked', async () => {
  const { sqlite, binding, host, observer, titles } = fixture()
  let resolve!: (client: typeof observer) => void
  const connection = vi.fn(
    () =>
      new Promise<typeof observer>((done) => {
        resolve = done
      })
  )
  host.openConnection = connection as unknown as DimRuntimeSupervisor['openConnection']
  try {
    const opening = titles.open(binding)
    const rejected = expect(opening).rejects.toThrow('closed before attachment')
    await vi.waitFor(() => expect(connection).toHaveBeenCalledOnce())
    await titles.close('product')
    resolve(observer)
    await rejected
    expect(observer.close).toHaveBeenCalledOnce()
    expect(observer.call).not.toHaveBeenCalled()
  } finally {
    sqlite.close()
  }
})
