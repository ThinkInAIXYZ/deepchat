// install duckdb extension
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function isMacOS() {
  return process.platform === 'darwin'
}

async function installVssExtension() {
  if (isMacOS()) {
    console.log('Skipping DuckDB extension installation on macOS')
    return
  }
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)

  try {
    const duckdb = await import('@duckdb/node-api')
    const inst = await duckdb.DuckDBInstance.create(':memory:')
    const conn = await inst.connect()

    await conn.run('INSTALL vss')
    const reader = await conn.runAndReadAll(
      'SELECT install_path FROM duckdb_extensions() WHERE extension_name = \'vss\''
    )
    const rows = reader.getRows()
    if (rows.length === 0) {
      throw new Error('VSS extension not found after installation')
    }
    const sourcePath = rows[0][0]
    if (!sourcePath || typeof sourcePath !== 'string') {
      throw new Error('Invalid extension path returned from DuckDB')
    }
    console.log('vss extension path:', sourcePath)

    const targetDir = path.join(__dirname, '../runtime/duckdb/extensions')
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const filename = sourcePath.substring(sourcePath.lastIndexOf(path.sep) + 1)
    const targetPath = path.join(targetDir, filename)
    fs.copyFileSync(sourcePath, targetPath)
    console.log('Install duckdb extension successfully.')
  } catch (error) {
    console.error('Failed to install DuckDB extension:', error.message)
    process.exit(1)
  }
}

installVssExtension()
