import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { protocol } from 'electron'

export const WORKSPACE_PREVIEW_PROTOCOL = 'workspace-preview'

/**
 * Bidirectional map for managing path-to-id mappings
 */
class BidirectionalMap {
  private readonly pathToId = new Map<string, string>()
  private readonly idToPath = new Map<string, string>()

  getIdByPath(path: string): string | undefined {
    return this.pathToId.get(path)
  }

  getPathById(id: string): string | undefined {
    return this.idToPath.get(id)
  }

  set(path: string, id: string): void {
    this.pathToId.set(path, id)
    this.idToPath.set(id, path)
  }

  deleteByPath(path: string): void {
    const id = this.pathToId.get(path)
    if (id) {
      this.pathToId.delete(path)
      this.idToPath.delete(id)
    }
  }

  clear(): void {
    this.pathToId.clear()
    this.idToPath.clear()
  }
}

const workspaceRegistry = new BidirectionalMap()
const fileRegistry = new BidirectionalMap()

let schemesRegistered = false

function normalizePathForAccess(targetPath: string): string {
  try {
    return path.normalize(fs.realpathSync(targetPath))
  } catch {
    return path.normalize(path.resolve(targetPath))
  }
}

function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath)
  return (
    relativePath === '' ||
    (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  )
}

/**
 * Get or create an ID for a given path using the specified registry
 * @param registry The bidirectional map to use
 * @param path The path to get/create an ID for
 * @param prefix Optional prefix for the generated ID
 */
function getOrCreateId(registry: BidirectionalMap, path: string, prefix = ''): string {
  const existingId = registry.getIdByPath(path)
  if (existingId) {
    return existingId
  }

  const hash = createHash('sha256').update(path).digest('hex')
  const id = prefix ? `${prefix}${hash}` : hash
  registry.set(path, id)
  return id
}

function getOrCreateWorkspaceId(workspaceRoot: string): string {
  return getOrCreateId(workspaceRegistry, workspaceRoot)
}

function getOrCreateWorkspaceFileId(filePath: string): string {
  return getOrCreateId(fileRegistry, filePath, 'file-')
}

/**
 * Build a workspace preview URL from an ID and path components
 * @param id The workspace or file ID
 * @param pathComponents Path components to encode and join
 */
function buildPreviewUrl(id: string, ...pathComponents: string[]): string {
  const encodedPath = pathComponents
    .flatMap((component) => component.split(path.sep))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')

  return `${WORKSPACE_PREVIEW_PROTOCOL}://${id}/${encodedPath}`
}

export function registerWorkspacePreviewSchemes(): void {
  if (schemesRegistered) {
    return
  }

  protocol.registerSchemesAsPrivileged([
    {
      scheme: WORKSPACE_PREVIEW_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])

  schemesRegistered = true
}

export function registerWorkspacePreviewRoot(workspacePath: string): void {
  const normalizedRoot = normalizePathForAccess(workspacePath)
  getOrCreateWorkspaceId(normalizedRoot)
}

export function unregisterWorkspacePreviewRoot(workspacePath: string): void {
  const normalizedRoot = normalizePathForAccess(workspacePath)
  workspaceRegistry.deleteByPath(normalizedRoot)
}

export function registerWorkspacePreviewFile(filePath: string): void {
  const normalizedFilePath = normalizePathForAccess(filePath)
  getOrCreateWorkspaceFileId(normalizedFilePath)
}

export function unregisterWorkspacePreviewFile(filePath: string): void {
  const normalizedFilePath = normalizePathForAccess(filePath)
  fileRegistry.deleteByPath(normalizedFilePath)
}

export function createWorkspacePreviewUrl(workspaceRoot: string, filePath: string): string | null {
  const normalizedRoot = normalizePathForAccess(workspaceRoot)
  const normalizedFilePath = normalizePathForAccess(filePath)

  if (!isPathInsideRoot(normalizedRoot, normalizedFilePath)) {
    return null
  }

  const workspaceId = getOrCreateWorkspaceId(normalizedRoot)
  const relativePath = path.relative(normalizedRoot, normalizedFilePath)

  return buildPreviewUrl(workspaceId, relativePath)
}

export function createWorkspacePreviewFileUrl(filePath: string): string {
  const normalizedFilePath = normalizePathForAccess(filePath)
  const workspaceFileId = getOrCreateWorkspaceFileId(normalizedFilePath)

  return buildPreviewUrl(workspaceFileId, path.basename(normalizedFilePath))
}

export function resolveWorkspacePreviewRequest(requestUrl: string): string | null {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(requestUrl)
  } catch {
    return null
  }

  if (parsedUrl.protocol !== `${WORKSPACE_PREVIEW_PROTOCOL}:`) {
    return null
  }

  const previewFilePath = fileRegistry.getPathById(parsedUrl.hostname)
  if (previewFilePath) {
    try {
      const decodedSegments = parsedUrl.pathname
        .split('/')
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment))

      if (decodedSegments.length > 1) {
        return null
      }

      if (decodedSegments.length === 1 && decodedSegments[0] !== path.basename(previewFilePath)) {
        return null
      }
    } catch {
      return null
    }

    return previewFilePath
  }

  const workspaceRoot = workspaceRegistry.getPathById(parsedUrl.hostname)
  if (!workspaceRoot) {
    return null
  }

  let relativePath = ''

  try {
    const decodedSegments = parsedUrl.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))

    relativePath = decodedSegments.length > 0 ? path.join(...decodedSegments) : ''
  } catch {
    return null
  }

  const resolvedPath = normalizePathForAccess(path.resolve(workspaceRoot, relativePath))
  if (!isPathInsideRoot(workspaceRoot, resolvedPath)) {
    return null
  }

  return resolvedPath
}

export function resetWorkspacePreviewProtocolState(): void {
  workspaceRegistry.clear()
  fileRegistry.clear()
  schemesRegistered = false
}
