export function expandRuntimePath(inputPath: string, homeDirectory: string): string {
  let expandedPath = inputPath

  if (expandedPath.startsWith('~/') || expandedPath === '~') {
    expandedPath = expandedPath.replace('~', homeDirectory)
  }

  expandedPath = expandedPath.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    return process.env[varName] || match
  })

  return expandedPath.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, varName) => {
    return process.env[varName] || match
  })
}

export function getDefaultRuntimePaths(homeDirectory: string): string[] {
  if (process.platform === 'darwin') {
    return [
      '/bin',
      '/usr/bin',
      '/usr/local/bin',
      '/usr/local/sbin',
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/opt/node/bin',
      '/opt/local/bin',
      `${homeDirectory}/.cargo/bin`
    ]
  }
  if (process.platform === 'linux') {
    return ['/bin', '/usr/bin', '/usr/local/bin', `${homeDirectory}/.cargo/bin`]
  }
  return [`${homeDirectory}\\.cargo\\bin`, `${homeDirectory}\\.local\\bin`]
}
