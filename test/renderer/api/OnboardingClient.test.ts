import { describe, expect, it, vi } from 'vitest'
import type { DeepchatBridge } from '@shared/contracts/bridge'
import { createOnboardingClient } from '../../../src/renderer/api/OnboardingClient'
import type { GuidedOnboardingState } from '@shared/contracts/routes'

const createState = (): GuidedOnboardingState => ({
  version: 4,
  status: 'active',
  startedAt: 1,
  completedAt: null,
  lastActiveAt: 1,
  currentStepId: 'select-provider',
  steps: [
    {
      id: 'select-provider',
      required: true,
      status: 'in_progress',
      startedAt: 1,
      completedAt: null,
      skippedAt: null
    },
    {
      id: 'provider-api-key',
      required: false,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      skippedAt: null
    },
    {
      id: 'provider-model',
      required: false,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      skippedAt: null
    },
    {
      id: 'mcp',
      required: false,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      skippedAt: null
    },
    {
      id: 'skills',
      required: false,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      skippedAt: null
    },
    {
      id: 'switch-agent',
      required: true,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      skippedAt: null
    },
    {
      id: 'switch-model',
      required: true,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      skippedAt: null
    },
    {
      id: 'first-chat',
      required: true,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      skippedAt: null
    }
  ]
})

describe('OnboardingClient', () => {
  it('returns parsed state for all onboarding routes', async () => {
    const state = createState()
    const bridge: DeepchatBridge = {
      invoke: vi.fn(async () => ({ state })),
      on: vi.fn(() => vi.fn())
    }

    const client = createOnboardingClient(bridge)

    await expect(client.getState()).resolves.toEqual(state)
    await expect(client.start()).resolves.toEqual(state)
    await expect(
      client.setStepStatus({
        stepId: 'select-provider',
        status: 'completed'
      })
    ).resolves.toEqual(state)
    await expect(client.complete()).resolves.toEqual(state)
    await expect(client.reset()).resolves.toEqual(state)
  })

  it('throws when onboarding response shape is invalid', async () => {
    const bridge: DeepchatBridge = {
      invoke: vi.fn(async () => ({})),
      on: vi.fn(() => vi.fn())
    }

    const client = createOnboardingClient(bridge)

    await expect(client.getState()).rejects.toThrow(
      '[OnboardingClient] Invalid state response from onboarding.getState'
    )
    await expect(client.start()).rejects.toThrow(
      '[OnboardingClient] Invalid state response from onboarding.start'
    )
    await expect(
      client.setStepStatus({
        stepId: 'select-provider',
        status: 'completed'
      })
    ).rejects.toThrow('[OnboardingClient] Invalid state response from onboarding.setStepStatus')
    await expect(client.complete()).rejects.toThrow(
      '[OnboardingClient] Invalid state response from onboarding.complete'
    )
    await expect(client.reset()).rejects.toThrow(
      '[OnboardingClient] Invalid state response from onboarding.reset'
    )
  })
})
