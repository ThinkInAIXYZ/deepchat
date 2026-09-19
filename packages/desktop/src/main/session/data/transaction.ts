export type SessionTransaction = {
  transaction<T>(operation: () => T): T
}
