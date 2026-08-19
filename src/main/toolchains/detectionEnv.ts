import { readdirSync } from 'node:fs'
import path from 'node:path'

const NVM_VERSION_SCAN_LIMIT = 32

export function defaultDetectionPaths(homeDir: string, platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') {
    return [
      '/bin',
      '/usr/bin',
      '/usr/local/bin',
      '/usr/local/sbin',
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/opt/node/bin',
      '/opt/local/bin',
      `${homeDir}/.local/bin`,
      `${homeDir}/.volta/bin`,
      `${homeDir}/.fnm/current/bin`,
      `${homeDir}/.asdf/shims`,
      `${homeDir}/.cargo/bin`,
      `${homeDir}/.nvm/current/bin`,
      ...existingNvmVersionBins(homeDir, platform)
    ]
  }
  if (platform === 'linux') {
    return [
      '/bin',
      '/usr/bin',
      '/usr/local/bin',
      `${homeDir}/.local/bin`,
      `${homeDir}/.volta/bin`,
      `${homeDir}/.fnm/current/bin`,
      `${homeDir}/.asdf/shims`,
      `${homeDir}/.cargo/bin`,
      `${homeDir}/.nvm/current/bin`,
      ...existingNvmVersionBins(homeDir, platform)
    ]
  }
  return [
    'C:\\Program Files\\nodejs',
    'C:\\Program Files (x86)\\nodejs',
    `${homeDir}\\AppData\\Roaming\\npm`,
    `${homeDir}\\AppData\\Roaming\\nvm`,
    `${homeDir}\\AppData\\Local\\fnm`,
    `${homeDir}\\.local\\bin`,
    `${homeDir}\\.volta\\bin`,
    `${homeDir}\\AppData\\Roaming\\fnm`,
    `${homeDir}\\.cargo\\bin`,
    ...existingNvmVersionBins(homeDir, platform)
  ]
}

function existingNvmVersionBins(homeDir: string, platform: NodeJS.Platform): string[] {
  try {
    if (platform === 'win32') {
      const nvmRoot = path.join(homeDir, 'AppData', 'Roaming', 'nvm')
      return listVersionDirs(nvmRoot)
        .slice(0, NVM_VERSION_SCAN_LIMIT)
        .map((name) => path.join(nvmRoot, name))
    }
    const versionsRoot = path.join(homeDir, '.nvm', 'versions', 'node')
    return listVersionDirs(versionsRoot)
      .slice(0, NVM_VERSION_SCAN_LIMIT)
      .map((name) => path.join(versionsRoot, name, 'bin'))
  } catch {
    return []
  }
}

function listVersionDirs(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v?\d/.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareNvmVersionNames)
}

function compareNvmVersionNames(left: string, right: string): number {
  const leftParts = parseNvmVersion(left)
  const rightParts = parseNvmVersion(right)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (rightParts[index] ?? 0) - (leftParts[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function parseNvmVersion(name: string): number[] {
  return name
    .replace(/^v/i, '')
    .split('.')
    .map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    })
}

export function mergeDetectionEnv(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform
): NodeJS.ProcessEnv {
  const separator = platform === 'win32' ? ';' : ':'
  const current = env.PATH || env.Path || env.path || ''
  const merged = [
    ...current.split(separator).filter(Boolean),
    ...defaultDetectionPaths(homeDir, platform)
  ]
  const seen = new Set<string>()
  const value = merged
    .filter((entry) => {
      const key = platform === 'win32' ? entry.toLowerCase() : entry
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(separator)
  return {
    ...env,
    PATH: value,
    ...(platform === 'win32' ? { Path: value } : {})
  }
}
