export interface RendererWindowContext {
  windowId: number | null
  webContentsId: number | null
}

let cachedWindowContext: RendererWindowContext | null = null

function readWindowContext(): RendererWindowContext {
  if (typeof window === 'undefined' || !window.api) {
    return {
      windowId: null,
      webContentsId: null
    }
  }

  try {
    return {
      windowId:
        typeof window.api.getWindowId === 'function' ? (window.api.getWindowId() ?? null) : null,
      webContentsId:
        typeof window.api.getWebContentsId === 'function'
          ? (window.api.getWebContentsId() ?? null)
          : null
    }
  } catch (error) {
    console.warn('Failed to read renderer window context:', error)
    return {
      windowId: null,
      webContentsId: null
    }
  }
}

export function getRendererWindowContext(): RendererWindowContext {
  if (cachedWindowContext) {
    return cachedWindowContext
  }

  cachedWindowContext = readWindowContext()
  return cachedWindowContext
}

export function resetRendererWindowContext(): void {
  cachedWindowContext = null
}
