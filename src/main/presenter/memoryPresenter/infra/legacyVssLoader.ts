import logger from '@shared/logger'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'

import type { DuckDBConnection } from '@duckdb/node-api'
import { app } from 'electron'

const extensionSuffix = '.duckdb_extension'
const VSS_EXTENSION_NAME = `vss${extensionSuffix}`
const PACKAGED_VSS_ASSET_SUFFIX = '.b64'
const GUNZIP_ASYNC = promisify(gunzip)
const PACKAGED_VSS_MATERIALIZATION_PROMISES = new Map<string, Promise<string>>()

interface LegacyVssLoadFence {
  assertActive(): void
}

export function escapeDuckDbSqlPath(filePath: string): string {
  return filePath.replace(/\\/g, '\\\\').replace(/'/g, "''")
}

function materializationCacheKey(assetPath: string, materializationRoot: string): string {
  return `${path.resolve(assetPath)}\0${path.resolve(materializationRoot)}`
}

async function loadVssFromPath(
  connection: Pick<DuckDBConnection, 'run'>,
  extensionPath: string,
  source: string,
  fence?: LegacyVssLoadFence
): Promise<void> {
  await connection.run(`LOAD '${escapeDuckDbSqlPath(extensionPath)}';`)
  fence?.assertActive()
  logger.info(`[MemoryVectorStore] loaded ${source} VSS extension: ${extensionPath}`)
  await connection.run('SET hnsw_enable_experimental_persistence = true;')
  fence?.assertActive()
}

async function inflatePackagedVssExtension(
  assetPath: string,
  materializationRoot: string,
  fence?: LegacyVssLoadFence
): Promise<string> {
  const asset = await fs.promises.readFile(assetPath)
  fence?.assertActive()
  const digest = createHash('sha256').update(asset).digest('hex').slice(0, 16)
  const targetDir = path.join(materializationRoot, 'duckdb', 'extensions', digest)
  const targetPath = path.join(targetDir, VSS_EXTENSION_NAME)

  if (fs.existsSync(targetPath)) return targetPath

  fence?.assertActive()
  await fs.promises.mkdir(targetDir, { recursive: true })
  fence?.assertActive()
  const tempPath = path.join(targetDir, `.${VSS_EXTENSION_NAME}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const compressed = Buffer.from(asset.toString('utf8'), 'base64')
    const inflated = await GUNZIP_ASYNC(compressed)
    fence?.assertActive()
    await fs.promises.writeFile(tempPath, inflated)
    fence?.assertActive()
    if (fs.existsSync(targetPath)) {
      fence?.assertActive()
      await fs.promises.rm(tempPath, { force: true })
      fence?.assertActive()
      return targetPath
    }
    fence?.assertActive()
    await fs.promises.rename(tempPath, targetPath)
    fence?.assertActive()
  } catch (error) {
    fence?.assertActive()
    if (fs.existsSync(targetPath)) {
      fence?.assertActive()
      try {
        await fs.promises.rm(tempPath, { force: true })
      } catch {
        // Best-effort cleanup only.
      }
      fence?.assertActive()
      return targetPath
    }
    try {
      fence?.assertActive()
      await fs.promises.rm(tempPath, { force: true })
      fence?.assertActive()
    } catch {
      // Best-effort cleanup only.
    }
    throw error
  }
  return targetPath
}

async function materializePackagedVssExtension(
  assetPath: string,
  dbPath: string,
  fence?: LegacyVssLoadFence
): Promise<string> {
  const resolvedAssetPath = path.resolve(assetPath)
  const materializationRoot = path.resolve(app.getPath('userData') || path.dirname(dbPath))
  const cacheKey = materializationCacheKey(resolvedAssetPath, materializationRoot)
  const existing = PACKAGED_VSS_MATERIALIZATION_PROMISES.get(cacheKey)
  if (existing) {
    const existingPath = await existing
    fence?.assertActive()
    if (fs.existsSync(existingPath)) return existingPath
    if (PACKAGED_VSS_MATERIALIZATION_PROMISES.get(cacheKey) === existing) {
      PACKAGED_VSS_MATERIALIZATION_PROMISES.delete(cacheKey)
    } else {
      return materializePackagedVssExtension(resolvedAssetPath, dbPath, fence)
    }
  }

  let materializationPromise: Promise<string>
  materializationPromise = inflatePackagedVssExtension(
    resolvedAssetPath,
    materializationRoot,
    fence
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
  dbPath: string,
  fence?: LegacyVssLoadFence
): Promise<void> {
  const runtimeBasePath = path
    .join(app.getAppPath(), 'runtime')
    .replace('app.asar', 'app.asar.unpacked')
  const extensionDir = path.join(runtimeBasePath, 'duckdb', 'extensions')
  const extensionPath = path.join(extensionDir, VSS_EXTENSION_NAME)
  const packagedAssetPath = `${extensionPath}${PACKAGED_VSS_ASSET_SUFFIX}`
  if (fs.existsSync(extensionPath)) {
    try {
      await loadVssFromPath(connection, extensionPath, 'bundled', fence)
      return
    } catch (error) {
      const message = `[MemoryVectorStore] bundled VSS extension failed to load from ${extensionPath}: ${String(error)}`
      if (app.isPackaged || fence) {
        logger.error(`${message}. Vector recall disabled until a valid bundled extension ships.`)
        throw error
      }
      logger.warn(`${message}; falling back to network INSTALL vss in development.`)
    }
  } else if (app.isPackaged && fs.existsSync(packagedAssetPath)) {
    try {
      const materializedPath = await materializePackagedVssExtension(
        packagedAssetPath,
        dbPath,
        fence
      )
      fence?.assertActive()
      await loadVssFromPath(connection, materializedPath, 'materialized packaged', fence)
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
  fence?.assertActive()
  await connection.run('LOAD vss;')
  fence?.assertActive()
  await connection.run('SET hnsw_enable_experimental_persistence = true;')
  fence?.assertActive()
}
