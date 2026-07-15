import fs from 'fs/promises'
import path from 'path'
import type { WorkspaceFileNode } from '@shared/presenter'

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
 * Read directory structure shallowly (only first level)
 * Directories will have children = undefined, indicating not yet loaded
 * @param dirPath Directory path
 */
export async function readDirectoryShallow(dirPath: string): Promise<WorkspaceFileNode[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const nodes: WorkspaceFileNode[] = []

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
      const node: WorkspaceFileNode = {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory()
      }

      // For directories, leave children as undefined (lazy load)
      if (entry.isDirectory()) {
        node.expanded = false
        // children is intentionally undefined - will be loaded on expand
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
    console.error(`[Workspace] Failed to read directory ${dirPath}:`, error)
    return []
  }
}
