import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

const require = createRequire(import.meta.url)
const duckdbPackage = require('@duckdb/node-api/package.json')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const extensionName = 'vss.duckdb_extension'

export function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (!arg.startsWith('--')) continue
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    let value = inlineValue
    if (value === undefined) {
      const next = argv[index + 1]
      if (next === undefined || next === '--' || next.startsWith('--')) {
        throw new Error(`Missing value for --${rawKey}`)
      }
      value = next
      index += 1
    }
    options[rawKey] = value
  }
  return options
}

function normalizePlatform(value) {
  switch (value) {
    case 'darwin':
    case 'mac':
    case 'macos':
    case 'osx':
      return 'darwin'
    case 'win32':
    case 'windows':
    case 'win':
      return 'win32'
    case 'linux':
      return 'linux'
    default:
      throw new Error(`Unsupported DuckDB VSS platform: ${value}`)
  }
}

function normalizeArch(value) {
  switch (value) {
    case 'x64':
    case 'amd64':
      return 'x64'
    case 'arm64':
    case 'aarch64':
      return 'arm64'
    default:
      throw new Error(`Unsupported DuckDB VSS architecture: ${value}`)
  }
}

function escapeSqlPath(filePath) {
  return filePath.replace(/\\/g, '\\\\').replace(/'/g, "''")
}

function removeMaterializedDirBestEffort(materializedDir) {
  try {
    fs.rmSync(materializedDir, { recursive: true, force: true })
  } catch {
    // best effort cleanup only
  }
}

export function materializeBase64Extension(base64Path) {
  console.log(`[DuckDB Smoke] extension base64 path: ${base64Path}`)
  if (!fs.existsSync(base64Path)) {
    throw new Error(`Bundled VSS base64 extension not found at ${base64Path}`)
  }
  const materializedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-duckdb-vss-smoke-'))
  const extensionPath = path.join(materializedDir, extensionName)
  try {
    const compressed = Buffer.from(fs.readFileSync(base64Path, 'utf8'), 'base64')
    fs.writeFileSync(extensionPath, zlib.gunzipSync(compressed))
    return { extensionPath, materializedDir }
  } catch (error) {
    removeMaterializedDirBestEffort(materializedDir)
    throw error
  }
}

export function materializeGzipExtension(gzipPath) {
  console.log(`[DuckDB Smoke] extension gzip path: ${gzipPath}`)
  if (!fs.existsSync(gzipPath)) {
    throw new Error(`Bundled VSS gzip extension not found at ${gzipPath}`)
  }
  const materializedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-duckdb-vss-smoke-'))
  const extensionPath = path.join(materializedDir, extensionName)
  try {
    fs.writeFileSync(extensionPath, zlib.gunzipSync(fs.readFileSync(gzipPath)))
    return { extensionPath, materializedDir }
  } catch (error) {
    removeMaterializedDirBestEffort(materializedDir)
    throw error
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const platform = args.platform ? normalizePlatform(args.platform) : process.platform
  const arch = args.arch ? normalizeArch(args.arch) : process.arch
  const extensionBase64Path = args.extensionBase64Path ?? args['extension-base64-path']
  const extensionGzipPath = args.extensionGzipPath ?? args['extension-gzip-path']
  let materializedDir = null
  let instance = null
  let connection = null
  let extensionPath = path.resolve(
    args.extensionPath ??
      args['extension-path'] ??
      path.join(__dirname, '../runtime/duckdb/extensions', extensionName)
  )

  if (extensionBase64Path) {
    const materialized = materializeBase64Extension(path.resolve(extensionBase64Path))
    extensionPath = materialized.extensionPath
    materializedDir = materialized.materializedDir
  } else if (extensionGzipPath) {
    const materialized = materializeGzipExtension(path.resolve(extensionGzipPath))
    extensionPath = materialized.extensionPath
    materializedDir = materialized.materializedDir
  }

  console.log(`[DuckDB Smoke] package version: ${duckdbPackage.version}`)
  console.log(`[DuckDB Smoke] extension path: ${extensionPath}`)

  if (!fs.existsSync(extensionPath)) {
    throw new Error(
      `Bundled VSS extension not found at ${extensionPath}. Run pnpm run installRuntime:duckdb:vss first.`
    )
  }

  try {
    if (platform !== process.platform || arch !== process.arch) {
      console.log(
        `[DuckDB Smoke] target ${platform}/${arch} differs from host ${process.platform}/${process.arch}; verified file presence only.`
      )
      return
    }

    const duckdb = await import('@duckdb/node-api')
    instance = await duckdb.DuckDBInstance.create(':memory:')
    connection = await instance.connect()

    console.log('[DuckDB Smoke] created in-memory instance')
    await connection.run(`LOAD '${escapeSqlPath(extensionPath)}';`)
    console.log('[DuckDB Smoke] loaded bundled vss by path')
    await connection.run('SET hnsw_enable_experimental_persistence = true;')
    await connection.run('CREATE TABLE vss_smoke (id INTEGER, embedding FLOAT[2]);')
    await connection.run(
      "CREATE INDEX idx_vss_smoke ON vss_smoke USING HNSW (embedding) WITH (metric='cosine');"
    )
    console.log('[DuckDB Smoke] created HNSW index')
  } finally {
    try {
      connection?.closeSync()
    } catch {
      // best effort cleanup only
    }
    try {
      instance?.closeSync()
    } catch {
      // best effort cleanup only
    }
    if (materializedDir) {
      removeMaterializedDirBestEffort(materializedDir)
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error('[DuckDB Smoke] failed:', error)
    process.exit(1)
  })
}
