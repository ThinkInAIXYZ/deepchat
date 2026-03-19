import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { protocol } from 'electron'

export const WORKSPACE_PREVIEW_PROTOCOL = 'workspace-preview'

const workspaceRootsById = new Map<string, string>()
const workspaceIdsByRoot = new Map<string, string>()

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

function getOrCreateWorkspaceId(workspaceRoot: string): string {
  const existingId = workspaceIdsByRoot.get(workspaceRoot)
  if (existingId) {
    return existingId
  }

  const workspaceId = createHash('sha256').update(workspaceRoot).digest('hex')
  workspaceIdsByRoot.set(workspaceRoot, workspaceId)
  workspaceRootsById.set(workspaceId, workspaceRoot)
  return workspaceId
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
  const workspaceId = workspaceIdsByRoot.get(normalizedRoot)
  if (!workspaceId) {
    return
  }

  workspaceIdsByRoot.delete(normalizedRoot)
  workspaceRootsById.delete(workspaceId)
}

export function createWorkspacePreviewUrl(workspaceRoot: string, filePath: string): string | null {
  const normalizedRoot = normalizePathForAccess(workspaceRoot)
  const normalizedFilePath = normalizePathForAccess(filePath)

  if (!isPathInsideRoot(normalizedRoot, normalizedFilePath)) {
    return null
  }

  const workspaceId = getOrCreateWorkspaceId(normalizedRoot)
  const relativePath = path.relative(normalizedRoot, normalizedFilePath)
  const encodedPath = relativePath.split(path.sep).map(encodeURIComponent).join('/')

  return `${WORKSPACE_PREVIEW_PROTOCOL}://${workspaceId}/${encodedPath}`
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

  const workspaceRoot = workspaceRootsById.get(parsedUrl.hostname)
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
  workspaceRootsById.clear()
  workspaceIdsByRoot.clear()
  schemesRegistered = false
}
