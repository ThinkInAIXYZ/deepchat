import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStreamDiffEditor } from '@/composables/useStreamDiffEditor'

const surfaceState = vi.hoisted(() => {
  let value = ''
  let editing = false
  let options: Record<string, any> = {}
  let editor = {
    applyEdits: vi.fn((edits: Array<{ newText: string }>) => {
      value = edits[0]?.newText ?? ''
      options.onEditChange?.({ file: { contents: value } })
    }),
    getText: vi.fn(() => value),
    focus: vi.fn()
  }

  const surface = {
    mount: vi.fn(async () => {}),
    dispose: vi.fn(),
    updateFile: vi.fn(async (file: { contents: string }) => {
      value = file.contents
    }),
    startEditing: vi.fn(async () => {
      editing = true
      return editor
    }),
    stopEditing: vi.fn(() => {
      editing = false
    }),
    isEditing: vi.fn(() => editing),
    getEditingText: vi.fn(() => value),
    getEditor: vi.fn(() => editor),
    focusEditor: vi.fn(() => editor.focus()),
    setThemeType: vi.fn()
  }

  return {
    createDiffSurface: vi.fn(
      (input: { file: { contents: string }; options: Record<string, any> }) => {
        value = input.file.contents
        options = input.options
        return surface
      }
    ),
    surface,
    getOptions: () => options,
    setValue(nextValue: string) {
      value = nextValue
    },
    getValue: () => value,
    setEditing(nextEditing: boolean) {
      editing = nextEditing
    },
    reset() {
      value = ''
      editing = false
      options = {}
      editor = {
        applyEdits: vi.fn((edits: Array<{ newText: string }>) => {
          value = edits[0]?.newText ?? ''
          options.onEditChange?.({ file: { contents: value } })
        }),
        getText: vi.fn(() => value),
        focus: vi.fn()
      }
      surface.mount.mockClear()
      surface.dispose.mockClear()
      surface.updateFile.mockClear()
      surface.startEditing.mockClear()
      surface.stopEditing.mockClear()
      surface.isEditing.mockClear()
      surface.getEditingText.mockClear()
      surface.getEditor.mockClear()
      surface.focusEditor.mockClear()
      surface.setThemeType.mockClear()
    }
  }
})

vi.mock('stream-diffs', () => ({
  createDiffSurface: surfaceState.createDiffSurface
}))

describe('useStreamDiffEditor', () => {
  beforeEach(() => {
    surfaceState.reset()
    surfaceState.createDiffSurface.mockClear()
  })

  it('attaches the editor, forwards changes, and applies replacement text in-session', async () => {
    const host = document.createElement('div')
    const editor = useStreamDiffEditor({
      fontFamily: 'JetBrains Mono',
      fontSize: 13,
      theme: 'vitesse-light'
    })
    await editor.createEditor(host, '{"a":1}', 'json')
    const listener = vi.fn()
    editor.getEditorView().onDidChangeModelContent(listener)

    expect(surfaceState.createDiffSurface).toHaveBeenCalled()
    expect(surfaceState.surface.mount).toHaveBeenCalledWith(host)
    expect(surfaceState.surface.startEditing).toHaveBeenCalled()
    expect(host.style.getPropertyValue('--diffs-font-family')).toBe('JetBrains Mono')

    surfaceState.setValue('{"a":2}')
    surfaceState.getOptions().onEditChange({ file: { contents: '{"a":2}' } })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(editor.getEditorView().getValue()).toBe('{"a":2}')

    editor.updateCode('{"a":3}')
    expect(surfaceState.surface.updateFile).not.toHaveBeenCalled()
    expect(surfaceState.getOptions().onEditChange).toBeTypeOf('function')
    expect(editor.getEditorView().getValue()).toBe('{"a":3}')

    editor.getEditor().setTheme('vitesse-dark')
    expect(surfaceState.surface.setThemeType).toHaveBeenCalledWith('dark')

    editor.cleanupEditor()
    expect(surfaceState.surface.stopEditing).toHaveBeenCalledWith('discard')
    expect(surfaceState.surface.dispose).toHaveBeenCalled()
    expect(host.childElementCount).toBe(0)
  })

  it('keeps read-only surfaces render-only and updates their file directly', async () => {
    const host = document.createElement('div')
    const editor = useStreamDiffEditor({ readOnly: true, theme: 'vitesse-dark' })

    await editor.createEditor(host, 'const a = 1', 'typescript')

    expect(surfaceState.surface.startEditing).not.toHaveBeenCalled()
    expect(surfaceState.getOptions().themeType).toBe('dark')

    await editor.updateCode('const a = 2', 'typescript')
    expect(surfaceState.surface.updateFile).toHaveBeenCalledWith(
      expect.objectContaining({ contents: 'const a = 2', lang: 'typescript' })
    )

    editor.cleanupEditor()
    expect(surfaceState.surface.dispose).toHaveBeenCalled()
  })
})
