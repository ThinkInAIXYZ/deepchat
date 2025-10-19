import { ref } from 'vue'
import { describe, it, expect } from 'vitest'
import { useArtifactViewMode } from '@/composables/useArtifactViewMode'

const mkArtifact = (id: string, type: string, status: 'loaded' | 'loading' | 'error' = 'loaded') =>
  ({
    id,
    type,
    status
  }) as any

describe('useArtifactViewMode', () => {
  it('auto-previews for certain types and reacts to changes', () => {
    const artifact = ref<any>(mkArtifact('a1', 'application/vnd.ant.mermaid'))
    const { isPreview, setPreview } = useArtifactViewMode(artifact)
    expect(isPreview.value).toBe(true)

    // user override sticks
    setPreview(false)
    expect(isPreview.value).toBe(false)

    // new artifact resets preference and recomputes
    artifact.value = mkArtifact('a2', 'image/svg+xml')
    expect(isPreview.value).toBe(true)

    // non-preview types default to code view
    artifact.value = mkArtifact('a3', 'text/markdown')
    expect(isPreview.value).toBe(false)
  })

  it('depends on status: not preview until loaded', () => {
    const artifact = ref<any>(mkArtifact('b1', 'image/svg+xml', 'loading'))
    const vm = useArtifactViewMode(artifact)
    expect(vm.isPreview.value).toBe(false)
    artifact.value = mkArtifact('b1', 'image/svg+xml', 'loaded')
    expect(vm.isPreview.value).toBe(true)
  })
})
