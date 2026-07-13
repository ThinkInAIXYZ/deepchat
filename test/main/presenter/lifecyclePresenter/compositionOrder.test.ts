import { describe, expect, it, vi } from 'vitest'
import { LifecyclePhase } from '@shared/lifecycle'

vi.mock('@/presenter', () => ({
  presenter: undefined,
  getInstance: vi.fn()
}))

vi.mock('@/agent/acp/launch/acpInitHelper', () => ({
  killTerminal: vi.fn()
}))

import { presenterInitHook } from '@/presenter/lifecyclePresenter/hooks/ready/presenterInitHook'
import { acpRegistryMigrationHook } from '@/presenter/lifecyclePresenter/hooks/after-start/acpRegistryMigrationHook'
import { windowCreationHook } from '@/presenter/lifecyclePresenter/hooks/after-start/windowCreationHook'
import { mcpShutdownHook } from '@/presenter/lifecyclePresenter/hooks/beforeQuit/mcpShutdownHook'
import { acpCleanupHook } from '@/presenter/lifecyclePresenter/hooks/beforeQuit/acpCleanupHook'
import { presenterDestroyHook } from '@/presenter/lifecyclePresenter/hooks/beforeQuit/presenterDestroyHook'

describe('composition lifecycle order', () => {
  it('keeps ACP migration after presenter initialization and before window creation', () => {
    expect(presenterInitHook.phase).toBe(LifecyclePhase.READY)
    expect(acpRegistryMigrationHook.phase).toBe(LifecyclePhase.AFTER_START)
    expect(windowCreationHook.phase).toBe(LifecyclePhase.AFTER_START)
    expect(acpRegistryMigrationHook.priority).toBeLessThan(windowCreationHook.priority)
  })

  it('keeps MCP and ACP cleanup ahead of presenter teardown', () => {
    const shutdownHooks = [mcpShutdownHook, acpCleanupHook, presenterDestroyHook]
    expect(shutdownHooks.every((hook) => hook.phase === LifecyclePhase.BEFORE_QUIT)).toBe(true)
    expect(
      shutdownHooks
        .toSorted((left, right) => left.priority - right.priority)
        .map((hook) => hook.name)
    ).toEqual(['mcp-shutdown', 'acp-cleanup', 'presenter-destroy'])
  })
})
