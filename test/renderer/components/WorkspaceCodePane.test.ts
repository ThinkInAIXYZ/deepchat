import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import WorkspaceCodePane from '@/components/sidepanel/viewer/WorkspaceCodePane.vue'

const editorMocks = vi.hoisted(() => {
  const createEditor = vi.fn().mockResolvedValue(undefined)
  const updateCode = vi.fn()
  const cleanupEditor = vi.fn()
  const setTheme = vi.fn()
  const updateOptions = vi.fn()
  const focus = vi.fn()
  const useStreamDiffEditor = vi.fn(() => ({
    createEditor,
    updateCode,
    cleanupEditor,
    getEditorView: () => ({
      onDidChangeModelContent: vi.fn(),
      getValue: vi.fn(() => ''),
      focus,
      updateOptions
    }),
    getEditor: () => ({ setTheme })
  }))

  return {
    createEditor,
    updateCode,
    cleanupEditor,
    setTheme,
    updateOptions,
    focus,
    useStreamDiffEditor,
    themeStore: { isDark: false },
    uiSettingsStore: { formattedCodeFontFamily: 'JetBrains Mono' }
  }
})

vi.mock('@/composables/useStreamDiffEditor', () => ({
  useStreamDiffEditor: editorMocks.useStreamDiffEditor
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => editorMocks.themeStore
}))

vi.mock('@/stores/uiSettingsStore', () => ({
  useUiSettingsStore: () => editorMocks.uiSettingsStore
}))

describe('WorkspaceCodePane', () => {
  beforeEach(() => {
    editorMocks.createEditor.mockClear()
    editorMocks.updateCode.mockClear()
    editorMocks.cleanupEditor.mockClear()
    editorMocks.setTheme.mockClear()
    editorMocks.updateOptions.mockClear()
    editorMocks.useStreamDiffEditor.mockClear()
    editorMocks.themeStore.isDark = false
  })

  it('mounts a read-only stream-diffs surface and updates it without creating an editor session', async () => {
    const wrapper = mount(WorkspaceCodePane, {
      props: {
        source: {
          id: 'file-1',
          content: 'export const app = 1',
          language: 'ts',
          type: 'application/typescript'
        }
      }
    })

    await flushPromises()

    expect(editorMocks.useStreamDiffEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        readOnly: true,
        theme: 'vitesse-light',
        fontSize: 14,
        ariaLabel: 'file-1'
      })
    )
    expect(editorMocks.createEditor).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      'export const app = 1',
      'typescript'
    )

    await wrapper.setProps({
      source: {
        id: 'file-1',
        content: 'export const app = 2',
        language: 'ts',
        type: 'application/typescript'
      }
    })
    await flushPromises()

    expect(editorMocks.updateCode).toHaveBeenLastCalledWith('export const app = 2', 'typescript')

    expect(editorMocks.setTheme).toHaveBeenCalledWith('vitesse-light')

    wrapper.unmount()
    expect(editorMocks.cleanupEditor).toHaveBeenCalled()
  })
})
