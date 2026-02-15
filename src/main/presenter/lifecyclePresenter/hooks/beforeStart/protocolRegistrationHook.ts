/**
 * Protocol registration hook for init phase
 * Registers deepcdn and imgcache protocols
 */

import { protocol, app } from 'electron'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import path from 'path'
import fs from 'fs'
import { is } from '@electron-toolkit/utils'
import { LifecyclePhase } from '@shared/lifecycle'

const DEEPCHAT_MEDIA_SCHEME = 'deepchat-media://'

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function isPathWithinDirectory(targetPath: string, basePath: string): boolean {
  const relativePath = path.relative(basePath, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function resolveDeepchatMediaPath(requestUrl: string, mediaCacheDir: string): string | null {
  let rawPath = safeDecodeURIComponent(requestUrl.slice(DEEPCHAT_MEDIA_SCHEME.length))

  try {
    const parsedUrl = new URL(requestUrl)
    const host = safeDecodeURIComponent(parsedUrl.host)
    const pathname = safeDecodeURIComponent(parsedUrl.pathname)

    if (host && pathname) {
      // deepchat-media://Users/foo.png => host='Users', pathname='/foo.png'
      rawPath = /^[a-zA-Z]:$/.test(host) ? `${host}${pathname}` : `/${host}${pathname}`
    } else if (host) {
      rawPath = host
    } else if (pathname) {
      rawPath = pathname
    }
  } catch {
    // Keep fallback path parsed by slicing protocol prefix.
  }

  let resolvedPath = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(mediaCacheDir, rawPath.replace(/^[/\\]+/, ''))

  if (!isPathWithinDirectory(resolvedPath, mediaCacheDir)) {
    const normalizedRawPath = rawPath.replace(/\\/g, '/')
    const marker = 'media-cache/'
    const markerIndex = normalizedRawPath.lastIndexOf(marker)
    if (markerIndex !== -1) {
      const relativePath = normalizedRawPath.slice(markerIndex + marker.length)
      resolvedPath = path.resolve(mediaCacheDir, relativePath)
    }
  }

  return isPathWithinDirectory(resolvedPath, mediaCacheDir) ? resolvedPath : null
}

function getMediaMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  const mimeTypeMap: Record<string, string> = {
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.ogv': 'video/ogg',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska'
  }

  return mimeTypeMap[extension] || 'application/octet-stream'
}

export const protocolRegistrationHook: LifecycleHook = {
  name: 'protocol-registration',
  phase: LifecyclePhase.BEFORE_START,
  priority: 1,
  critical: true,
  execute: async (_context: LifecycleContext) => {
    console.log('protocolRegistrationHook: Registering application protocols')

    // Register 'deepcdn' protocol for loading built-in resources (simulating CDN)
    protocol.handle('deepcdn', (request) => {
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
        const baseResourcesDir =
          candidates.find((p) => fs.existsSync(path.join(p, 'cdn'))) || candidates[0]

        const fullPath = path.join(baseResourcesDir, 'cdn', filePath)

        // Determine MIME type based on file extension
        let mimeType = 'application/octet-stream' // Default type
        if (filePath.endsWith('.js')) {
          mimeType = 'text/javascript'
        } else if (filePath.endsWith('.css')) {
          mimeType = 'text/css'
        } else if (filePath.endsWith('.json')) {
          mimeType = 'application/json'
        } else if (filePath.endsWith('.wasm')) {
          mimeType = 'application/wasm'
        } else if (filePath.endsWith('.data')) {
          mimeType = 'application/octet-stream'
        } else if (filePath.endsWith('.html')) {
          mimeType = 'text/html'
        }

        // Check if file exists
        if (!fs.existsSync(fullPath)) {
          console.warn(`protocolRegistrationHook: deepcdn handler: File not found: ${fullPath}`)
          return new Response(`File not found: ${filePath}`, {
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
          })
        }

        // Read file and return response
        const fileContent = fs.readFileSync(fullPath)
        return new Response(fileContent, {
          headers: { 'Content-Type': mimeType }
        })
      } catch (error: unknown) {
        console.error('protocolRegistrationHook: Error handling deepcdn request:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return new Response(`Server error: ${errorMessage}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
    })

    // Register 'imgcache' protocol for handling image cache
    protocol.handle('imgcache', (request) => {
      try {
        const filePath = request.url.slice('imgcache://'.length)
        // Images are stored in the images subfolder of user data directory
        const fullPath = path.join(app.getPath('userData'), 'images', filePath)

        // Check if file exists
        if (!fs.existsSync(fullPath)) {
          console.warn(
            `protocolRegistrationHook: imgcache handler: Image file not found: ${fullPath}`
          )
          return new Response(`Image not found: ${filePath}`, {
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
          })
        }

        // Determine MIME type based on file extension
        let mimeType = 'application/octet-stream' // Default type
        if (filePath.endsWith('.png')) {
          mimeType = 'image/png'
        } else if (filePath.endsWith('.gif')) {
          mimeType = 'image/gif'
        } else if (filePath.endsWith('.webp')) {
          mimeType = 'image/webp'
        } else if (filePath.endsWith('.svg')) {
          mimeType = 'image/svg+xml'
        } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
          mimeType = 'image/jpeg'
        } else if (filePath.endsWith('.bmp')) {
          mimeType = 'image/bmp'
        } else if (filePath.endsWith('.ico')) {
          mimeType = 'image/x-icon'
        } else if (filePath.endsWith('.avif')) {
          mimeType = 'image/avif'
        }

        // Read file and return response
        const fileContent = fs.readFileSync(fullPath)
        return new Response(fileContent, {
          headers: { 'Content-Type': mimeType }
        })
      } catch (error: unknown) {
        console.error('protocolRegistrationHook: Error handling imgcache request:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return new Response(`Server error: ${errorMessage}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
    })

    // Register 'deepchat-media' protocol for handling video/image cache
    protocol.handle('deepchat-media', (request) => {
      try {
        const mediaCacheDir = path.resolve(app.getPath('userData'), 'media-cache')
        const fullPath = resolveDeepchatMediaPath(request.url, mediaCacheDir)

        if (!fullPath) {
          console.warn(
            `protocolRegistrationHook: deepchat-media handler: Invalid media path from URL: ${request.url}`
          )
          return new Response('Invalid media path', {
            status: 400,
            headers: { 'Content-Type': 'text/plain' }
          })
        }

        // Check if file exists
        if (!fs.existsSync(fullPath)) {
          console.warn(
            `protocolRegistrationHook: deepchat-media handler: Media file not found: ${fullPath}`
          )
          return new Response(`Media not found: ${request.url}`, {
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
          })
        }

        const mimeType = getMediaMimeType(fullPath)

        // Read file and return response
        const fileContent = fs.readFileSync(fullPath)
        return new Response(fileContent, {
          headers: { 'Content-Type': mimeType }
        })
      } catch (error: unknown) {
        console.error('protocolRegistrationHook: Error handling deepchat-media request:', error)
        const errorMessage = error instanceof Error ? error.message : String(error)
        return new Response(`Server error: ${errorMessage}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        })
      }
    })

    console.log('protocolRegistrationHook: Application protocols registered successfully')
  }
}
