import { describe, expect, it } from 'vitest'
import { CompactionService } from '@/presenter/agentRuntimePresenter/compactionService'
import { GenerationControlService } from '@/presenter/agentRuntimePresenter/generationControlService'
import { InteractionResumeService } from '@/presenter/agentRuntimePresenter/interactionResumeService'
import { MemoryCompactionService } from '@/presenter/agentRuntimePresenter/memoryCompactionService'
import { PendingInputService } from '@/presenter/agentRuntimePresenter/pendingInputService'
import { SessionLifecycleService } from '@/presenter/agentRuntimePresenter/sessionLifecycleService'
import { SessionSettingsService } from '@/presenter/agentRuntimePresenter/sessionSettingsService'
import { StreamLifecycleService } from '@/presenter/agentRuntimePresenter/streamLifecycleService'
import { TurnPreparationService } from '@/presenter/agentRuntimePresenter/turnPreparationService'

const failOnAccess = (label: string): never =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        throw new Error(`${label}.${String(property)} was accessed during construction`)
      }
    }
  ) as never

const failOnCall = (label: string): never =>
  (() => {
    throw new Error(`${label} was called during construction`)
  }) as never

const constructionCases: Array<[string, () => unknown]> = [
  [
    'SessionSettingsService',
    () =>
      new SessionSettingsService(
        failOnAccess('configPresenter'),
        failOnAccess('sessionStore'),
        failOnAccess('runtimeSharedState'),
        failOnAccess('invalidation')
      )
  ],
  [
    'GenerationControlService',
    () =>
      new GenerationControlService(
        failOnAccess('runtimeSharedState'),
        failOnCall('cancelProviderPermissions')
      )
  ],
  [
    'PendingInputService',
    () =>
      new PendingInputService(
        failOnAccess('coordinator'),
        failOnAccess('runtimeSharedState'),
        failOnAccess('runtime')
      )
  ],
  [
    'CompactionService',
    () =>
      new CompactionService(
        failOnAccess('sessionStore'),
        failOnAccess('messageStore'),
        failOnAccess('llmProviderPresenter'),
        failOnAccess('configPresenter'),
        failOnCall('resolveSessionConfig')
      )
  ],
  [
    'MemoryCompactionService',
    () =>
      new MemoryCompactionService(
        failOnAccess('memoryCompactionDependencies'),
        failOnAccess('memoryCompactionHost')
      )
  ],
  [
    'TurnPreparationService',
    () =>
      new TurnPreparationService(
        failOnAccess('turnPreparationDependencies'),
        failOnAccess('turnPreparationHost')
      )
  ],
  [
    'StreamLifecycleService',
    () =>
      new StreamLifecycleService(
        failOnAccess('streamLifecycleDependencies'),
        failOnAccess('streamLifecycleHost')
      )
  ],
  [
    'InteractionResumeService',
    () => new InteractionResumeService(failOnAccess('interactionResumeHost'))
  ],
  [
    'SessionLifecycleService',
    () =>
      new SessionLifecycleService(
        failOnAccess('sessionLifecycleDependencies'),
        failOnAccess('sessionLifecycleHost')
      )
  ]
]

describe('agent runtime service construction', () => {
  it.each(constructionCases)('%s keeps cross-service callbacks lazy', (_name, construct) => {
    expect(construct).not.toThrow()
  })
})
