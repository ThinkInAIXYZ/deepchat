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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const platform = args.platform ? normalizePlatform(args.platform) : process.platform
  const arch = args.arch ? normalizeArch(args.arch) : process.arch
  const extensionGzipPath = args.extensionGzipPath ?? args['extension-gzip-path']
  let materializedDir = null
  let extensionPath = path.resolve(
    args.extensionPath ??
      args['extension-path'] ??
      path.join(__dirname, '../runtime/duckdb/extensions', extensionName)
  )

  if (extensionGzipPath) {
    const gzipPath = path.resolve(extensionGzipPath)
    console.log(`[DuckDB Smoke] extension gzip path: ${gzipPath}`)
    if (!fs.existsSync(gzipPath)) {
      throw new Error(`Bundled VSS gzip extension not found at ${gzipPath}`)
    }
    materializedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepchat-duckdb-vss-smoke-'))
    extensionPath = path.join(materializedDir, extensionName)
    fs.writeFileSync(extensionPath, zlib.gunzipSync(fs.readFileSync(gzipPath)))
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
    const instance = await duckdb.DuckDBInstance.create(':memory:')
    const connection = await instance.connect()

    console.log('[DuckDB Smoke] created in-memory instance')
    try {
      await connection.run(`LOAD '${escapeSqlPath(extensionPath)}';`)
      console.log('[DuckDB Smoke] loaded bundled vss by path')
      await connection.run('SET hnsw_enable_experimental_persistence = true;')
      await connection.run('CREATE TABLE vss_smoke (id INTEGER, embedding FLOAT[2]);')
      await connection.run(
        "CREATE INDEX idx_vss_smoke ON vss_smoke USING HNSW (embedding) WITH (metric='cosine');"
      )
      console.log('[DuckDB Smoke] created HNSW index')
    } finally {
      connection.closeSync()
      instance.closeSync()
    }
  } finally {
    if (materializedDir) {
      fs.rmSync(materializedDir, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error('[DuckDB Smoke] failed:', error)
    process.exit(1)
  })
}
