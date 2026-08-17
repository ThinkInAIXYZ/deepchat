import { z } from 'zod'

export const AgentCommandShellPreferenceSchema = z.enum([
  'auto',
  'bash',
  'zsh',
  'fish',
  'windows-powershell',
  'powershell-core',
  'cmd',
  'git-bash'
])

export const AgentCommandShellConfigSchema = z
  .object({
    preference: AgentCommandShellPreferenceSchema,
    gitBashExecutableOverride: z.string().trim().min(1).max(4_096).optional()
  })
  .strict()

export const CommandShellProfileSchema = z.enum([
  'posix',
  'bash',
  'zsh',
  'fish',
  'cmd',
  'windows-powershell',
  'powershell-core',
  'git-bash'
])

export const CommandShellDialectSchema = z.enum(['posix', 'cmd', 'powershell'])
export const CommandShellPathStyleSchema = z.enum(['native', 'win32', 'msys'])

const ResolvedPosixCommandShellSchema = z.object({
  profile: z.literal('posix'),
  dialect: z.literal('posix'),
  pathStyle: z.literal('native'),
  executable: z.string().min(1),
  args: z.tuple([z.literal('-c')]),
  displayName: z.string().min(1)
})

const ResolvedBashCommandShellSchema = z.object({
  profile: z.literal('bash'),
  dialect: z.literal('posix'),
  pathStyle: z.literal('native'),
  executable: z.string().min(1),
  args: z.tuple([z.literal('-c')]),
  displayName: z.literal('Bash')
})

const ResolvedZshCommandShellSchema = z.object({
  profile: z.literal('zsh'),
  dialect: z.literal('posix'),
  pathStyle: z.literal('native'),
  executable: z.string().min(1),
  args: z.tuple([z.literal('-c')]),
  displayName: z.literal('Zsh')
})

const ResolvedFishCommandShellSchema = z.object({
  profile: z.literal('fish'),
  dialect: z.literal('posix'),
  pathStyle: z.literal('native'),
  executable: z.string().min(1),
  args: z.tuple([z.literal('-c')]),
  displayName: z.literal('Fish')
})

const ResolvedCmdCommandShellSchema = z.object({
  profile: z.literal('cmd'),
  dialect: z.literal('cmd'),
  pathStyle: z.literal('win32'),
  executable: z.literal('cmd.exe'),
  args: z.tuple([z.literal('/c')]),
  displayName: z.literal('Command Prompt')
})

const ResolvedWindowsPowerShellSchema = z.object({
  profile: z.literal('windows-powershell'),
  dialect: z.literal('powershell'),
  pathStyle: z.literal('win32'),
  executable: z.literal('powershell.exe'),
  args: z.tuple([z.literal('-NoProfile'), z.literal('-Command')]),
  displayName: z.literal('Windows PowerShell')
})

const ResolvedPowerShellCoreSchema = z.object({
  profile: z.literal('powershell-core'),
  dialect: z.literal('powershell'),
  pathStyle: z.literal('win32'),
  executable: z.literal('pwsh.exe'),
  args: z.tuple([z.literal('-NoProfile'), z.literal('-Command')]),
  displayName: z.literal('PowerShell 7')
})

const ResolvedGitBashCommandShellSchema = z.object({
  profile: z.literal('git-bash'),
  dialect: z.literal('posix'),
  pathStyle: z.literal('msys'),
  executable: z.string().min(1),
  args: z.tuple([z.literal('-c')]),
  displayName: z.literal('Git Bash')
})

export const ResolvedCommandShellSchema = z.discriminatedUnion('profile', [
  ResolvedPosixCommandShellSchema,
  ResolvedBashCommandShellSchema,
  ResolvedZshCommandShellSchema,
  ResolvedFishCommandShellSchema,
  ResolvedCmdCommandShellSchema,
  ResolvedWindowsPowerShellSchema,
  ResolvedPowerShellCoreSchema,
  ResolvedGitBashCommandShellSchema
])

export const GitBashResolutionSourceSchema = z.enum(['override', 'common-path', 'git-path'])
export const GitBashResolutionErrorSchema = z.enum([
  'unsupported-platform',
  'override-invalid',
  'not-found',
  'validation-failed'
])

export const GitBashAvailabilitySchema = z.union([
  z.object({
    supported: z.literal(true),
    available: z.literal(true),
    executable: z.string().min(1),
    source: GitBashResolutionSourceSchema
  }),
  z.object({
    supported: z.literal(true),
    available: z.literal(false),
    error: z.enum(['override-invalid', 'not-found', 'validation-failed'])
  }),
  z.object({
    supported: z.literal(false),
    available: z.literal(false),
    error: z.literal('unsupported-platform')
  })
])

export type AgentCommandShellPreference = z.infer<typeof AgentCommandShellPreferenceSchema>
export type AgentCommandShellConfig = z.infer<typeof AgentCommandShellConfigSchema>
export type CommandShellProfile = z.infer<typeof CommandShellProfileSchema>
export type CommandShellDialect = z.infer<typeof CommandShellDialectSchema>
export type CommandShellPathStyle = z.infer<typeof CommandShellPathStyleSchema>
type DeepReadonlyCommandShell<Shell extends { args: readonly string[] }> = Shell extends unknown
  ? Readonly<Omit<Shell, 'args'> & { args: Readonly<Shell['args']> }>
  : never

export type ResolvedCommandShell = DeepReadonlyCommandShell<
  z.infer<typeof ResolvedCommandShellSchema>
>
export type GitBashResolutionSource = z.infer<typeof GitBashResolutionSourceSchema>
export type GitBashResolutionError = z.infer<typeof GitBashResolutionErrorSchema>
export type GitBashAvailability = z.infer<typeof GitBashAvailabilitySchema>

export const DEFAULT_AGENT_COMMAND_SHELL_CONFIG: AgentCommandShellConfig = Object.freeze({
  preference: 'auto'
})

export function normalizeAgentCommandShellConfig(value: unknown): AgentCommandShellConfig {
  const parsed = AgentCommandShellConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_AGENT_COMMAND_SHELL_CONFIG
}

const MAX_SHELL_DISPLAY_NAME_CHARS = 128

function sanitizeShellDisplayName(value: string): string {
  const trimmed = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(trimmed)
    ? trimmed.slice(0, MAX_SHELL_DISPLAY_NAME_CHARS)
    : ''
}

function executableBasename(executable: string): string {
  return executable.split(/[\\/]/).filter(Boolean).at(-1) ?? executable
}

const FISH_DIALECT_HINT = 'Fish is not POSIX; bash idioms such as export do not work.'

function isFishIdentity(shell: ResolvedCommandShell): boolean {
  const names = [
    sanitizeShellDisplayName(shell.displayName),
    sanitizeShellDisplayName(executableBasename(shell.executable))
  ]
  return names.some((name) => name.toLowerCase() === 'fish')
}

function commandShellDialectHint(shell: ResolvedCommandShell): string {
  switch (shell.profile) {
    case 'windows-powershell':
      return 'It does not support && or ||; use ; for unconditional sequential execution.'
    case 'powershell-core':
    case 'cmd':
      return 'It supports && and ||.'
    case 'git-bash':
      return 'Use POSIX syntax. Use Windows-native paths with file tools; MSYS drive paths such as /c/... are for shell commands.'
    case 'fish':
      return FISH_DIALECT_HINT
    case 'posix':
      return isFishIdentity(shell) ? FISH_DIALECT_HINT : ''
    case 'bash':
    case 'zsh':
      return ''
  }
}

function shellDisplayName(shell: ResolvedCommandShell): string {
  // The posix profile is the only one whose display name comes from the user's $SHELL.
  return shell.profile === 'posix'
    ? sanitizeShellDisplayName(shell.displayName) || 'POSIX shell'
    : shell.displayName
}

function withDialectHint(lead: string, shell: ResolvedCommandShell): string {
  const hint = commandShellDialectHint(shell)
  return hint ? `${lead} ${hint}` : lead
}

export function formatCommandShellPromptLine(shell: ResolvedCommandShell): string {
  return withDialectHint(`Shell: ${shellDisplayName(shell)}.`, shell)
}

export function formatCommandShellForModel(shell: ResolvedCommandShell): string {
  const displayName = shellDisplayName(shell)
  const executable = sanitizeShellDisplayName(executableBasename(shell.executable))
  const identity = executable ? `${displayName} (${executable})` : displayName
  return withDialectHint(`Selected shell: ${identity}.`, shell)
}

export function formatExecCommandDescription(shell: ResolvedCommandShell): string {
  return withDialectHint(`The ${shellDisplayName(shell)} command to execute.`, shell)
}
