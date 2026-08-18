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
      `${homeDir}/.cargo/bin`
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
      `${homeDir}/.cargo/bin`
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
    `${homeDir}\\.cargo\\bin`
  ]
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
