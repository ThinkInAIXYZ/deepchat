import { DuckDBInstance, arrayValue } from '@duckdb/node-api'
import fs from 'node:fs'

const CRASH_EXIT_CODE = 73

function parsePaths() {
  const raw = process.argv[3]
  if (!raw) throw new Error('Missing serialized vector store paths')
  return JSON.parse(raw)
}

async function openDatabase(dbPath) {
  const instance = await DuckDBInstance.create(dbPath)
  const connection = await instance.connect()
  return { instance, connection }
}

async function createV2(dbPath, { checkpoint = false, close = false } = {}) {
  const { instance, connection } = await openDatabase(dbPath)
  await connection.run(
    'CREATE TABLE memory_vector (memory_id VARCHAR PRIMARY KEY, embedding FLOAT[2]);'
  )
  await connection.run(
    'CREATE TABLE embedding_meta (provider VARCHAR NOT NULL, model VARCHAR NOT NULL, dim INTEGER NOT NULL, format_version INTEGER NOT NULL);'
  )
  await connection.run(
    'INSERT INTO embedding_meta (provider, model, dim, format_version) VALUES (?, ?, ?, ?);',
    ['p', 'm', 2, 2]
  )
  await connection.run('INSERT INTO memory_vector (memory_id, embedding) VALUES (?, ?::FLOAT[]);', [
    'crash-row',
    arrayValue([1, 0])
  ])
  if (checkpoint) await connection.run('CHECKPOINT;')
  if (close) {
    connection.closeSync()
    instance.closeSync()
  }
}

async function createPartialStaging(dbPath, includeRow) {
  const { connection } = await openDatabase(dbPath)
  await connection.run(
    'CREATE TABLE memory_vector (memory_id VARCHAR PRIMARY KEY, embedding FLOAT[2]);'
  )
  if (includeRow) {
    await connection.run(
      'INSERT INTO memory_vector (memory_id, embedding) VALUES (?, ?::FLOAT[]);',
      ['partial-row', arrayValue([0, 1])]
    )
  }
}

async function holdLegacy(paths, extensionPath, writeMarker) {
  const { connection } = await openDatabase(':memory:')
  const escapedExtension = extensionPath.replace(/\\/g, '\\\\').replace(/'/g, "''")
  const escapedLegacy = paths.legacy.replace(/\\/g, '\\\\').replace(/'/g, "''")
  await connection.run(`LOAD '${escapedExtension}';`)
  await connection.run('SET hnsw_enable_experimental_persistence = true;')
  await connection.run(`ATTACH '${escapedLegacy}' AS legacy (READ_ONLY);`)
  if (writeMarker) fs.writeFileSync(paths.quarantine, '')
  process.stdout.write('READY\n')
  setInterval(() => undefined, 60_000)
}

async function main() {
  const mode = process.argv[2]
  const paths = parsePaths()

  switch (mode) {
    case 'staging-schema':
      await createPartialStaging(paths.staging, false)
      break
    case 'staging-write':
      await createPartialStaging(paths.staging, true)
      break
    case 'checkpoint-before':
      await createV2(paths.staging)
      break
    case 'checkpoint-after':
    case 'rename-before':
      await createV2(paths.staging, { checkpoint: true, close: true })
      break
    case 'rename-after':
      await createV2(paths.staging, { checkpoint: true, close: true })
      fs.renameSync(paths.staging, paths.current)
      fs.writeFileSync(paths.legacy, 'legacy-cleanup-pending')
      break
    case 'v2-wal':
      await createV2(paths.current)
      break
    case 'marker-before-sweep':
      fs.writeFileSync(paths.quarantine, '')
      fs.writeFileSync(paths.current, 'old-current')
      fs.writeFileSync(`${paths.current}.wal`, 'old-current-wal')
      fs.writeFileSync(paths.staging, 'old-staging')
      fs.writeFileSync(`${paths.staging}.wal`, 'old-staging-wal')
      fs.writeFileSync(paths.legacy, 'old-legacy')
      fs.writeFileSync(`${paths.legacy}.wal`, 'old-legacy-wal')
      break
    case 'marker-after-sweep':
      fs.writeFileSync(paths.quarantine, '')
      break
    case 'marker-after-publish':
      fs.writeFileSync(paths.quarantine, '')
      await createV2(paths.current, { checkpoint: true, close: true })
      break
    case 'hold-legacy':
      await holdLegacy(paths, process.argv[4], false)
      return
    case 'hold-quarantined-legacy':
      await holdLegacy(paths, process.argv[4], true)
      return
    default:
      throw new Error(`Unknown crash worker mode: ${String(mode)}`)
  }

  process.exit(CRASH_EXIT_CODE)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
