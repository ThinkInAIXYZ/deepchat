import type { StoreLike } from '../../src/main/config/storeLike'

export function createMemoryStore<TStore extends Record<string, unknown> = Record<string, unknown>>(
  initial: TStore = {} as TStore
): StoreLike<TStore> {
  const data: Record<string, unknown> = structuredClone(initial)
  return {
    get store() {
      return { ...data } as TStore
    },
    get<TValue = unknown>(key: string, defaultValue?: TValue): TValue {
      return (data[key] === undefined ? defaultValue : data[key]) as TValue
    },
    set(keyOrValues: string | Record<string, unknown>, value?: unknown) {
      if (typeof keyOrValues === 'string') data[keyOrValues] = value
      else Object.assign(data, keyOrValues)
    },
    delete(key: string) {
      delete data[key]
    },
    has: (key) => Object.hasOwn(data, key),
    clear() {
      for (const key of Object.keys(data)) delete data[key]
    }
  }
}
