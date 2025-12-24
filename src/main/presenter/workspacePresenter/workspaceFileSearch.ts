import fs from 'fs/promises'
import path from 'path'
import type { WorkspaceFileNode } from '@shared/presenter'
import { searchFiles } from './fileSearcher'
import { resolveWorkspacePath } from './pathResolver'
import { checkSensitiveFile, isBinaryFile } from './fileSecurity'

const DEFAULT_RESULT_LIMIT = 50

const escapeGlob = (input: string) => input.replace(/[\\*?\[\]]/g, '\\$&')

const buildFileNode = (filePath: string): WorkspaceFileNode => ({
  name: path.basename(filePath),
  path: filePath,
  isDirectory: false
})

const scoreMatch = (workspaceRoot: string, filePath: string, query: string): number => {
  const normalizedPath = path.normalize(filePath)
  const normalizedQuery = query.toLowerCase()
  const baseName = path.basename(normalizedPath).toLowerCase()
  const relativePath = path
    .relative(workspaceRoot, normalizedPath)
    .split(path.sep)
    .join('/')
    .toLowerCase()

  if (normalizedPath.toLowerCase() === query.toLowerCase()) return 100
  if (relativePath === normalizedQuery) return 95
  if (baseName === normalizedQuery) return 90
  if (baseName.startsWith(normalizedQuery)) return 80
  if (baseName.includes(normalizedQuery)) return 70
  if (relativePath.includes(normalizedQuery)) return 60
  return 50
}

export async function searchWorkspaceFiles(
  workspacePath: string,
  query: string
): Promise<WorkspaceFileNode[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  // Handle special case: if query is "**/*", use it directly as glob pattern
  // This is used when user just types "@" to show some files
  if (trimmed === '**/*') {
    const result = await searchFiles(workspacePath, trimmed, {
      maxResults: DEFAULT_RESULT_LIMIT,
      sortBy: 'name'
    })

    return result.files
      .filter((filePath) => {
        try {
          checkSensitiveFile(filePath)
          return !isBinaryFile(filePath)
        } catch {
          return false
        }
      })
      .map((filePath) => buildFileNode(filePath))
  }

  const resolved = resolveWorkspacePath(workspacePath, trimmed)
  if (resolved) {
    try {
      const stats = await fs.stat(resolved)
      if (stats.isFile()) {
        checkSensitiveFile(resolved)
        if (!isBinaryFile(resolved)) {
          return [buildFileNode(resolved)]
        }
      }
    } catch {
      // Fall through to fuzzy search.
    }
  }

  const hasSeparator = trimmed.includes('/') || trimmed.includes('\\')
  const escaped = escapeGlob(trimmed)
  const globPattern = hasSeparator ? `**/${escaped}*` : `**/*${escaped}*`

  const result = await searchFiles(workspacePath, globPattern, {
    maxResults: DEFAULT_RESULT_LIMIT,
    sortBy: 'name'
  })

  const ranked = result.files
    .map((filePath) => ({
      filePath,
      score: scoreMatch(workspacePath, filePath, trimmed)
    }))
    .filter(({ filePath }) => {
      try {
        checkSensitiveFile(filePath)
        return !isBinaryFile(filePath)
      } catch {
        return false
      }
    })
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))

  return ranked.map(({ filePath }) => buildFileNode(filePath))
}
