import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { MemoryCommandRejectionReason } from '../../../src/shared/contracts/routes'
import {
  shouldReconcileMemoryCommandRejection,
  useMemoryInlineFeedback
} from '../../../src/renderer/settings/lib/useMemoryInlineFeedback'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

describe('useMemoryInlineFeedback', () => {
  it.each([
    ['unavailable', 'unavailable'],
    ['not-found', 'notFound'],
    ['invalid-state', 'invalidState'],
    ['conflict', 'conflict'],
    ['stale', 'stale'],
    ['anchored', 'anchored']
  ] as const)('maps %s command rejection to actionable copy', (reason, key) => {
    let feedbackApi!: ReturnType<typeof useMemoryInlineFeedback>
    const Component = defineComponent({
      setup() {
        feedbackApi = useMemoryInlineFeedback('MemoryFeedbackTest')
        return () => h('div')
      }
    })
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const wrapper = mount(Component)

    feedbackApi.rejectCommand(reason)

    expect(feedbackApi.feedback.value?.title).toBe(
      `settings.deepchatAgents.memoryManager.commandRejected.${key}`
    )
    consoleWarn.mockRestore()
    wrapper.unmount()
  })

  it('reconciles only rejection reasons that prove the local projection is stale', () => {
    const expected = {
      unavailable: false,
      'not-found': true,
      'invalid-state': true,
      conflict: false,
      stale: true,
      anchored: false
    } satisfies Record<MemoryCommandRejectionReason, boolean>

    for (const [reason, shouldReconcile] of Object.entries(expected)) {
      expect(shouldReconcileMemoryCommandRejection(reason as MemoryCommandRejectionReason)).toBe(
        shouldReconcile
      )
    }
  })
})
