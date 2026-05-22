import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const duckdbPackage = require('@duckdb/node-api/package.json')

async function main() {
  console.log(`[DuckDB Smoke] package version: ${duckdbPackage.version}`)

  const duckdb = await import('@duckdb/node-api')
  const instance = await duckdb.DuckDBInstance.create(':memory:')
  const connection = await instance.connect()

  try {
    console.log('[DuckDB Smoke] created in-memory instance')
    await connection.run('INSTALL vss')
    console.log('[DuckDB Smoke] installed vss')
    await connection.run('LOAD vss')
    console.log('[DuckDB Smoke] loaded vss')
  } finally {
    connection.closeSync()
    instance.closeSync()
  }
}

main().catch((error) => {
  console.error('[DuckDB Smoke] failed:', error)
  process.exit(1)
})
