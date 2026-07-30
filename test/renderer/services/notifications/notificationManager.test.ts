import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationManager, type NotificationPresenter } from '@renderer-notifications'
import { FakeNotificationTime } from '../../../helpers/fakeNotificationTime'

type Presentation = {
  record: Parameters<NotificationPresenter['present']>[0]
  options: Parameters<NotificationPresenter['present']>[1]
  events: Parameters<NotificationPresenter['present']>[2]
  dismiss: ReturnType<typeof vi.fn>
}

const createPresenter = () => {
  const presentations: Presentation[] = []
  const presenter: NotificationPresenter = {
    present: (record, options, events) => {
      const presentation: Presentation = {
        record,
        options,
        events,
        dismiss: vi.fn()
      }
      presentations.push(presentation)
      return { dismiss: presentation.dismiss }
    }
  }
  return { presenter, presentations }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NotificationManager', () => {
  it('delivers per-request lifecycle events, including synchronous policy drops', () => {
    const time = new FakeNotificationTime()
    const { presenter } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })
    const onLifecycleEvent = vi.fn()

    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      title: 'Connection failed'
    })
    manager.notify(
      {
        kind: 'success',
        code: 'settings.saved',
        title: 'Saved'
      },
      { onLifecycleEvent }
    )

    expect(onLifecycleEvent).toHaveBeenCalledOnce()
    expect(onLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'programmatic',
        requests: [expect.objectContaining({ code: 'settings.saved' })]
      })
    )
  })

  it('preserves a surface-reclaimed close reason from its handle', () => {
    const time = new FakeNotificationTime()
    const { presenter } = createPresenter()
    const onLifecycleEvent = vi.fn()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })
    const handle = manager.notify(
      {
        kind: 'error',
        code: 'settings.saveFailed',
        title: 'Save failed'
      },
      { onLifecycleEvent }
    )

    handle.dismiss('surface-reclaimed')

    expect(onLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'surface-reclaimed' })
    )
  })

  it('registers an aggregate lifecycle listener before record subscribers can close it', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })
    const first = manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      title: 'Connection failed'
    })
    const onLifecycleEvent = vi.fn()
    presentations[0].record.subscribe(() => {
      first.dismiss()
    })

    manager.notify(
      {
        kind: 'error',
        code: 'mcp.connectionFailed',
        key: 'server-a',
        title: 'Connection still failing'
      },
      { onLifecycleEvent }
    )

    expect(onLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'programmatic' })
    )
  })

  it('uses native content only for non-aggregating success and information', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })

    manager.notify({
      kind: 'success',
      code: 'settings.saved',
      title: 'Saved'
    })
    expect(presentations[0].options.content).toBe('native')
    presentations[0].events.onClosed('auto')

    manager.notify({
      kind: 'success',
      code: 'sync.completed',
      key: 'sync-a',
      title: 'Sync complete'
    })
    expect(presentations[1].options.content).toBe('managed')
  })

  it('aggregates a stable identity without presenting or extending its deadline again', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })

    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      scope: 'mcp.connection',
      title: 'Connection failed'
    })
    time.advanceBy(20_000)
    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      scope: 'mcp.connection',
      title: 'Connection failed'
    })

    expect(presentations).toHaveLength(1)
    expect(presentations[0].record.getSnapshot().occurrenceCount).toBe(2)

    time.advanceBy(39_999)
    expect(presentations[0].dismiss).not.toHaveBeenCalled()
    time.advanceBy(1)
    expect(presentations[0].dismiss).toHaveBeenCalledOnce()
  })

  it('preempts lower priority transient feedback and keeps one useful candidate', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const diagnostics = { record: vi.fn() }
    const manager = new NotificationManager({
      presenter,
      clock: time,
      scheduler: time,
      diagnostics
    })

    manager.notify({
      kind: 'info',
      code: 'clipboard.copied',
      title: 'Copied'
    })
    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      title: 'Connection failed'
    })
    manager.notify({
      kind: 'warning',
      code: 'settings.retryRecommended',
      key: 'settings-retry',
      title: 'Retry recommended'
    })
    manager.notify({
      kind: 'success',
      code: 'settings.saved',
      title: 'Saved'
    })

    expect(presentations.map(({ record }) => record.getSnapshot().code)).toEqual([
      'clipboard.copied',
      'mcp.connectionFailed'
    ])
    expect(presentations[0].dismiss).toHaveBeenCalledOnce()
    expect(diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'settings.saved',
        reason: 'lower-priority'
      })
    )

    presentations[1].events.onClosed('auto')
    expect(presentations[2].record.getSnapshot().code).toBe('settings.retryRecommended')
  })

  it('bounds actionable arbitration and reports the pending count', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const diagnostics = { record: vi.fn() }
    const manager = new NotificationManager({
      presenter,
      clock: time,
      scheduler: time,
      diagnostics
    })
    const action = { label: 'Open', onClick: vi.fn() }

    for (let index = 0; index < 5; index += 1) {
      manager.notify({
        kind: 'actionable',
        code: `action.${index}`,
        key: `action-${index}`,
        title: `Action ${index}`,
        action
      })
      time.advanceBy(1)
    }

    expect(presentations).toHaveLength(1)
    expect(presentations[0].record.getSnapshot().pendingCount).toBe(3)
    expect(diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'action.4',
        reason: 'actionable-overflow'
      })
    )

    presentations[0].events.onClosed('dismissed')
    expect(presentations).toHaveLength(2)
    expect(presentations[1].record.getSnapshot().code).toBe('action.1')
    expect(presentations[1].record.getSnapshot().pendingCount).toBe(2)
  })

  it('suspends progress for actionable feedback and resumes it afterwards', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })

    manager.notify({
      kind: 'progress',
      code: 'model.download',
      operationId: 'download:model-a',
      title: 'Downloading',
      progress: 0.25
    })
    manager.notify({
      kind: 'actionable',
      code: 'database.repairSuggested',
      key: 'database-repair',
      title: 'Repair required',
      action: { label: 'Repair', onClick: vi.fn() }
    })

    expect(presentations[0].dismiss).toHaveBeenCalledOnce()
    expect(presentations[1].record.getSnapshot().code).toBe('database.repairSuggested')

    manager.notify({
      kind: 'progress',
      code: 'model.download',
      operationId: 'download:model-a',
      title: 'Downloading',
      progress: 0.75
    })
    presentations[1].events.onClosed('action')

    expect(presentations[2].record.getSnapshot()).toMatchObject({
      code: 'model.download',
      progress: 0.75
    })
  })

  it('lets higher priority actionable feedback preempt and then resume the current item', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })
    const action = { label: 'Open', onClick: vi.fn() }

    manager.notify({
      kind: 'actionable',
      code: 'account.reauthenticate',
      key: 'account',
      title: 'Sign in again',
      action
    })
    manager.notify({
      kind: 'actionable',
      code: 'database.repairSuggested',
      key: 'database',
      title: 'Repair required',
      urgency: 'critical',
      retention: 'until-resolved',
      action
    })

    expect(presentations[0].dismiss).toHaveBeenCalledOnce()
    expect(presentations[1].record.getSnapshot()).toMatchObject({
      code: 'database.repairSuggested',
      pendingCount: 1
    })

    presentations[1].events.onClosed('action')
    expect(presentations[2].record.getSnapshot().code).toBe('account.reauthenticate')
  })

  it('refreshes candidate freshness without extending an active presentation deadline', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })

    manager.notify({
      kind: 'error',
      code: 'sync.failed',
      key: 'sync',
      title: 'Sync failed'
    })
    manager.notify({
      kind: 'warning',
      code: 'settings.retryRecommended',
      key: 'retry',
      title: 'Retry recommended'
    })
    time.advanceBy(7_000)
    manager.notify({
      kind: 'warning',
      code: 'settings.retryRecommended',
      key: 'retry',
      title: 'Retry recommended'
    })
    time.advanceBy(2_000)

    presentations[0].events.onClosed('auto')
    expect(presentations[1].record.getSnapshot()).toMatchObject({
      code: 'settings.retryRecommended',
      occurrenceCount: 2
    })
  })

  it('keeps a dismissed progress operation suppressed until completion', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })

    manager.notify({
      kind: 'progress',
      code: 'model.download',
      operationId: 'download:model-a',
      title: 'Downloading',
      progress: 0.1
    })
    presentations[0].events.onClosed('dismissed')
    manager.notify({
      kind: 'progress',
      code: 'model.download',
      operationId: 'download:model-a',
      title: 'Downloading',
      progress: 0.9
    })

    expect(presentations).toHaveLength(1)
    expect(() => manager.completeProgress('   ')).toThrow('must not be empty')
    manager.completeProgress('download:model-a')

    manager.notify({
      kind: 'progress',
      code: 'model.download',
      operationId: 'download:model-b',
      title: 'Downloading another model',
      progress: 0.2
    })
    expect(presentations).toHaveLength(2)
  })

  it('does not aggregate unrelated codes that share a scope', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })

    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      scope: 'mcp',
      title: 'Connection failed'
    })
    manager.notify({
      kind: 'error',
      code: 'mcp.toolListFailed',
      key: 'server-a',
      scope: 'mcp',
      title: 'Tool list failed'
    })

    expect(presentations[0].record.getSnapshot().occurrenceCount).toBe(1)
    presentations[0].events.onClosed('auto')
    expect(presentations[1].record.getSnapshot().code).toBe('mcp.toolListFailed')
  })

  it('removes recovered entities without closing a still-active aggregate', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })

    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      scope: 'mcp.connection',
      title: 'Server A failed'
    })
    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      key: 'server-b',
      scope: 'mcp.connection',
      title: 'Server B failed'
    })

    expect(presentations[0].record.getSnapshot()).toMatchObject({
      occurrenceCount: 2,
      entityCount: 2,
      title: 'Server B failed'
    })

    manager.recover({
      kind: 'transient',
      code: 'mcp.connectionFailed',
      key: 'server-b',
      scope: 'mcp.connection'
    })
    expect(presentations[0].record.getSnapshot()).toMatchObject({
      entityCount: 1,
      title: 'Server A failed'
    })
    expect(presentations[0].dismiss).not.toHaveBeenCalled()

    manager.recover({
      kind: 'transient',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      scope: 'mcp.connection'
    })
    expect(presentations[0].dismiss).toHaveBeenCalledOnce()
  })

  it('reports every member when a scoped presentation is dismissed', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const onLifecycleEvent = vi.fn()
    const manager = new NotificationManager({
      presenter,
      clock: time,
      scheduler: time,
      onLifecycleEvent
    })

    for (const server of ['server-a', 'server-b']) {
      manager.notify({
        kind: 'error',
        code: 'mcp.connectionFailed',
        key: server,
        scope: 'mcp.connection',
        title: `${server} failed`
      })
    }
    presentations[0].events.onClosed('dismissed')

    expect(onLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'dismissed',
        requests: [
          expect.objectContaining({ key: 'server-a' }),
          expect.objectContaining({ key: 'server-b' })
        ]
      })
    )
  })

  it('keeps the original actionable queue expiry when occurrences are aggregated', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const diagnostics = { record: vi.fn() }
    const manager = new NotificationManager({
      presenter,
      clock: time,
      scheduler: time,
      diagnostics
    })
    const action = { label: 'Open', onClick: vi.fn() }

    manager.notify({
      kind: 'actionable',
      code: 'account.reauthenticate',
      key: 'account-a',
      title: 'Sign in again',
      action
    })
    manager.notify({
      kind: 'actionable',
      code: 'provider.reconnect',
      key: 'provider-a',
      title: 'Reconnect provider',
      action
    })

    time.advanceBy(9 * 60_000)
    manager.notify({
      kind: 'actionable',
      code: 'provider.reconnect',
      key: 'provider-a',
      title: 'Reconnect provider',
      action
    })
    time.advanceBy(60_000)
    presentations[0].events.onClosed('action')

    expect(presentations).toHaveLength(1)
    expect(diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'provider.reconnect',
        reason: 'actionable-expired'
      })
    )
  })

  it('rejects semantic or progress regression for an active operation', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })

    manager.notify({
      kind: 'progress',
      code: 'model.download',
      operationId: 'download:model-a',
      title: 'Downloading',
      progress: 0.6
    })

    expect(() =>
      manager.notify({
        kind: 'progress',
        code: 'model.install',
        operationId: 'download:model-a',
        title: 'Installing',
        progress: 0.7
      })
    ).toThrow('contract changed')
    expect(() =>
      manager.notify({
        kind: 'progress',
        code: 'model.download',
        operationId: 'download:model-a',
        title: 'Downloading',
        progress: 0.5
      })
    ).toThrow('must not move backwards')
    expect(presentations[0].record.getSnapshot()).toMatchObject({
      code: 'model.download',
      progress: 0.6
    })
  })

  it('isolates presenter and diagnostics failures from notification callers', () => {
    const time = new FakeNotificationTime()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const records: string[] = []
    let presentCall = 0
    const presenter: NotificationPresenter = {
      present: (record) => {
        presentCall += 1
        if (presentCall === 2) {
          throw new Error('adapter unavailable')
        }
        records.push(record.getSnapshot().code)
        return {
          dismiss:
            presentCall === 1
              ? () => {
                  throw new Error('adapter dismissal unavailable')
                }
              : vi.fn()
        }
      }
    }
    const manager = new NotificationManager({
      presenter,
      clock: time,
      scheduler: time,
      diagnostics: {
        record: () => {
          throw new Error('metrics unavailable')
        }
      }
    })

    manager.notify({
      kind: 'progress',
      code: 'model.download',
      operationId: 'download:model-a',
      title: 'Downloading'
    })
    expect(() =>
      manager.notify({
        kind: 'actionable',
        code: 'database.repairSuggested',
        key: 'database',
        title: 'Repair required',
        action: { label: 'Repair', onClick: vi.fn() }
      })
    ).not.toThrow()
    expect(records).toEqual(['model.download', 'model.download'])

    manager.notify({
      kind: 'success',
      code: 'settings.saved',
      title: 'Saved'
    })
    expect(() =>
      manager.notify({
        kind: 'info',
        code: 'clipboard.copied',
        title: 'Copied'
      })
    ).not.toThrow()
    expect(() =>
      manager.notify({
        kind: 'success',
        code: 'settings.savedAgain',
        title: 'Saved'
      })
    ).not.toThrow()
    expect(consoleError).toHaveBeenCalled()
  })

  it('isolates record subscribers while preserving aggregate state', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      title: 'Connection failed'
    })
    presentations[0].record.subscribe(() => {
      throw new Error('component listener failed')
    })

    expect(() =>
      manager.notify({
        kind: 'error',
        code: 'mcp.connectionFailed',
        key: 'server-a',
        title: 'Connection failed'
      })
    ).not.toThrow()
    expect(presentations[0].record.getSnapshot().occurrenceCount).toBe(2)
    expect(consoleError).toHaveBeenCalled()
  })

  it('retains final member context when recovery closes an aggregate', () => {
    const time = new FakeNotificationTime()
    const { presenter } = createPresenter()
    const onLifecycleEvent = vi.fn()
    const manager = new NotificationManager({
      presenter,
      clock: time,
      scheduler: time,
      onLifecycleEvent
    })

    for (const server of ['server-a', 'server-b']) {
      manager.notify({
        kind: 'error',
        code: 'mcp.connectionFailed',
        key: server,
        scope: 'mcp.connection',
        title: 'Connection failed'
      })
    }
    manager.recover({
      kind: 'transient',
      code: 'mcp.connectionFailed',
      key: 'server-b',
      scope: 'mcp.connection'
    })
    onLifecycleEvent.mockClear()
    manager.recover({
      kind: 'transient',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      scope: 'mcp.connection'
    })

    expect(onLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'programmatic',
        requests: [expect.objectContaining({ key: 'server-a' })]
      })
    )
  })

  it('finishes slot arbitration before dispatching reentrant lifecycle observers', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    let manager: NotificationManager
    const onLifecycleEvent = vi.fn((event) => {
      if (event.reason === 'preempted') {
        manager.notify({
          kind: 'warning',
          code: 'settings.retryRecommended',
          key: 'settings',
          title: 'Retry recommended'
        })
      }
    })
    manager = new NotificationManager({
      presenter,
      clock: time,
      scheduler: time,
      onLifecycleEvent
    })

    manager.notify({
      kind: 'info',
      code: 'clipboard.copied',
      title: 'Copied'
    })
    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      title: 'Connection failed'
    })

    expect(presentations.map(({ record }) => record.getSnapshot().code)).toEqual([
      'clipboard.copied',
      'mcp.connectionFailed'
    ])
    presentations[1].events.onClosed('auto')
    expect(presentations[2].record.getSnapshot().code).toBe('settings.retryRecommended')
  })

  it('keeps until-resolved actionable feedback queued without a TTL', () => {
    const time = new FakeNotificationTime()
    const { presenter, presentations } = createPresenter()
    const manager = new NotificationManager({ presenter, clock: time, scheduler: time })
    const action = { label: 'Repair', onClick: vi.fn() }

    for (const key of ['database-a', 'database-b']) {
      manager.notify({
        kind: 'actionable',
        code: 'database.repairSuggested',
        key,
        title: 'Repair required',
        retention: 'until-resolved',
        action
      })
    }

    time.advanceBy(60 * 60_000)
    presentations[0].events.onClosed('action')

    expect(presentations[1].record.getSnapshot().code).toBe('database.repairSuggested')
  })

  it('handles a presenter that closes synchronously during initial presentation', () => {
    const time = new FakeNotificationTime()
    const presented: string[] = []
    const onLifecycleEvent = vi.fn()
    const presenter: NotificationPresenter = {
      present: (record, _options, events) => {
        presented.push(record.getSnapshot().code)
        events.onClosed('auto')
        return { dismiss: vi.fn() }
      }
    }
    const manager = new NotificationManager({
      presenter,
      clock: time,
      scheduler: time,
      onLifecycleEvent
    })

    expect(() =>
      manager.notify({
        kind: 'info',
        code: 'clipboard.copied',
        title: 'Copied'
      })
    ).not.toThrow()
    manager.notify({
      kind: 'error',
      code: 'mcp.connectionFailed',
      key: 'server-a',
      title: 'Connection failed'
    })

    expect(presented).toEqual(['clipboard.copied', 'mcp.connectionFailed'])
    expect(onLifecycleEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'auto',
        requests: [expect.objectContaining({ code: 'clipboard.copied' })]
      })
    )
  })
})
