import { windowGetRuntimeIdentityRoute } from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

type RendererRuntimeApi = Window['api']

type RuntimeIdentity = {
  windowId: number | null
  webContentsId: number
}

let runtimeIdentityPromise: Promise<RuntimeIdentity> | null = null

function getRendererRuntimeApi(): RendererRuntimeApi {
  if (!window.api) {
    throw new Error('window.api is not available')
  }

  return window.api
}

async function getRuntimeIdentity(): Promise<RuntimeIdentity> {
  if (!runtimeIdentityPromise) {
    runtimeIdentityPromise = getDeepchatBridge()
      .invoke(windowGetRuntimeIdentityRoute.name, {})
      .then((result) => ({
        windowId: result.windowId,
        webContentsId: result.webContentsId
      }))
      .catch((error) => {
        runtimeIdentityPromise = null
        throw error
      })
  }

  return await runtimeIdentityPromise
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

export async function getRuntimeWindowId(): Promise<number | null> {
  return (await getRuntimeIdentity()).windowId
}

export async function getRuntimeWebContentsId(): Promise<number | null> {
  return (await getRuntimeIdentity()).webContentsId
}

export function getRuntimePlatform(): string | undefined {
  return getRendererRuntimeApi().getPlatform?.()
}

export function getRuntimeArch(): string | undefined {
  return getRendererRuntimeApi().getArch?.()
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
