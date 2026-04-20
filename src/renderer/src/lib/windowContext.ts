import { getLegacyWebContentsId, getLegacyWindowId } from '@api/legacy/runtime'

export interface RendererWindowContext {
  windowId: number | null
  webContentsId: number | null
}

let cachedWindowContext: RendererWindowContext | null = null

function readWindowContext(): RendererWindowContext {
  try {
    return {
      windowId: getLegacyWindowId(),
      webContentsId: getLegacyWebContentsId()
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
