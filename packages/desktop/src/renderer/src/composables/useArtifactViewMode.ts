// === Types ===
import type { Ref } from 'vue'
import type { ArtifactState } from '@/stores/artifact'

// === Vue Core ===
import { ref, watch } from 'vue'

/**
 * Artifact types that automatically show preview mode when loaded
 */
const AUTO_PREVIEW_TYPES = new Set([
  'image/svg+xml',
  'application/vnd.ant.mermaid',
  'application/vnd.ant.react'
])

/**
 * Composable for managing artifact view mode (preview/code)
 *
 * Features:
 * - Automatic preview mode for specific artifact types
 * - Manual override support with user preference tracking
 * - Status-aware mode switching
 */
export function useArtifactViewMode(artifact: Ref<ArtifactState | null>) {
  // === Local State ===
  const isPreview = ref(false)
  const userHasSetPreview = ref(false)
  let lastArtifactId: string | null = null

  // === Internal Helpers ===
  /**
   * Get default preview state based on artifact type and status
   */
  const getDefaultPreviewState = (art: ArtifactState | null): boolean => {
    if (!art) return false
    if (art.status !== 'loaded') return false
    return AUTO_PREVIEW_TYPES.has(art.type)
  }

  // === Public Methods ===
  /**
   * Manually set preview mode and mark as user preference
   */
  const setPreview = (value: boolean) => {
    userHasSetPreview.value = true
    isPreview.value = value
  }

  /**
   * Reset to default state
   */
  const reset = () => {
    isPreview.value = false
    userHasSetPreview.value = false
    lastArtifactId = null
  }

  // === Lifecycle Hooks ===
  // Watch artifact and status changes to manage preview state
  // Use 'sync' flush to ensure immediate updates for testing
  watch(
    () => [artifact.value, artifact.value?.status] as const,
    ([newArtifact]) => {
      if (!newArtifact) {
        reset()
        return
      }

      // Check if this is a different artifact
      const isNewArtifact = lastArtifactId !== newArtifact.id

      if (isNewArtifact) {
        // New artifact: reset user preference and update last ID
        lastArtifactId = newArtifact.id
        userHasSetPreview.value = false
        isPreview.value = getDefaultPreviewState(newArtifact)
      } else if (!userHasSetPreview.value) {
        // Same artifact, but user hasn't set preference: update based on status
        isPreview.value = getDefaultPreviewState(newArtifact)
      }
      // If user has set preference and it's the same artifact, keep their preference
    },
    { immediate: true, flush: 'sync' }
  )

  // === Return API ===
  return {
    isPreview,
    setPreview,
    reset
  }
}
