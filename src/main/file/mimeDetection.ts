import fs from 'fs/promises'
import path from 'path'
import { lookup } from 'es-mime-types'

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

export const detectMimeType = async (filePath: string): Promise<string> => {
  try {
    const mimeType = lookup(filePath)
    const ext = path.extname(filePath).toLowerCase()

    if (mimeType === 'video/mp2t' && TYPESCRIPT_EXTENSIONS.has(ext)) {
      return (await isLikelyTextFile(filePath)) ? 'application/typescript' : mimeType
    }

    if (mimeType) {
      return mimeType
    }

    const isText = await isLikelyTextFile(filePath)
    return isText ? 'text/plain' : 'application/octet-stream'
  } catch {
    try {
      const isText = await isLikelyTextFile(filePath)
      return isText ? 'text/plain' : 'application/octet-stream'
    } catch (textCheckError) {
      console.error(`Error during text check for ${filePath}:`, textCheckError)
      return 'application/octet-stream'
    }
  }
}

export const isLikelyTextFile = async (filePath: string, bytesToRead = 1024): Promise<boolean> => {
  let fileHandle: fs.FileHandle | undefined
  try {
    fileHandle = await fs.open(filePath, 'r')
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, 0)
    await fileHandle.close()

    if (bytesRead === 0) {
      return false
    }

    const content = buffer.slice(0, bytesRead)

    const hasNullByte = content.includes(0)
    if (hasNullByte) {
      return false
    }

    let nonTextChars = 0
    for (let i = 0; i < content.length; i++) {
      const byte = content[i]
      if (
        !((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13 || byte >= 128)
      ) {
        nonTextChars++
      }
    }

    const nonTextRatio = bytesRead > 0 ? nonTextChars / bytesRead : 0

    if (nonTextRatio > 0.1) {
      return false
    }

    return true
  } catch (error) {
    console.error(`[isLikelyTextFile] Failed to read file ${path.basename(filePath)}:`, error)
    if (fileHandle) {
      await fileHandle.close()
    }
    return false
  }
}
