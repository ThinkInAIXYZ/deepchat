import { describe, expect, it, vi } from 'vitest'
import {
  AcpProcessManager,
  parseLoadSessionCapability
} from '@/presenter/agentPresenter/acp/acpProcessManager'

vi.mock('@/eventbus', () => ({
  eventBus: {
    sendToRenderer: vi.fn()
  },
  SendTarget: {
    ALL_WINDOWS: 'ALL_WINDOWS'
  }
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '0.0.0-test'),
    getPath: vi.fn(() => '/tmp')
  }
}))

describe('parseLoadSessionCapability', () => {
  it('parses boolean capability from initialize result', () => {
    expect(parseLoadSessionCapability({ agentCapabilities: { loadSession: true } })).toBe(true)
    expect(parseLoadSessionCapability({ agentCapabilities: { loadSession: false } })).toBe(false)
  })

  it('returns undefined when capability is absent', () => {
    expect(parseLoadSessionCapability({})).toBeUndefined()
    expect(parseLoadSessionCapability(null)).toBeUndefined()
  })
})

describe('AcpProcessManager config cache fallback', () => {
  const createManager = () =>
    new AcpProcessManager({
      providerId: 'acp',
      getUseBuiltinRuntime: vi.fn().mockResolvedValue(false)
    })

  const createConfigState = (model = 'gpt-5', mode = 'code') => ({
    source: 'configOptions' as const,
    options: [
      {
        id: 'model',
        label: 'Model',
        type: 'select' as const,
        category: 'model',
        currentValue: model,
        options: [
          { value: 'gpt-5', label: 'gpt-5' },
          { value: 'gpt-5-mini', label: 'gpt-5-mini' }
        ]
      },
      {
        id: 'mode',
        label: 'Mode',
        type: 'select' as const,
        category: 'mode',
        currentValue: mode,
        options: [
          { value: 'code', label: 'code' },
          { value: 'ask', label: 'ask' }
        ]
      }
    ]
  })

  it('falls back to the latest agent config when no scoped handle matches', () => {
    const manager = createManager()
    const configState = createConfigState('gpt-5-mini', 'ask')

    ;(manager as any).latestConfigStates.set('agent-1', configState)
    ;(manager as any).latestModeSnapshots.set('agent-1', {
      availableModes: [{ id: 'ask', name: 'Ask', description: '' }],
      currentModeId: 'ask'
    })

    expect(manager.getProcessConfigState('agent-1', '/tmp/missing')).toEqual(configState)
    expect(manager.getProcessModes('agent-1', '/tmp/missing')).toEqual({
      availableModes: [{ id: 'ask', name: 'Ask', description: '' }],
      currentModeId: 'ask'
    })
  })

  it('does not return another agent cache entry when the requested agent has no snapshot', () => {
    const manager = createManager()
    const configState = createConfigState('gpt-5-mini', 'ask')

    ;(manager as any).latestConfigStates.set('agent-1', configState)
    ;(manager as any).latestModeSnapshots.set('agent-1', {
      availableModes: [{ id: 'ask', name: 'Ask', description: '' }],
      currentModeId: 'ask'
    })

    expect(manager.getProcessConfigState('agent-2', '/tmp/missing')).toBeUndefined()
    expect(manager.getProcessModes('agent-2', '/tmp/missing')).toBeUndefined()
  })

  it('refreshes the agent cache when bound session config changes', () => {
    const manager = createManager()
    const handle = {
      agentId: 'agent-1',
      workdir: '/tmp/workspace',
      state: 'bound',
      configState: createConfigState('gpt-5', 'code'),
      availableModes: [{ id: 'code', name: 'Code', description: '' }],
      currentModeId: 'code',
      child: { killed: false, exitCode: null, signalCode: null },
      connection: {},
      readyAt: Date.now(),
      providerId: 'acp',
      status: 'ready'
    }

    ;(manager as any).boundHandles.set('conv-1', handle)

    const nextConfigState = createConfigState('gpt-5-mini', 'ask')

    expect(manager.updateBoundProcessConfigState('conv-1', nextConfigState as any)).toBe(true)
    expect(manager.getProcessConfigState('agent-1', '/tmp/other')).toEqual(nextConfigState)
    expect(manager.getProcessModes('agent-1', '/tmp/other')).toEqual({
      availableModes: [
        { id: 'code', name: 'code', description: '' },
        { id: 'ask', name: 'ask', description: '' }
      ],
      currentModeId: 'ask'
    })
  })
})
