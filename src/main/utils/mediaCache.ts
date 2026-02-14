import { app } from 'electron'
import path from 'path'
import crypto from 'crypto'
import fs from 'fs/promises'
import https from 'https'
import http from 'http'
import { URL } from 'url'

class MediaCache {
  private cacheDir: string

  constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'media-cache')
    this.ensureDir()
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true })
    } catch {
      // Directory already exists or creation failed
    }
  }

  private async downloadFile(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const client = parsedUrl.protocol === 'https:' ? https : http

      const request = client.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`))
          return
        }

        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => resolve(Buffer.concat(chunks)))
        response.on('error', reject)
      })

      request.on('error', reject)
      request.setTimeout(30000, () => {
        request.destroy()
        reject(new Error('Download timeout'))
      })
    })
  }

  async saveImage(url: string): Promise<string> {
    await this.ensureDir()
    const hash = crypto.createHash('md5').update(url).digest('hex')
    const ext = '.jpg'
    const fileName = `img-${hash}${ext}`
    const filePath = path.join(this.cacheDir, fileName)

    try {
      // Check if file already exists
      await fs.access(filePath)
      return `deepchat-media://${filePath}`
    } catch {
      // File doesn't exist, download it
    }

    const buffer = await this.downloadFile(url)
    await fs.writeFile(filePath, buffer)
    return `deepchat-media://${filePath}`
  }

  async saveVideo(url: string): Promise<string> {
    await this.ensureDir()
    const hash = crypto.createHash('md5').update(url).digest('hex')
    const ext = '.mp4'
    const fileName = `video-${hash}${ext}`
    const filePath = path.join(this.cacheDir, fileName)

    try {
      // Check if file already exists
      await fs.access(filePath)
      return `deepchat-media://${filePath}`
    } catch {
      // File doesn't exist, download it
    }

    const buffer = await this.downloadFile(url)
    await fs.writeFile(filePath, buffer)
    return `deepchat-media://${filePath}`
  }

  async cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir)
      const now = Date.now()

      for (const file of files) {
        const filePath = path.join(this.cacheDir, file)
        try {
          const stats = await fs.stat(filePath)
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.unlink(filePath)
          }
        } catch {
          // Ignore errors for individual files
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  getCacheDir(): string {
    return this.cacheDir
  }
}

export const mediaCache = new MediaCache()
