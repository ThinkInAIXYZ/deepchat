import fs from 'fs/promises'
import path from 'path'
import type { ACP_FILE_NODE } from '@shared/presenter'

// Ignored directory/file patterns
const IGNORED_PATTERNS = [
  'node_modules',
  '.git',
  '.DS_Store',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  '.cache',
  'coverage',
  '.next',
  '.nuxt',
  'out',
  '.turbo'
]

/**
 * Recursively read directory structure
 * @param dirPath Directory path
 * @param currentDepth Current depth
 * @param maxDepth Maximum depth
 */
export async function readDirectoryTree(
  dirPath: string,
  currentDepth: number = 0,
  maxDepth: number = 3
): Promise<ACP_FILE_NODE[]> {
  // Boundary check: depth limit
  if (currentDepth >= maxDepth) {
    return []
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const nodes: ACP_FILE_NODE[] = []

    for (const entry of entries) {
      // Skip ignored files/directories
      if (IGNORED_PATTERNS.includes(entry.name)) {
        continue
      }

      // Skip hidden files (starting with .)
      if (entry.name.startsWith('.')) {
        continue
      }

      const fullPath = path.join(dirPath, entry.name)
      const node: ACP_FILE_NODE = {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory()
      }

      // Recursively read subdirectories
      if (entry.isDirectory()) {
        node.children = await readDirectoryTree(fullPath, currentDepth + 1, maxDepth)
        node.expanded = false // Default collapsed
      }

      nodes.push(node)
    }

    // Sort: directories first, files second, same type sorted by name
    return nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  } catch (error) {
    console.error(`[AcpWorkspace] Failed to read directory ${dirPath}:`, error)
    return []
  }
}
