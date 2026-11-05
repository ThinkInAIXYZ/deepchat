import { net } from 'electron'
import type { NetHost } from '../netHost'

export const electronNetHost: NetHost = {
  async fetch(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
    return init?.signal ? await net.fetch(url, { signal: init.signal }) : await net.fetch(url)
  }
}
