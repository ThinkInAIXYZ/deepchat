import { describe, expect, it, vi } from 'vitest'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'
import { AcpSessionController, type AcpSessionRecord } from '@/agent/acp/runtime'
import { AcpSessionManager } from '@/agent/acp/runtime/acpSessionManager'
import { toAcpRemoteSessionId, toAppSessionId } from '@/agent/shared/agentSessionIds'

describe('AcpSessionController', () => {
  it('maps capability updates once for provider and direct consumers and persists metadata', async () => {
    let hooks: any
    const session = {
      sessionId: toAcpRemoteSessionId('remote'),
      connection: {},
      detachHandlers: [],
      workdir: '/workspace',
      providerId: 'acp',
      agentId: 'agent',
      conversationId: 'session',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      metadata: {},
      currentModeId: 'default',
      availableModes: [{ id: 'default', name: 'Default', description: '' }],
      availableCommands: []
    } as unknown as AcpSessionRecord
    const sessionManager = {
      getOrCreateSession: vi.fn(async (_conversationId, _agent, nextHooks) => {
        hooks = nextHooks
        return session
      }),
      getSession: vi.fn(() => session),
      clearSession: vi.fn()
    }
    const processManager = {
      updateBoundProcessMode: vi.fn(() => true),
      updateBoundProcessConfigState: vi.fn(() => true)
    }
    const persistence = {
      mergeMetadata: vi.fn(async () => undefined)
    }
    const events = {
      modesReady: vi.fn(),
      configOptionsReady: vi.fn(),
      commandsReady: vi.fn()
    }
    const onEvents = vi.fn()
    const controller = new AcpSessionController(
      sessionManager as never,
      processManager as never,
      persistence as never,
      events
    )
    await controller.open(
      toAppSessionId('session'),
      { id: 'agent', name: 'Agent', command: 'agent' },
      { onEvents, onPermission: vi.fn() },
      '/workspace'
    )

    const notify = (update: schema.SessionNotification['update']) =>
      hooks.onSessionUpdate({ sessionId: 'remote', update })
    notify({ sessionUpdate: 'current_mode_update', currentModeId: 'architect' })
    notify({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: ' review ', description: ' Run review ' }]
    })
    notify({
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          id: 'safe_edits',
          name: 'Safe Edits',
          type: 'boolean',
          currentValue: true
        }
      ]
    })
    notify({
      sessionUpdate: 'session_info_update',
      title: 'Remote title',
      updatedAt: '2026-07-13T00:00:00.000Z'
    })
    notify({ sessionUpdate: 'usage_update', used: 4, size: 10 })
    await vi.waitFor(() => expect(persistence.mergeMetadata).toHaveBeenCalledTimes(2))

    expect(onEvents).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'reasoning', reasoning_content: 'Mode changed to: architect' })
    ])
    expect(session.currentModeId).toBe('architect')
    expect(session.availableCommands).toEqual([
      { name: 'review', description: 'Run review', input: null }
    ])
    expect(processManager.updateBoundProcessConfigState).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ source: 'configOptions' })
    )
    expect(events.modesReady).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: 'session', current: 'architect' })
    )
    expect(events.configOptionsReady).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId: 'session',
        configState: expect.objectContaining({ source: 'configOptions' })
      })
    )
    expect(events.commandsReady).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversationId: 'session',
        commands: [{ name: 'review', description: 'Run review', input: null }]
      })
    )
    expect(session.metadata).toMatchObject({
      acpSessionInfo: { title: 'Remote title' },
      acpUsage: { used: 4, size: 10 }
    })
  })

  it('clears the prior remote binding before persisting a changed workdir', async () => {
    const calls: string[] = []
    const controller = new AcpSessionController(
      {
        getSession: vi.fn(),
        clearSession: vi.fn(async () => {
          calls.push('session.clear')
        })
      } as never,
      {} as never,
      {
        isWorkdirUsable: vi.fn(() => true),
        getSessionData: vi.fn(async () => ({ workdir: '/old' })),
        resolveWorkdir: vi.fn((workdir?: string | null) => workdir ?? '/default'),
        clearSession: vi.fn(async () => {
          calls.push('binding.clear')
        }),
        updateWorkdir: vi.fn(async () => {
          calls.push('workdir.persist')
        })
      } as never
    )

    await controller.updateWorkdir(toAppSessionId('session'), 'agent', '/new')

    expect(calls).toEqual(['session.clear', 'binding.clear', 'workdir.persist'])
  })

  it('flushes process updates after the real session record becomes visible', async () => {
    const earlyUpdates: schema.SessionNotification['update'][] = [
      { sessionUpdate: 'current_mode_update', currentModeId: 'architect' },
      {
        sessionUpdate: 'config_option_update',
        configOptions: [
          {
            id: 'safe_edits',
            name: 'Safe Edits',
            type: 'boolean',
            currentValue: true
          }
        ]
      },
      {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'review', description: 'Run review' }]
      },
      {
        sessionUpdate: 'session_info_update',
        title: 'Early title',
        updatedAt: '2026-07-13T00:00:00.000Z'
      },
      { sessionUpdate: 'usage_update', used: 2, size: 8 }
    ]
    const processManager = {
      getConnection: vi.fn(async () => ({
        connection: {
          newSession: vi.fn(async () => ({ sessionId: 'remote-early' }))
        }
      })),
      bindProcess: vi.fn(),
      unbindProcess: vi.fn(),
      registerSessionWorkdir: vi.fn(),
      registerSessionListener: vi.fn((_agentId, sessionId, handler) => {
        earlyUpdates.forEach((update) => handler({ sessionId, update }))
        return vi.fn()
      }),
      registerPermissionResolver: vi.fn(() => vi.fn()),
      registerProcessExitHandler: vi.fn(() => vi.fn()),
      clearSession: vi.fn(),
      updateBoundProcessMode: vi.fn(() => true),
      updateBoundProcessConfigState: vi.fn(() => true)
    }
    const persistence = {
      resolveWorkdir: vi.fn((workdir?: string | null) => workdir ?? '/workspace'),
      getSessionData: vi.fn(async () => null),
      saveSessionData: vi.fn(async () => undefined),
      clearSession: vi.fn(async () => undefined),
      mergeMetadata: vi.fn(async () => undefined)
    }
    const sessionManager = new AcpSessionManager({
      providerId: 'acp',
      processManager: processManager as never,
      sessionPersistence: persistence as never,
      providerSettings: {
        getAgentMcpSelections: vi.fn(async () => [])
      } as never,
      mcpSettings: {
        getMcpServers: vi.fn(async () => ({}))
      } as never
    })
    const events = {
      modesReady: vi.fn(),
      configOptionsReady: vi.fn(),
      commandsReady: vi.fn()
    }
    const onEvents = vi.fn()
    const controller = new AcpSessionController(
      sessionManager,
      processManager as never,
      persistence as never,
      events
    )

    const session = await controller.open(
      toAppSessionId('early-conversation'),
      { id: 'agent', name: 'Agent', command: 'agent' },
      { onEvents, onPermission: vi.fn() },
      '/workspace'
    )
    await vi.waitFor(() => expect(persistence.mergeMetadata).toHaveBeenCalledTimes(2))

    expect(sessionManager.getSession('early-conversation')).toBe(session)
    expect(session.currentModeId).toBe('architect')
    expect(session.configState).toMatchObject({ source: 'configOptions' })
    expect(session.availableCommands).toEqual([
      { name: 'review', description: 'Run review', input: null }
    ])
    expect(session.metadata).toMatchObject({
      acpSessionInfo: { title: 'Early title' },
      acpUsage: { used: 2, size: 8 }
    })
    expect(onEvents.mock.calls.flat(2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'reasoning',
          reasoning_content: 'Mode changed to: architect'
        })
      ])
    )
    expect(events.commandsReady).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'early-conversation',
        commands: [{ name: 'review', description: 'Run review', input: null }]
      })
    )
  })

  it('replays only updates from the successful restore attempt', async () => {
    const listeners = new Map<string, Set<(notification: schema.SessionNotification) => void>>()
    const buffered = new Map<string, schema.SessionNotification[]>()
    const dispatch = (notification: schema.SessionNotification) => {
      const active = listeners.get(notification.sessionId)
      if (active?.size) {
        active.forEach((listener) => listener(notification))
      } else {
        const pending = buffered.get(notification.sessionId) ?? []
        pending.push(notification)
        buffered.set(notification.sessionId, pending)
      }
    }
    const notify = (sessionId: string, update: schema.SessionNotification['update']) =>
      dispatch({ sessionId, update })
    const connection = {
      unstable_resumeSession: vi.fn(async () => {
        notify('persisted-session', {
          sessionUpdate: 'current_mode_update',
          currentModeId: 'dead-resume'
        })
        notify('persisted-session', {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'dead-resume', description: 'Dead resume' }]
        })
        notify('persisted-session', {
          sessionUpdate: 'session_info_update',
          title: 'Dead resume'
        })
        throw new Error('resume failed')
      }),
      loadSession: vi.fn(async () => {
        notify('persisted-session', {
          sessionUpdate: 'current_mode_update',
          currentModeId: 'dead-load'
        })
        notify('persisted-session', {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'dead-load', description: 'Dead load' }]
        })
        notify('persisted-session', { sessionUpdate: 'usage_update', used: 7, size: 8 })
        throw new Error('load failed')
      }),
      newSession: vi.fn(async () => {
        notify('new-session', {
          sessionUpdate: 'current_mode_update',
          currentModeId: 'new-mode'
        })
        notify('new-session', {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'new-command', description: 'Live command' }]
        })
        notify('new-session', {
          sessionUpdate: 'session_info_update',
          title: 'Live session'
        })
        notify('new-session', { sessionUpdate: 'usage_update', used: 2, size: 8 })
        return { sessionId: 'new-session' }
      })
    }
    const processManager = {
      getConnection: vi.fn(async () => ({
        connection,
        supportsSessionResume: true,
        supportsLoadSession: true
      })),
      bindProcess: vi.fn(),
      unbindProcess: vi.fn(),
      registerSessionWorkdir: vi.fn(),
      registerSessionListener: vi.fn((_agentId, sessionId, handler) => {
        const active = listeners.get(sessionId) ?? new Set()
        active.add(handler)
        listeners.set(sessionId, active)
        buffered
          .get(sessionId)
          ?.splice(0)
          .forEach((notification) => handler(notification))
        return () => active.delete(handler)
      }),
      registerPermissionResolver: vi.fn(() => vi.fn()),
      registerProcessExitHandler: vi.fn(() => vi.fn()),
      clearSession: vi.fn((sessionId) => {
        listeners.delete(sessionId)
        buffered.delete(sessionId)
      }),
      updateBoundProcessConfigState: vi.fn(() => true)
    }
    const persistence = {
      resolveWorkdir: vi.fn((workdir?: string | null) => workdir ?? '/workspace'),
      getSessionData: vi.fn(async () => ({
        sessionId: 'persisted-session',
        workdir: '/workspace'
      })),
      saveSessionData: vi.fn(async () => undefined),
      clearSession: vi.fn(async () => undefined),
      mergeMetadata: vi.fn(async () => undefined)
    }
    const sessionManager = new AcpSessionManager({
      providerId: 'acp',
      processManager: processManager as never,
      sessionPersistence: persistence as never,
      providerSettings: {
        getAgentMcpSelections: vi.fn(async () => [])
      } as never,
      mcpSettings: {
        getMcpServers: vi.fn(async () => ({}))
      } as never
    })
    const events = {
      modesReady: vi.fn(),
      configOptionsReady: vi.fn(),
      commandsReady: vi.fn()
    }
    const onEvents = vi.fn()
    const controller = new AcpSessionController(
      sessionManager,
      processManager as never,
      persistence as never,
      events
    )

    const session = await controller.open(
      toAppSessionId('restore-conversation'),
      { id: 'agent', name: 'Agent', command: 'agent' },
      { onEvents, onPermission: vi.fn() },
      '/workspace'
    )
    await vi.waitFor(() => expect(persistence.mergeMetadata).toHaveBeenCalledTimes(2))

    expect(session.sessionId).toBe('new-session')
    expect(session.currentModeId).toBe('new-mode')
    expect(session.availableCommands).toEqual([
      { name: 'new-command', description: 'Live command', input: null }
    ])
    expect(session.metadata).toMatchObject({
      acpSessionInfo: { title: 'Live session' },
      acpUsage: { used: 2, size: 8 }
    })
    expect(persistence.mergeMetadata.mock.calls[0][2]).toMatchObject({
      acpSessionInfo: { title: 'Live session' }
    })
    expect(persistence.mergeMetadata.mock.calls[0][2]).not.toHaveProperty('acpUsage')
    expect(persistence.mergeMetadata.mock.calls[1][2]).toMatchObject({
      acpSessionInfo: { title: 'Live session' },
      acpUsage: { used: 2, size: 8 }
    })
    expect(persistence.saveSessionData).toHaveBeenCalledWith(
      'restore-conversation',
      'agent',
      'new-session',
      '/workspace',
      'active',
      { agentName: 'Agent' }
    )
    const serializedEvents = JSON.stringify(onEvents.mock.calls)
    const serializedCapabilities = JSON.stringify([
      events.modesReady.mock.calls,
      events.commandsReady.mock.calls
    ])
    expect(serializedEvents).toContain('new-mode')
    expect(serializedEvents).not.toContain('dead-resume')
    expect(serializedEvents).not.toContain('dead-load')
    expect(serializedCapabilities).toContain('new-command')
    expect(serializedCapabilities).not.toContain('dead-resume')
    expect(serializedCapabilities).not.toContain('dead-load')
    expect(sessionManager.getSessionById('persisted-session')).toBeNull()
    expect(sessionManager.getSessionById('new-session')).toBe(session)
    expect(listeners.get('persisted-session')?.size ?? 0).toBe(0)
    expect(listeners.get('new-session')?.size).toBe(1)
  })

  it('does not publish prepare capabilities after shutdown aborts an in-flight open', async () => {
    let resolveOpen!: (session: AcpSessionRecord) => void
    const opening = new Promise<AcpSessionRecord>((resolve) => {
      resolveOpen = resolve
    })
    const session = {
      sessionId: toAcpRemoteSessionId('remote-prepare'),
      connection: {},
      detachHandlers: [],
      workdir: '/workspace',
      providerId: 'acp',
      agentId: 'agent',
      conversationId: 'prepare-conversation',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      metadata: {}
    } as unknown as AcpSessionRecord
    const clearSession = vi.fn(async () => undefined)
    const sessionManager = {
      getOrCreateSession: vi.fn(async () => await opening),
      cancelPendingSession: vi.fn(() => true),
      discardLateSession: vi.fn(async (conversationId) => clearSession(conversationId)),
      getSession: vi.fn(() => session),
      clearSession
    }
    const events = {
      modesReady: vi.fn(),
      configOptionsReady: vi.fn(),
      commandsReady: vi.fn()
    }
    const controller = new AcpSessionController(
      sessionManager as never,
      {} as never,
      {
        isWorkdirUsable: vi.fn(() => true),
        resolveWorkdir: vi.fn((workdir?: string | null) => workdir ?? '/workspace'),
        getSessionData: vi.fn(async () => ({ workdir: '/workspace' })),
        updateWorkdir: vi.fn(async () => undefined)
      } as never,
      events
    )
    const abortController = new AbortController()
    const preparing = controller.prepare(
      toAppSessionId('prepare-conversation'),
      { id: 'agent', name: 'Agent', command: 'agent' },
      '/workspace',
      { signal: abortController.signal }
    )
    await vi.waitFor(() => expect(sessionManager.getOrCreateSession).toHaveBeenCalledTimes(1))

    abortController.abort()
    resolveOpen(session)

    await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
    expect(sessionManager.discardLateSession).toHaveBeenCalledWith(
      'prepare-conversation',
      session
    )
    expect(clearSession).toHaveBeenCalledWith('prepare-conversation')
    expect(events.modesReady).not.toHaveBeenCalled()
    expect(events.configOptionsReady).not.toHaveBeenCalled()
    expect(events.commandsReady).not.toHaveBeenCalled()
  })
})
