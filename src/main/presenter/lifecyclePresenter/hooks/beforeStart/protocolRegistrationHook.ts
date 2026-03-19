/**
 * Protocol registration hook for init phase
 * Registers deepcdn, imgcache, and workspace preview protocols
 */

import { protocol, app } from 'electron'
import { LifecycleHook, LifecycleContext } from '@shared/presenter'
import path from 'path'
import fs from 'fs'
import { is } from '@electron-toolkit/utils'
import { LifecyclePhase } from '@shared/lifecycle'
import {
  resolveWorkspacePreviewRequest,
  WORKSPACE_PREVIEW_PROTOCOL
} from '@/presenter/workspacePresenter/workspacePreviewProtocol'

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

    protocol.handle(WORKSPACE_PREVIEW_PROTOCOL, (request) => {
      try {
        const fullPath = resolveWorkspacePreviewRequest(request.url)
        if (!fullPath) {
          return new Response('Forbidden', {
            status: 403,
            headers: { 'Content-Type': 'text/plain' }
          })
        }

        if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
          console.warn(
            `protocolRegistrationHook: ${WORKSPACE_PREVIEW_PROTOCOL} handler: File not found: ${fullPath}`
          )
          return new Response(`File not found: ${fullPath}`, {
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
          })
        }

        const fileContent = fs.readFileSync(fullPath)
        return new Response(fileContent, {
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': getMimeTypeForPath(fullPath),
            'X-Content-Type-Options': 'nosniff'
          }
        })
      } catch (error: unknown) {
        console.error(
          `protocolRegistrationHook: Error handling ${WORKSPACE_PREVIEW_PROTOCOL} request:`,
          error
        )
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
