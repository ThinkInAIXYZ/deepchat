import path from 'node:path'
import fs from 'node:fs'

export const MEMORY_VECTOR_OWNER_FILE = '.vector-owner.duckdb'
export const MEMORY_VECTOR_LEASE_SUFFIX = '.v2.duckdb.lease'

export interface MemoryVectorStorePaths {
  current: string
  staging: string
  quarantine: string
  legacy: string
}

export function persistMemoryVectorQuarantine(paths: MemoryVectorStorePaths): void {
  fs.mkdirSync(path.dirname(paths.quarantine), { recursive: true })
  try {
    fs.writeFileSync(paths.quarantine, '', { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

export function createMemoryVectorStorePaths(
  memoryDbDir: string,
  agentId: string
): MemoryVectorStorePaths {
  const current = path.join(memoryDbDir, `${agentId}.v2.duckdb`)
  return {
    current,
    staging: `${current}.migrating`,
    quarantine: `${current}.quarantine`,
    legacy: path.join(memoryDbDir, `${agentId}.duckdb`)
  }
}
