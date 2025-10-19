// === Types ===
import type { Ref } from 'vue'
import type { ArtifactState } from '@/stores/artifact'

// === Vue Core ===
import { ref, computed, watch } from 'vue'

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
  const componentKey = ref(0)

  // Computed context key that automatically updates when any dependency changes
  const activeArtifactContext = computed(() =>
    getArtifactContextKey(artifact.value, threadId.value, messageId.value)
  )

  // === Lifecycle Hooks ===
  // Watch context changes to increment component key for re-rendering
  let isFirstRun = true
  watch(
    activeArtifactContext,
    () => {
      if (isFirstRun) {
        isFirstRun = false
        return
      }
      componentKey.value++
    },
    { immediate: true, flush: 'sync' } // Sync to ensure componentKey updates immediately
  )

  // === Return API ===
  return {
    componentKey,
    activeArtifactContext
  }
}
