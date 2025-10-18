// === Types ===
import type { Ref } from 'vue'
import type { ArtifactState } from '@/stores/artifact'

// === Vue Core ===
import { ref, watch } from 'vue'

/**
 * Generate context key for artifact tracking
 * Combines thread ID, message ID, and artifact ID for unique identification
 */
const getArtifactContextKey = (
  artifact: ArtifactState | null,
  threadId: string | null,
  messageId: string | null
): string | null => {
  if (!artifact) return null

  if (threadId && messageId) {
    return `${threadId}:${messageId}:${artifact.id}`
  }

  return artifact.id
}

/**
 * Composable for tracking artifact context and detecting changes
 *
 * Features:
 * - Unique context identification
 * - New artifact detection
 * - Thread and message association
 */
export function useArtifactContext(
  artifact: Ref<ArtifactState | null>,
  threadId: Ref<string | null>,
  messageId: Ref<string | null>
) {
  // === Local State ===
  const activeArtifactContext = ref<string | null>(null)
  const componentKey = ref(0)

  // === Lifecycle Hooks ===
  // Watch artifact changes to update context and detect new artifacts
  watch(
    artifact,
    (newArtifact, prevArtifact) => {
      // Increment component key to force re-render
      componentKey.value++

      if (!newArtifact) {
        activeArtifactContext.value = null
        return
      }

      const newContextKey = getArtifactContextKey(newArtifact, threadId.value, messageId.value)
      const prevContextKey = getArtifactContextKey(
        prevArtifact ?? null,
        threadId.value,
        messageId.value
      )

      // Check if this is a new artifact (different context)
      const isNewArtifact =
        newContextKey !== prevContextKey || newContextKey !== activeArtifactContext.value

      if (isNewArtifact) {
        activeArtifactContext.value = newContextKey
      }
    },
    { immediate: true }
  )

  // === Return API ===
  return {
    componentKey,
    activeArtifactContext
  }
}
