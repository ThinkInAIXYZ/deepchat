export interface StoreLike<TStore extends Record<string, unknown> = Record<string, unknown>> {
  readonly path?: string
  readonly store: TStore
  get<TValue = unknown>(key: string): TValue | undefined
  get<TValue = unknown>(key: string, defaultValue: TValue): TValue
  set(key: string, value: unknown): void
  set(values: Record<string, unknown>): void
  delete(key: string): void
  clear?(): void
  has?(key: string): boolean
}
