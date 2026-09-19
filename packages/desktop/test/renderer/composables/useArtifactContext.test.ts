import { ref } from 'vue'
import { describe, it, expect } from 'vitest'
import { useArtifactContext } from '@/composables/useArtifactContext'

describe('useArtifactContext', () => {
  it('builds a stable context key from thread/message/artifact', () => {
    const art = ref<any>({ id: 'art-1' })
    const threadId = ref<string | null>('t-1')
    const messageId = ref<string | null>('m-1')
    const { componentKey, activeArtifactContext } = useArtifactContext(art, threadId, messageId)

    expect(activeArtifactContext.value).toBe('t-1:m-1:art-1')
    const prevKey = componentKey.value

    // Simulate real scenario: when messageId changes, artifact also changes
    // (mimics store.showArtifact() behavior where all three update together)
    messageId.value = 'm-2'
    art.value = { id: 'art-1' } // Trigger artifact change to update context
    expect(activeArtifactContext.value).toBe('t-1:m-2:art-1')
    expect(componentKey.value).toBeGreaterThan(prevKey)

    // null artifact resets key
    art.value = null
    expect(activeArtifactContext.value).toBeNull()
  })
})
