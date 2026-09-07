import type { ResolvedCommandShell } from '@shared/commandShell'

export const POSIX_COMMAND_SHELL: ResolvedCommandShell = Object.freeze({
  profile: 'posix',
  dialect: 'posix',
  pathStyle: 'native',
  executable: '/bin/sh',
  args: Object.freeze(['-c']),
  displayName: 'sh'
})

export const WINDOWS_POWERSHELL_COMMAND_SHELL: ResolvedCommandShell = Object.freeze({
  profile: 'windows-powershell',
  dialect: 'powershell',
  pathStyle: 'win32',
  executable: 'powershell.exe',
  args: Object.freeze(['-NoProfile', '-Command']),
  displayName: 'Windows PowerShell'
})

export const POWERSHELL_CORE_COMMAND_SHELL: ResolvedCommandShell = Object.freeze({
  profile: 'powershell-core',
  dialect: 'powershell',
  pathStyle: 'win32',
  executable: 'pwsh.exe',
  args: Object.freeze(['-NoProfile', '-Command']),
  displayName: 'PowerShell 7'
})

export const FISH_COMMAND_SHELL: ResolvedCommandShell = Object.freeze({
  profile: 'fish',
  dialect: 'posix',
  pathStyle: 'native',
  executable: '/opt/homebrew/bin/fish',
  args: Object.freeze(['-c']),
  displayName: 'Fish'
})

export const CMD_COMMAND_SHELL: ResolvedCommandShell = Object.freeze({
  profile: 'cmd',
  dialect: 'cmd',
  pathStyle: 'win32',
  executable: 'cmd.exe',
  args: Object.freeze(['/c']),
  displayName: 'Command Prompt'
})

export const GIT_BASH_COMMAND_SHELL: ResolvedCommandShell = Object.freeze({
  profile: 'git-bash',
  dialect: 'posix',
  pathStyle: 'msys',
  executable: 'C:\\Program Files\\Git\\bin\\bash.exe',
  args: Object.freeze(['-c']),
  displayName: 'Git Bash'
})
