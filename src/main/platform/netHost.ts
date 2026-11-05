/**
 * HTTP boundary for main-process requests that must honour the user's proxy.
 *
 * DeepChat downloads remote images, ACP registry icons and channel attachments
 * from main. Electron's `net.fetch` uses Chromium's network stack, which is why
 * it is used instead of global `fetch`; a mygo shell can back this with a Go
 * HTTP client configured from the same proxy settings.
 */
export interface NetHost {
  fetch(url: string, init?: { signal?: AbortSignal }): Promise<Response>
}

export { electronNetHost as netHost } from './electron/netHost'
