/**
 * Persistent JSON store boundary.
 *
 * Main keeps small settings files (app settings, MCP, model config, plugin
 * state) in `electron-store`, which depends on Electron for its user-data
 * directory. A Node sidecar cannot load it, so this boundary provides the same
 * `StoreLike` surface from either runtime.
 *
 * The Electron implementation wraps `electron-store` unchanged, so file names,
 * locations and on-disk format stay identical. The Node implementation writes
 * the same JSON files with the same defaults merge, which lets the existing
 * settings survive the move to a sidecar.
 */
import type { StoreLike } from '@/config/storeLike'

export interface StoreHostOptions<TStore extends Record<string, any>> {
  /** File name without the extension, e.g. `app-settings`. */
  name: string
  defaults?: TStore
  /** Directory holding the file; the app's user-data directory by default. */
  cwd?: string
}

export interface StoreHost {
  create<TStore extends Record<string, any>>(options: StoreHostOptions<TStore>): StoreLike<TStore>
}

export { electronStoreHost as storeHost } from './electron/storeHost'
