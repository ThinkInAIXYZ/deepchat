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

function executableBasename(executable: string): string {
  return executable.split(/[\\/]/).filter(Boolean).at(-1) ?? executable
}

export function formatCommandShellForModel(shell: ResolvedCommandShell): string {
  const cwdSemantics =
    shell.pathStyle === 'msys'
      ? 'cwd accepts Windows paths and is translated for the MSYS shell.'
      : shell.pathStyle === 'win32'
        ? 'cwd uses Windows paths.'
        : 'cwd uses native POSIX paths.'
  return [
    `Selected shell: ${shell.displayName} (${executableBasename(shell.executable)}).`,
    `Dialect: ${shell.dialect}; path style: ${shell.pathStyle}; ${cwdSemantics}`
  ].join(' ')
}
