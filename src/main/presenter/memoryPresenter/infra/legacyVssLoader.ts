import logger from '@shared/logger'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'

import type { DuckDBConnection } from '@duckdb/node-api'
import { app } from 'electron'

const runtimeBasePath = path
  .join(app.getAppPath(), 'runtime')
  .replace('app.asar', 'app.asar.unpacked')
const extensionDir = path.join(runtimeBasePath, 'duckdb', 'extensions')
const extensionSuffix = '.duckdb_extension'
const VSS_EXTENSION_NAME = `vss${extensionSuffix}`
const PACKAGED_VSS_ASSET_SUFFIX = '.b64'
const GUNZIP_ASYNC = promisify(gunzip)
const PACKAGED_VSS_MATERIALIZATION_PROMISES = new Map<string, Promise<string>>()

export function escapeDuckDbSqlPath(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\').replace(/'/g, "''")
}

function materializationCacheKey(assetPath: string, materializationRoot: string): string {
  return `${path.resolve(assetPath)}\0${path.resolve(materializationRoot)}`
}

async function loadVssFromPath(
  connection: Pick<DuckDBConnection, 'run'>,
  extensionPath: string,
  source: string
): Promise<void> {
  await connection.run(`LOAD '${escapeDuckDbSqlPath(extensionPath)}';`)
  logger.info(`[MemoryVectorStore] loaded ${source} VSS extension: ${extensionPath}`)
  await connection.run('SET hnsw_enable_experimental_persistence = true;')
}

async function inflatePackagedVssExtension(
  assetPath: string,
  materializationRoot: string
): Promise<string> {
  const asset = await fs.promises.readFile(assetPath)
  const digest = createHash('sha256').update(asset).digest('hex').slice(0, 16)
  const targetDir = path.join(materializationRoot, 'duckdb', 'extensions', digest)
  const targetPath = path.join(targetDir, VSS_EXTENSION_NAME)

  if (fs.existsSync(targetPath)) return targetPath

  await fs.promises.mkdir(targetDir, { recursive: true })
  const tempPath = path.join(targetDir, `.${VSS_EXTENSION_NAME}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const compressed = Buffer.from(asset.toString('utf8'), 'base64')
    await fs.promises.writeFile(tempPath, await GUNZIP_ASYNC(compressed))
    if (fs.existsSync(targetPath)) {
      await fs.promises.rm(tempPath, { force: true })
      return targetPath
    }
    await fs.promises.rename(tempPath, targetPath)
  } catch (error) {
    if (fs.existsSync(targetPath)) {
      try {
        await fs.promises.rm(tempPath, { force: true })
      } catch {
        // Best-effort cleanup only.
      }
      return targetPath
    }
    try {
      await fs.promises.rm(tempPath, { force: true })
    } catch {
      // Best-effort cleanup only.
    }
    throw error
  }
  return targetPath
}

async function materializePackagedVssExtension(assetPath: string, dbPath: string): Promise<string> {
  const resolvedAssetPath = path.resolve(assetPath)
  const materializationRoot = path.resolve(app.getPath('userData') || path.dirname(dbPath))
  const cacheKey = materializationCacheKey(resolvedAssetPath, materializationRoot)
  const existing = PACKAGED_VSS_MATERIALIZATION_PROMISES.get(cacheKey)
  if (existing) {
    const existingPath = await existing
    if (fs.existsSync(existingPath)) return existingPath
    if (PACKAGED_VSS_MATERIALIZATION_PROMISES.get(cacheKey) === existing) {
      PACKAGED_VSS_MATERIALIZATION_PROMISES.delete(cacheKey)
    } else {
      return materializePackagedVssExtension(resolvedAssetPath, dbPath)
    }
  }

  let materializationPromise: Promise<string>
  materializationPromise = inflatePackagedVssExtension(
    resolvedAssetPath,
    materializationRoot
  ).catch((error) => {
    if (PACKAGED_VSS_MATERIALIZATION_PROMISES.get(cacheKey) === materializationPromise) {
      PACKAGED_VSS_MATERIALIZATION_PROMISES.delete(cacheKey)
    }
    throw error
  })
  PACKAGED_VSS_MATERIALIZATION_PROMISES.set(cacheKey, materializationPromise)
  return materializationPromise
}

export async function loadLegacyVss(
  connection: Pick<DuckDBConnection, 'run'>,
  dbPath: string
): Promise<void> {
  const extensionPath = path.join(extensionDir, VSS_EXTENSION_NAME)
  const packagedAssetPath = `${extensionPath}${PACKAGED_VSS_ASSET_SUFFIX}`
  if (fs.existsSync(extensionPath)) {
    try {
      await loadVssFromPath(connection, extensionPath, 'bundled')
      return
    } catch (error) {
      const message = `[MemoryVectorStore] bundled VSS extension failed to load from ${extensionPath}: ${String(error)}`
      if (app.isPackaged) {
        logger.error(`${message}. Vector recall disabled until a valid bundled extension ships.`)
        throw error
      }
      logger.warn(`${message}; falling back to network INSTALL vss in development.`)
    }
  } else if (app.isPackaged && fs.existsSync(packagedAssetPath)) {
    try {
      const materializedPath = await materializePackagedVssExtension(packagedAssetPath, dbPath)
      await loadVssFromPath(connection, materializedPath, 'materialized packaged')
      return
    } catch (error) {
      logger.error(
        `[MemoryVectorStore] packaged VSS extension failed to materialize/load from ${packagedAssetPath}: ${String(error)}. Vector recall disabled until a valid bundled extension ships.`
      )
      throw error
    }
  } else {
    const message = `[MemoryVectorStore] bundled VSS extension missing at ${extensionPath} or ${packagedAssetPath}. Run installRuntime:duckdb:vss before packaging.`
    if (app.isPackaged) {
      logger.error(`${message} Vector recall disabled until a valid bundled extension ships.`)
      throw new Error(message)
    }
    logger.warn(`${message} Falling back to network INSTALL vss in development.`)
  }
  await connection.run('INSTALL vss;')
  await connection.run('LOAD vss;')
  await connection.run('SET hnsw_enable_experimental_persistence = true;')
}
