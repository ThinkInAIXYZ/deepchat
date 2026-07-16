import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { nanoid } from 'nanoid'
import axios from 'axios'

function toMimeType(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string') ?? ''
  }
  return ''
}

function getImageExtensionFromMimeType(value: unknown): string {
  const mimeType = toMimeType(value).toLowerCase()
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('gif')) return 'gif'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('svg')) return 'svg'
  return 'jpg'
}

async function cacheImageFromUrl(url: string, cacheDir: string, fileName: string): Promise<string> {
  try {
    const response = await axios({
      method: 'get',
      url,
      responseType: 'arraybuffer',
      timeout: 10000
    })
    const extension = getImageExtensionFromMimeType(response.headers['content-type'])
    const saveFileName = `${fileName}.${extension}`
    await fs.promises.writeFile(path.join(cacheDir, saveFileName), Buffer.from(response.data))
    return `imgcache://${saveFileName}`
  } catch (error) {
    console.error('下载图片失败:', error)
    return url
  }
}

async function cacheImageFromBase64(
  base64Data: string,
  cacheDir: string,
  fileName: string
): Promise<string> {
  try {
    const matches = base64Data.match(/^data:([^;]+);base64,(.*)$/)
    if (!matches || matches.length !== 3) {
      console.warn('无效的Base64图片数据')
      return base64Data
    }
    const extension = getImageExtensionFromMimeType(matches[1])
    const saveFileName = `${fileName}.${extension}`
    await fs.promises.writeFile(
      path.join(cacheDir, saveFileName),
      Buffer.from(matches[2], 'base64')
    )
    return `imgcache://${saveFileName}`
  } catch (error) {
    console.error('保存Base64图片失败:', error)
    return base64Data
  }
}

export async function cacheImage(imageData: string): Promise<string> {
  if (imageData.startsWith('imgcache://')) return imageData

  const cacheDir = path.join(app.getPath('userData'), 'images')
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  const fileName = `img_${Date.now()}_${nanoid(8)}`

  if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
    return cacheImageFromUrl(imageData, cacheDir, fileName)
  }
  if (imageData.startsWith('data:image/')) {
    return cacheImageFromBase64(imageData, cacheDir, fileName)
  }
  console.warn('不支持的图片格式')
  return imageData
}
