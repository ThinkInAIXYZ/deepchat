import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { StoreLike } from '@/config/storeLike'
import type { StoreHost, StoreHostOptions } from '../storeHost'
import { nodeAppHost } from './appHost'

/**
 * JSON-file store for runtimes without Electron.
 *
 * Behavior mirrors `electron-store` for the operations DeepChat uses: `defaults`
 * are merged under the stored values, `get(key, fallback)` falls back without
 * persisting, `set(object)` merges shallowly, and writes are atomic. It does not
 * implement electron-store features DeepChat does not use (schema validation,
 * encryption, migrations, watch).
 */
class JsonFileStore<TStore extends Record<string, unknown>> implements StoreLike<TStore> {
  readonly path: string
  private data: TStore

  constructor(private readonly options: StoreHostOptions<TStore>) {
    const directory = options.cwd ?? nodeAppHost.getPath('userData')
    this.path = path.join(directory, `${options.name}.json`)
    this.data = this.read()
  }

  get store(): TStore {
    return { ...this.data }
  }

  get<TValue = unknown>(key: string, defaultValue?: TValue): TValue | undefined {
    const value = (this.data as Record<string, unknown>)[key]
    return value === undefined ? defaultValue : (value as TValue)
  }

  set(key: string, value: unknown): void
  set(values: Record<string, unknown>): void
  set(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
    if (typeof keyOrValues === 'string') {
      this.data = { ...this.data, [keyOrValues]: value }
    } else {
      this.data = { ...this.data, ...keyOrValues }
    }
    this.write()
  }

  delete(key: string): void {
    const next = { ...this.data } as Record<string, unknown>
    delete next[key]
    this.data = next as TStore
    this.write()
  }

  clear(): void {
    this.data = { ...(this.options.defaults ?? ({} as TStore)) }
    this.write()
  }

  has(key: string): boolean {
    return (this.data as Record<string, unknown>)[key] !== undefined
  }

  private read(): TStore {
    const defaults = this.options.defaults ?? ({} as TStore)
    if (!existsSync(this.path)) {
      return { ...defaults }
    }

    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as Record<string, unknown>
      return { ...defaults, ...parsed } as TStore
    } catch {
      // A corrupt settings file must not stop startup; keep the defaults and let the
      // next write replace the file.
      return { ...defaults }
    }
  }

  private write(): void {
    mkdirSync(path.dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp-${process.pid}`
    writeFileSync(temporaryPath, `${JSON.stringify(this.data, null, '\t')}\n`, {
      encoding: 'utf-8',
      mode: 0o600
    })
    renameSync(temporaryPath, this.path)
  }
}

/** Store host for a plain Node process such as the sidecar. */
export const nodeStoreHost: StoreHost = {
  create<TStore extends Record<string, unknown>>(
    options: StoreHostOptions<TStore>
  ): StoreLike<TStore> {
    return new JsonFileStore(options)
  }
}

/** Canonical name so the build can swap this module in for the electron one. */
export const storeHost = nodeStoreHost
