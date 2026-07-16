export const MEMORY_VECTOR_STORE_FORMAT_VERSION = 2
export const MEMORY_VECTOR_STORE_TABLES = {
  vector: 'memory_vector',
  meta: 'embedding_meta'
} as const

export interface MemoryVectorStoreV2FormatPlan {
  createVectorTableSql: string
  createMetaTableSql: string
  insertMetaSql: string
  metaParams: [providerId: string, modelId: string, dimensions: number, formatVersion: number]
}

export function assertMemoryVectorDimensions(dimensions: number): void {
  if (!Number.isSafeInteger(dimensions) || dimensions <= 0) {
    throw new Error(`[MemoryVectorStore] invalid vector dimensions: ${String(dimensions)}`)
  }
}

export function createMemoryVectorStoreV2FormatPlan(
  dimensions: number,
  embedding: { providerId: string; modelId: string }
): MemoryVectorStoreV2FormatPlan {
  assertMemoryVectorDimensions(dimensions)
  return {
    createVectorTableSql: `CREATE TABLE ${MEMORY_VECTOR_STORE_TABLES.vector} (
         memory_id VARCHAR PRIMARY KEY,
         embedding FLOAT[${dimensions}]
       );`,
    createMetaTableSql: `CREATE TABLE ${MEMORY_VECTOR_STORE_TABLES.meta} (
         provider VARCHAR NOT NULL,
         model VARCHAR NOT NULL,
         dim INTEGER NOT NULL,
         format_version INTEGER NOT NULL
       );`,
    insertMetaSql: `INSERT INTO ${MEMORY_VECTOR_STORE_TABLES.meta} (provider, model, dim, format_version) VALUES (?, ?, ?, ?);`,
    metaParams: [
      embedding.providerId,
      embedding.modelId,
      dimensions,
      MEMORY_VECTOR_STORE_FORMAT_VERSION
    ]
  }
}

export function readSafeMemoryVectorRowCount(
  rows: readonly Record<string, unknown>[],
  context: string
): number {
  const rawRowCount = rows[0]?.row_count
  const rowCount =
    typeof rawRowCount === 'number' || typeof rawRowCount === 'bigint'
      ? Number(rawRowCount)
      : typeof rawRowCount === 'string' && /^(0|[1-9]\d*)$/.test(rawRowCount)
        ? Number(rawRowCount)
        : Number.NaN
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) {
    throw new Error(`[MemoryVectorStore] invalid ${context} row count: ${String(rawRowCount)}`)
  }
  return rowCount
}
