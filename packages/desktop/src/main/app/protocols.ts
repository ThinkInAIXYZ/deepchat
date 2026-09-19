import logger from '@shared/logger'
/**
 * Protocol handlers used by the main process
 * Registers deepcdn, imgcache, and workspace preview protocols
 */

import { protocol, app } from 'electron'
import path from 'path'
import fs, { promises as fsp, Stats } from 'fs'
import { Readable } from 'stream'
import { is } from '@electron-toolkit/utils'
import {
  resolveWorkspacePreviewRequest,
  WORKSPACE_PREVIEW_PROTOCOL
} from '@/workspace/workspacePreviewProtocol'
import { registerMcpAppProtocol } from '@/mcp/apps/sandboxProtocol'
import type { McpAppSandboxRegistry } from '@/mcp/apps/sandboxRegistry'

const workspacePreviewMimeCache = new Map<string, string>()

const getMimeTypeForPath = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase()

  switch (extension) {
    case '.html':
    case '.htm':
    case '.xhtml':
      return 'text/html'
    case '.css':
      return 'text/css'
    case '.js':
    case '.mjs':
      return 'text/javascript'
    case '.json':
    case '.map':
      return 'application/json'
    case '.pdf':
      return 'application/pdf'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.bmp':
      return 'image/bmp'
    case '.ico':
      return 'image/x-icon'
    case '.avif':
      return 'image/avif'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    case '.ttf':
      return 'font/ttf'
    case '.otf':
      return 'font/otf'
    default:
      return 'application/octet-stream'
  }
}

const getDeepCdnMimeType = (filePath: string): string => {
  if (filePath.endsWith('.wasm')) {
    return 'application/wasm'
  }

  if (filePath.endsWith('.data')) {
    return 'application/octet-stream'
  }

  return getMimeTypeForPath(filePath)
}

const getWorkspacePreviewMimeType = (fullPath: string): string => {
  const cached = workspacePreviewMimeCache.get(fullPath)
  if (cached) {
    return cached
  }

  const mimeType = getMimeTypeForPath(fullPath)
  workspacePreviewMimeCache.set(fullPath, mimeType)
  return mimeType
}

const resolvePathInsideRoot = (rootDir: string, requestPath: string): string | null => {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(requestPath.split(/[?#]/, 1)[0] ?? '')
  } catch {
    return null
  }

  const root = path.resolve(rootDir)
  const relativeRequestPath = decodedPath.replace(/^[/\\]+/, '')
  const fullPath = path.resolve(root, relativeRequestPath)
  const relativePath = path.relative(root, fullPath)
  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return fullPath
  }
  return null
}

const createStreamingResponse = async (
  fullPath: string,
  stat: Stats,
  init: ResponseInit
): Promise<Response> => {
  try {
    const body = Readable.toWeb(fs.createReadStream(fullPath)) as unknown as BodyInit
    return new Response(body, {
      ...init,
      headers: {
        ...init.headers,
        'Content-Length': String(stat.size)
      }
    })
  } catch {
    const fileContent = await fsp.readFile(fullPath)
    return new Response(fileContent, {
      ...init,
      headers: {
        ...init.headers,
        'Content-Length': String(stat.size)
      }
    })
  }
}

const findDeepCdnResourcesDir = async (candidates: string[]): Promise<string> => {
  for (const candidate of candidates) {
    try {
      await fsp.access(path.join(candidate, 'cdn'))
      return candidate
    } catch {
      // Try the next packaged resource location.
    }
  }

  return candidates[0]
}

export async function registerProtocols(
  mcpAppSandboxRegistry: McpAppSandboxRegistry
): Promise<void> {
  logger.info('registerProtocols: Registering application protocols')

  // Register 'deepcdn' protocol for loading built-in resources (simulating CDN)
  protocol.handle('deepcdn', async (request) => {
    try {
      const filePath = request.url.slice('deepcdn://'.length)
      // Determine resource path based on dev/production environment
      const candidates = is.dev
        ? [path.join(app.getAppPath(), 'resources')]
        : [
            path.join(process.resourcesPath, 'app.asar.unpacked', 'resources'),
            path.join(process.resourcesPath, 'resources'),
            process.resourcesPath
          ]
      const baseResourcesDir = await findDeepCdnResourcesDir(candidates)
      const fullPath = resolvePathInsideRoot(path.join(baseResourcesDir, 'cdn'), filePath)
      if (!fullPath) {
        return new Response('Forbidden', {
          status: 403,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
      const mimeType = getDeepCdnMimeType(filePath)

      const stat = await fsp.stat(fullPath)
      if (stat.isDirectory()) {
        console.warn(`registerProtocols: deepcdn handler: File not found: ${filePath}`)
        return new Response(`File not found: ${filePath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      return await createStreamingResponse(fullPath, stat, {
        headers: { 'Content-Type': mimeType }
      })
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const filePath = request.url.slice('deepcdn://'.length)
        console.warn(`registerProtocols: deepcdn handler: File not found: ${filePath}`)
        return new Response(`File not found: ${filePath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      console.error('registerProtocols: Error handling deepcdn request:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`Server error: ${errorMessage}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
  })

  // Register 'imgcache' protocol for handling image cache
  protocol.handle('imgcache', async (request) => {
    const filePath = request.url.slice('imgcache://'.length)
    // Images are stored in the images subfolder of user data directory
    const fullPath = resolvePathInsideRoot(path.join(app.getPath('userData'), 'images'), filePath)
    if (!fullPath) {
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      })
    }

    try {
      const stat = await fsp.stat(fullPath)
      if (stat.isDirectory()) {
        console.warn(`registerProtocols: imgcache handler: Image file not found: ${fullPath}`)
        return new Response(`Image not found: ${filePath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      return await createStreamingResponse(fullPath, stat, {
        headers: { 'Content-Type': getMimeTypeForPath(fullPath) }
      })
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`registerProtocols: imgcache handler: Image file not found: ${fullPath}`)
        return new Response(`Image not found: ${filePath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      console.error('registerProtocols: Error handling imgcache request:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`Server error: ${errorMessage}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
  })

  protocol.handle(WORKSPACE_PREVIEW_PROTOCOL, async (request) => {
    const fullPath = resolveWorkspacePreviewRequest(request.url)
    if (!fullPath) {
      return new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      })
    }

    try {
      const stat = await fsp.stat(fullPath)
      if (stat.isDirectory()) {
        console.warn(
          `registerProtocols: ${WORKSPACE_PREVIEW_PROTOCOL} handler: File not found: ${fullPath}`
        )
        return new Response(`File not found: ${fullPath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      return await createStreamingResponse(fullPath, stat, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': getWorkspacePreviewMimeType(fullPath),
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(
          `registerProtocols: ${WORKSPACE_PREVIEW_PROTOCOL} handler: File not found: ${fullPath}`
        )
        return new Response(`File not found: ${fullPath}`, {
          status: 404,
          headers: { 'Content-Type': 'text/plain' }
        })
      }

      console.error(
        `registerProtocols: Error handling ${WORKSPACE_PREVIEW_PROTOCOL} request:`,
        error
      )
      const errorMessage = error instanceof Error ? error.message : String(error)
      return new Response(`Server error: ${errorMessage}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      })
    }
  })

  registerMcpAppProtocol(mcpAppSandboxRegistry)

  logger.info('registerProtocols: Application protocols registered successfully')
}
