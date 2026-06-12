type RendererRuntimeApi = Window['api']

function getRendererRuntimeApi(): RendererRuntimeApi {
  if (!window.api) {
    throw new Error('window.api is not available')
  }

  return window.api
}

export function copyRuntimeText(text: string): void {
  getRendererRuntimeApi().copyText(text)
}

export function copyRuntimeImage(image: string): void {
  getRendererRuntimeApi().copyImage(image)
}

export function readRuntimeClipboardText(): string {
  return getRendererRuntimeApi().readClipboardText()
}

export function getRuntimePathForFile(file: File): string {
  return getRendererRuntimeApi().getPathForFile(file) ?? ''
}

export function getRuntimeWindowId(): number | null {
  return getRendererRuntimeApi().getWindowId() ?? null
}

export function getRuntimeWebContentsId(): number | null {
  return getRendererRuntimeApi().getWebContentsId?.() ?? null
}

export async function openRuntimeExternal(url: string): Promise<void> {
  const runtimeApi = getRendererRuntimeApi()
  if (!runtimeApi.openExternal) {
    throw new Error('window.api.openExternal is not available')
  }

  await runtimeApi.openExternal(url)
}

export function toRuntimeRelativePath(filePath: string, baseDir?: string): string {
  return getRendererRuntimeApi().toRelativePath?.(filePath, baseDir) ?? filePath
}

export function formatRuntimePathForInput(filePath: string): string {
  return getRendererRuntimeApi().formatPathForInput?.(filePath) ?? filePath
}
