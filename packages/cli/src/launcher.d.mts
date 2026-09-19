export type InstalledCliLauncherSource = Readonly<{
  electronHost: string
  modulePath: string
}>

export function createPosixInstalledLauncher(source: InstalledCliLauncherSource): string
export function createWindowsInstalledLauncher(source: InstalledCliLauncherSource): string
export const BUNDLED_POSIX_LAUNCHER: string
export const BUNDLED_WINDOWS_LAUNCHER: string
