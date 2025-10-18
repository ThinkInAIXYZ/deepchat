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
  }

  // === Lifecycle Hooks ===
  // Watch artifact changes to reset or update preview state
  watch(
    artifact,
    (newArtifact, prevArtifact) => {
      if (!newArtifact) {
        reset()
        return
      }

      // Only reset user preference if it's a different artifact
      const isNewArtifact = !prevArtifact || newArtifact.id !== prevArtifact.id
      if (isNewArtifact) {
        userHasSetPreview.value = false
        isPreview.value = getDefaultPreviewState(newArtifact)
      }
    },
    { immediate: true }
  )

  // Watch status changes to update preview mode if user hasn't set preference
  watch(
    () => artifact.value?.status,
    () => {
      if (!artifact.value) {
        isPreview.value = false
        return
      }

      if (userHasSetPreview.value) {
        return
      }

      isPreview.value = getDefaultPreviewState(artifact.value)
    },
    { immediate: true }
  )

  // === Return API ===
  return {
    isPreview,
    setPreview,
    reset
  }
}
