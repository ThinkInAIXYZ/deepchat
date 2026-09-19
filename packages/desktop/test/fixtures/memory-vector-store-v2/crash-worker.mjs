import { DuckDBInstance, arrayValue } from '@duckdb/node-api'
import fs from 'node:fs'

const CRASH_EXIT_CODE = 73

function parseJsonArgument(index, label) {
  const raw = process.argv[index]
  if (!raw) throw new Error(`Missing serialized ${label}`)
  return JSON.parse(raw)
}

async function openDatabase(dbPath) {
  const instance = await DuckDBInstance.create(dbPath)
  const connection = await instance.connect()
  return { instance, connection }
}

async function createV2(dbPath, formatPlan, { checkpoint = false, close = false } = {}) {
  const { instance, connection } = await openDatabase(dbPath)
  await connection.run(formatPlan.createVectorTableSql)
  await connection.run(formatPlan.createMetaTableSql)
  await connection.run(formatPlan.insertMetaSql, formatPlan.metaParams)
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

async function createPartialStaging(dbPath, includeRow, formatPlan) {
  const { connection } = await openDatabase(dbPath)
  await connection.run(formatPlan.createVectorTableSql)
  if (includeRow) {
    await connection.run(
      'INSERT INTO memory_vector (memory_id, embedding) VALUES (?, ?::FLOAT[]);',
      ['partial-row', arrayValue([0, 1])]
    )
  }
}

async function holdLegacy(paths, statements, writeMarker) {
  const { connection } = await openDatabase(':memory:')
  for (const statement of statements) await connection.run(statement)
  if (writeMarker) fs.writeFileSync(paths.quarantine, '')
  process.stdout.write('READY\n')
  setInterval(() => undefined, 60_000)
}

async function main() {
  const mode = process.argv[2]
  const paths = parseJsonArgument(3, 'vector store paths')
  const formatPlan = parseJsonArgument(4, 'v2 format plan')

  switch (mode) {
    case 'staging-schema':
      await createPartialStaging(paths.staging, false, formatPlan)
      break
    case 'staging-write':
      await createPartialStaging(paths.staging, true, formatPlan)
      break
    case 'checkpoint-before':
      await createV2(paths.staging, formatPlan)
      break
    case 'checkpoint-after':
    case 'rename-before':
      await createV2(paths.staging, formatPlan, { checkpoint: true, close: true })
      break
    case 'rename-after':
      await createV2(paths.staging, formatPlan, { checkpoint: true, close: true })
      fs.renameSync(paths.staging, paths.current)
      fs.writeFileSync(paths.legacy, 'legacy-cleanup-pending')
      break
    case 'v2-wal':
      await createV2(paths.current, formatPlan)
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
    case 'marker-after-delete':
      break
    case 'marker-during-publish':
      await createPartialStaging(paths.staging, true, formatPlan)
      break
    case 'hold-legacy':
      await holdLegacy(paths, parseJsonArgument(5, 'legacy hold statements'), false)
      return
    case 'hold-quarantined-legacy':
      await holdLegacy(paths, parseJsonArgument(5, 'legacy hold statements'), true)
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
