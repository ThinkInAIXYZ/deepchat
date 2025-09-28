import os from 'os'

// Check Windows version
export function isWindows10OrLater(): boolean {
  if (process.platform !== 'win32') return false
  const release = os.release().split('.')
  const major = parseInt(release[0])
  return major >= 10
}

// Check if Windows 11 or later
export function isWindows11OrLater(): boolean {
  if (process.platform !== 'win32') return false
  const release = os.release().split('.')
  const major = parseInt(release[0])
  const build = parseInt(release[2])
  // Windows 11 build number starts from 22000
  return major >= 10 && build >= 22000
}
