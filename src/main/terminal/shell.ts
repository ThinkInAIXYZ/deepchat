import path from 'node:path'
import { getUserShell } from '@/agent/shared/process/shellEnvHelper'

export function resolveInteractiveShell(platform: NodeJS.Platform = process.platform): {
  shell: string
  args: string[]
} {
  if (platform === 'win32') {
    return process.env.PSModulePath
      ? { shell: 'powershell.exe', args: ['-NoLogo'] }
      : { shell: process.env.COMSPEC || 'cmd.exe', args: [] }
  }
  const { shell } = getUserShell()
  const name = path.basename(shell).toLowerCase()
  // Login shells load the same profile the user gets in their own terminal app.
  const loginCapable = ['zsh', 'bash', 'fish', 'sh', 'ksh'].some((candidate) =>
    name.includes(candidate)
  )
  return { shell, args: loginCapable ? ['-l'] : [] }
}
