import path from 'path'

const SENSITIVE_PATTERNS = ['.env', '.pem', '.key', 'credentials', 'secret', 'password']

const DEFAULT_ALLOWLIST = ['.env.example']

const BINARY_EXTENSIONS = new Set([
  'exe',
  'dll',
  'bin',
  'so',
  'dylib',
  'class',
  'jar',
  'zip',
  'tar',
  'gz',
  '7z',
  'rar',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'mp3',
  'wav',
  'flac',
  'mp4',
  'mov',
  'avi',
  'mkv'
])

export function checkSensitiveFile(
  filePath: string,
  allowList: string[] = DEFAULT_ALLOWLIST
): void {
  const normalized = filePath.toLowerCase()

  for (const allow of allowList) {
    const allowNormalized = path.normalize(allow).toLowerCase()
    if (normalized === allowNormalized || normalized.endsWith(path.sep + allowNormalized)) {
      return
    }
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    if (normalized.includes(pattern)) {
      throw new Error(`Sensitive file access blocked: ${filePath}`)
    }
  }
}

export function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (!ext) return false
  return BINARY_EXTENSIONS.has(ext)
}

export function isBinaryContent(content: string): boolean {
  const length = Math.min(content.length, 10000)
  if (length === 0) return false

  let nonPrintable = 0
  for (let i = 0; i < length; i++) {
    const code = content.charCodeAt(i)
    if (code === 0) return true
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      nonPrintable++
    }
  }

  return nonPrintable / length > 0.3
}
