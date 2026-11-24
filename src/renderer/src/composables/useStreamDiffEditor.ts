import type { DiffSurfaceController, FileContents } from 'stream-diffs'
import { createDiffSurface } from 'stream-diffs'

export interface StreamDiffEditorOptions {
  /** Render-only surface. The stream-diffs editing chunk is never loaded. */
  readOnly?: boolean
  wordWrap?: boolean
  lineNumbers?: boolean
  fontFamily?: string
  fontSize?: number
  /** Initial resolved theme name, e.g. `vitesse-dark` or `vitesse-light`. */
  theme?: string
  fileName?: string
}

export interface StreamDiffEditorView {
  getValue: () => string
  onDidChangeModelContent: (listener: () => void) => { dispose: () => void }
  focus: () => void
  layout: () => void
  updateOptions: (options: { fontFamily?: string }) => void
}

interface StreamDiffThemeController {
  setTheme: (theme: string) => void
}

interface StreamDiffEditor {
  createEditor: (host: HTMLElement, value: string, language?: string) => Promise<void>
  updateCode: (value: string, language?: string) => void | Promise<void>
  getEditorView: () => StreamDiffEditorView
  getEditor: () => StreamDiffThemeController
  cleanupEditor: () => void
}

const DEFAULT_THEME = 'vitesse-light'
const THEME_PAIR = {
  dark: 'vitesse-dark',
  light: 'vitesse-light'
}

function isDarkTheme(theme: string) {
  return theme.toLowerCase().includes('dark')
}

function normalizeLanguage(language: string | undefined) {
  const normalized = language?.trim().toLowerCase()
  if (!normalized || normalized === 'plaintext' || normalized === 'plain') return 'text'
  return normalized
}

function createFileContents(
  value: string,
  language: string,
  fileName: string | undefined
): FileContents {
  return {
    name: fileName || `snippet.${language}`,
    contents: value,
    lang: language
  }
}

function applyEditorStyles(
  host: HTMLElement,
  fontFamily: string | undefined,
  fontSize: number | undefined
) {
  if (fontFamily) host.style.setProperty('--diffs-font-family', fontFamily)
  if (typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0) {
    host.style.setProperty('--diffs-font-size', `${fontSize}px`)
    host.style.setProperty('--diffs-line-height', `${Math.round(fontSize * 1.5)}px`)
  }
  host.style.setProperty('--diffs-tab-size', '2')
}

/**
 * Lightweight adapter between DeepChat's editor call sites and the stream-diffs
 * finalized-file surface. Editable instances attach the upstream editor; read-only
 * instances only mount the highlighted file surface, so they never load Monaco or
 * the stream-diffs editor chunk.
 */
export function useStreamDiffEditor(options: StreamDiffEditorOptions = {}): StreamDiffEditor {
  let host: HTMLElement | null = null
  let surface: DiffSurfaceController | null = null
  let currentValue = ''
  let currentLanguage = 'text'
  let currentTheme = options.theme || DEFAULT_THEME
  let generation = 0
  let editStateSeed = 0
  const changeListeners = new Set<() => void>()

  const notifyChange = () => {
    for (const listener of changeListeners) {
      try {
        listener()
      } catch (error) {
        console.error('[useStreamDiffEditor] change listener failed:', error)
      }
    }
  }

  const updateFont = (fontFamily: string | undefined) => {
    if (host && fontFamily) host.style.setProperty('--diffs-font-family', fontFamily)
  }

  const view: StreamDiffEditorView = {
    getValue: () => surface?.getEditingText() ?? currentValue,
    onDidChangeModelContent: (listener) => {
      changeListeners.add(listener)
      return {
        dispose: () => changeListeners.delete(listener)
      }
    },
    focus: () => {
      if (surface?.isEditing()) {
        surface.focusEditor()
        return
      }
      host?.focus()
    },
    layout: () => {
      // The Diffs surface observes its own host size. Keep this method for the
      // existing call sites that used Monaco's layout().
    },
    updateOptions: ({ fontFamily }) => updateFont(fontFamily)
  }

  const themeController: StreamDiffThemeController = {
    setTheme: (theme) => {
      currentTheme = theme
      surface?.setThemeType(isDarkTheme(theme) ? 'dark' : 'light')
    }
  }

  const disposeSurface = (target: DiffSurfaceController | null) => {
    if (!target) return
    try {
      if (target.isEditing()) target.stopEditing('discard')
    } catch (error) {
      console.warn('[useStreamDiffEditor] Failed to stop the edit session:', error)
    }
    try {
      target.dispose()
    } catch (error) {
      console.warn('[useStreamDiffEditor] Failed to dispose the surface:', error)
    }
  }

  const startEditing = async (target: DiffSurfaceController) => {
    editStateSeed += 1
    await target.startEditing({}, `deepchat-stream-diff-editor-${editStateSeed}`)
    currentValue = target.getEditingText() ?? currentValue
  }

  const createEditor = async (nextHost: HTMLElement, value: string, language?: string) => {
    const nextGeneration = ++generation
    disposeSurface(surface)
    host = nextHost
    surface = null
    changeListeners.clear()
    currentValue = typeof value === 'string' ? value : ''
    currentLanguage = normalizeLanguage(language)
    host.replaceChildren()
    host.classList.add('stream-diff-editor-host')
    host.tabIndex = options.readOnly ? -1 : 0
    applyEditorStyles(host, options.fontFamily, options.fontSize)

    const nextSurface = createDiffSurface({
      kind: 'file',
      file: createFileContents(currentValue, currentLanguage, options.fileName),
      options: {
        theme: THEME_PAIR,
        themeType: isDarkTheme(currentTheme) ? 'dark' : 'light',
        disableFileHeader: true,
        disableLineNumbers: options.lineNumbers === false,
        overflow: options.wordWrap ? 'wrap' : 'scroll',
        useTokenTransformer: true,
        onEditChange: (event) => {
          currentValue = event.file.contents
          notifyChange()
        },
        onEditComplete: (event) => {
          currentValue = event.file.contents
          return 'accept'
        }
      }
    })
    surface = nextSurface

    try {
      await nextSurface.mount(nextHost)
      if (nextGeneration !== generation) {
        disposeSurface(nextSurface)
        return
      }
      if (!options.readOnly) {
        await startEditing(nextSurface)
        if (nextGeneration !== generation) {
          disposeSurface(nextSurface)
        }
      }
    } catch (error) {
      if (nextGeneration === generation) {
        disposeSurface(nextSurface)
        surface = null
      }
      throw error
    }
  }

  const replaceEditingDocument = (value: string) => {
    if (!surface?.isEditing()) return false
    const editor = surface.getEditor()
    if (!editor) return false
    const currentText = editor.getText()
    if (currentText === value) return true
    const lines = currentText.split('\n')
    const end = {
      line: lines.length,
      character: lines[lines.length - 1]?.length ?? 0
    }
    editor.applyEdits(
      [
        {
          range: {
            start: { line: 1, character: 0 },
            end
          },
          newText: value
        }
      ],
      true
    )
    currentValue = value
    return true
  }

  const updateCode = (value: string, language?: string) => {
    const nextValue = typeof value === 'string' ? value : ''
    const nextLanguage = language ? normalizeLanguage(language) : currentLanguage
    currentValue = nextValue
    if (!surface) return

    if (nextLanguage !== currentLanguage) {
      const wasEditing = surface.isEditing()
      if (wasEditing) surface.stopEditing('discard')
      currentLanguage = nextLanguage
      return surface
        .updateFile(createFileContents(nextValue, currentLanguage, options.fileName))
        .then(async () => {
          if (!wasEditing || options.readOnly || !surface) return
          await startEditing(surface)
        })
    }

    if (replaceEditingDocument(nextValue)) return
    return surface.updateFile(createFileContents(nextValue, currentLanguage, options.fileName))
  }

  const cleanupEditor = () => {
    generation += 1
    disposeSurface(surface)
    surface = null
    changeListeners.clear()
    currentValue = ''
    if (host) host.replaceChildren()
    host = null
  }

  return {
    createEditor,
    updateCode,
    getEditorView: () => view,
    getEditor: () => themeController,
    cleanupEditor
  }
}
