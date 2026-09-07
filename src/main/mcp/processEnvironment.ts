const COMMON_ENVIRONMENT_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG'
])

const LINUX_ENVIRONMENT_KEYS = new Set([
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE',
  'DBUS_SESSION_BUS_ADDRESS',
  'AT_SPI_BUS',
  'SWAYSOCK',
  'XDG_CURRENT_DESKTOP',
  'XDG_SESSION_DESKTOP',
  'DESKTOP_SESSION',
  'XDG_DATA_HOME',
  'XDG_DATA_DIRS'
])

const WINDOWS_ENVIRONMENT_KEYS = new Set([
  ...COMMON_ENVIRONMENT_KEYS,
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROCESSOR_ARCHITECTURE'
])

const isMinimalEnvironmentKeyAllowed = (key: string, platform: NodeJS.Platform): boolean => {
  if (platform === 'win32') {
    const normalizedKey = key.toUpperCase()
    return WINDOWS_ENVIRONMENT_KEYS.has(normalizedKey) || normalizedKey.startsWith('LC_')
  }

  return (
    COMMON_ENVIRONMENT_KEYS.has(key) ||
    key.startsWith('LC_') ||
    (platform === 'linux' && LINUX_ENVIRONMENT_KEYS.has(key))
  )
}

export const createMinimalProcessEnvironment = (
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && isMinimalEnvironmentKeyAllowed(entry[0], platform)
    )
  )
