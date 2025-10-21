// === Types ===
import type { Ref } from 'vue'
import type { ArtifactState } from '@/stores/artifact'

// === Vue Core ===
import { ref, watch, onBeforeUnmount } from 'vue'

// === Composables ===
import { useMonaco, detectLanguage } from 'stream-monaco'
import { useThrottleFn } from '@vueuse/core'

/**
 * Normalize and sanitize language identifiers
 */
const sanitizeLanguage = (language: string | undefined | null): string => {
  if (!language) return ''
  const normalized = language.trim().toLowerCase()

  switch (normalized) {
    case 'md':
      return 'markdown'
    case 'plain':
    case 'text':
      return 'plaintext'
    case 'htm':
      return 'html'
    default:
      return normalized
  }
}

/**
 * Get language from artifact type and explicit language field
 */
const normalizeLanguage = (artifact: ArtifactState | null): string => {
  if (!artifact) return ''

  const explicit = sanitizeLanguage(artifact.language)
  if (explicit) {
    return explicit
  }

  switch (artifact.type) {
    case 'application/vnd.ant.code':
      return 'plaintext'
    case 'text/markdown':
      return 'markdown'
    case 'text/html':
      return 'html'
    case 'image/svg+xml':
      return 'svg'
    case 'application/vnd.ant.mermaid':
      return 'mermaid'
    case 'application/vnd.ant.react':
      return 'jsx'
    default:
      return sanitizeLanguage(artifact.type)
  }
}

/**
 * Composable for managing Monaco code editor integration
 *
 * Features:
 * - Automatic language detection and normalization
 * - Throttled language detection for performance
 * - Lifecycle management for editor instance
 * - Real-time content synchronization
 */
export function useArtifactCodeEditor(
  artifact: Ref<ArtifactState | null>,
  editorElement: Ref<HTMLElement | null>,
  isPreview: Ref<boolean>,
  isOpen: Ref<boolean>
) {
  // === Local State ===
  const codeLanguage = ref(normalizeLanguage(artifact.value))

  // === Monaco Integration ===
  const { createEditor, updateCode, cleanupEditor } = useMonaco({
    MAX_HEIGHT: '100%',
    wordWrap: 'on',
    wrappingIndent: 'same'
  })

  // === Internal Helpers ===
  /**
   * Throttled language detection - max once per second
   */
  const throttledDetectLanguage = useThrottleFn(
    (code: string) => {
      codeLanguage.value = sanitizeLanguage(detectLanguage(code))
    },
    1000,
    true
  )

  // === Lifecycle Hooks ===
  // Watch artifact changes to update language and code
  watch(
    artifact,
    (newArtifact) => {
      if (!newArtifact) {
        codeLanguage.value = ''
        return
      }

      const normalizedLanguage = normalizeLanguage(newArtifact)
      if (normalizedLanguage !== codeLanguage.value) {
        codeLanguage.value = normalizedLanguage
      }

      // Skip mermaid language detection
      if (codeLanguage.value === 'mermaid') {
        return
      }

      const newCode = newArtifact.content || ''

      // Detect language if not explicitly set
      if (!codeLanguage.value) {
        throttledDetectLanguage(newCode)
      }

      updateCode(newCode, codeLanguage.value)
    },
    {
      immediate: true,
      deep: true
    }
  )

  // Initialize language detection if needed
  if (!codeLanguage.value) {
    throttledDetectLanguage(artifact.value?.content || '')
  }

  // Watch language changes to update editor
  watch(codeLanguage, () => {
    updateCode(artifact.value?.content || '', codeLanguage.value)
  })

  // Watch content changes for real-time updates
  watch(
    () => artifact.value?.content,
    (newContent) => {
      if (newContent !== undefined) {
        updateCode(newContent, codeLanguage.value)
      }
    },
    {
      immediate: true
    }
  )

  // Create editor when element is ready and not in preview mode
  watch(
    [editorElement, isPreview, isOpen],
    ([editorEl, previewActive, open]) => {
      if (!open || previewActive || !editorEl) return
      void createEditor(editorEl, artifact.value?.content || '', codeLanguage.value)
    },
    {
      flush: 'post',
      immediate: true
    }
  )

  // Cleanup editor when preview is toggled on
  watch(isPreview, (previewActive) => {
    if (previewActive) {
      cleanupEditor()
    }
  })

  // Cleanup editor when editor element is unmounted
  watch(editorElement, (editorEl) => {
    if (!editorEl) {
      cleanupEditor()
    }
  })

  // Cleanup editor when dialog closes
  watch(isOpen, (open) => {
    if (!open) {
      cleanupEditor()
    }
  })

  onBeforeUnmount(() => {
    cleanupEditor()
  })

  // === Return API ===
  return {
    codeLanguage
  }
}
