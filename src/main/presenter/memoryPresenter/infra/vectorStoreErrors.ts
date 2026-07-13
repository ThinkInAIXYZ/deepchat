export class MemoryVectorStoreMigrationPendingError extends Error {
  constructor() {
    super('[MemoryVectorStore] legacy v1 store migration is pending')
    this.name = 'MemoryVectorStoreMigrationPendingError'
  }
}
