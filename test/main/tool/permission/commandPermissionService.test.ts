import { describe, expect, it } from 'vitest'
import {
  buildCommandPermissionSignature,
  CommandPermissionCache,
  CommandPermissionService
} from '@/tool/permission'
import {
  CMD_COMMAND_SHELL,
  GIT_BASH_COMMAND_SHELL,
  POSIX_COMMAND_SHELL,
  WINDOWS_POWERSHELL_COMMAND_SHELL
} from '../../../helpers/commandShell'

const checkPosix = (
  service: CommandPermissionService,
  conversationId: string,
  command: string,
  oneShotGrantId?: string
) => service.checkPermission(conversationId, command, POSIX_COMMAND_SHELL, oneShotGrantId)

const checkGitBash = (
  service: CommandPermissionService,
  conversationId: string,
  command: string,
  oneShotGrantId?: string
) => service.checkPermission(conversationId, command, GIT_BASH_COMMAND_SHELL, oneShotGrantId)

describe('CommandPermissionService', () => {
  it('allows whitelisted commands without approval', () => {
    const service = new CommandPermissionService()
    const result = checkPosix(service, 'conv-1', 'ls -la')

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('whitelist')
    expect(result.risk.level).toBe('low')
  })

  it('keeps POSIX safe-command matching case-sensitive', () => {
    const service = new CommandPermissionService()
    const result = checkPosix(service, 'conv-1', 'LS -la')

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
    expect(result.risk.level).toBe('medium')
  })

  it('requires approval for install commands', () => {
    const service = new CommandPermissionService()
    const result = checkPosix(service, 'conv-1', 'npm install react')

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
    expect(result.risk.level).toBe('medium')
  })

  it('flags destructive commands as critical', () => {
    const service = new CommandPermissionService()
    const result = checkPosix(service, 'conv-1', 'rm -rf /')

    expect(result.risk.level).toBe('critical')
  })

  it('builds namespaced command signatures', () => {
    expect(buildCommandPermissionSignature('git pull origin main', POSIX_COMMAND_SHELL)).toBe(
      'posix:git pull'
    )
    expect(buildCommandPermissionSignature('rm -rf /', POSIX_COMMAND_SHELL)).toBe('posix:rm -rf /')
  })

  it('keeps deepchat outside the implicit safe-command set', () => {
    const service = new CommandPermissionService()
    const result = checkPosix(service, 'conv-1', 'deepchat model invoke --prompt hello')

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
    expect(result.signature).toBe('posix:deepchat model')
  })

  it.each([
    'cat notes.txt > copied.txt',
    'cat notes.txt 2>> errors.log',
    'cat < notes.txt',
    'ls | sort',
    'ls && touch changed.txt',
    'ls\ntouch changed.txt',
    'echo $(touch changed.txt)',
    'echo `touch changed.txt`',
    'sleep 1 & touch changed.txt'
  ])('requires an exact approval for shell control syntax in %j', (command) => {
    const service = new CommandPermissionService()
    const result = checkPosix(service, 'conv-1', command)

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
    expect(result.risk.level).toBe('critical')
    expect(result.signature).toMatch(/^posix:shell:[a-f0-9]{64}$/)
  })

  it.each([
    'echo "a > b"',
    "grep 'a&b' notes.txt",
    "echo '\$(touch changed.txt)'",
    'echo escaped\\>value'
  ])('does not treat quoted or escaped shell characters as control syntax in %j', (command) => {
    const service = new CommandPermissionService()
    const result = checkPosix(service, 'conv-1', command)

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('whitelist')
    expect(result.risk.level).toBe('low')
    expect(result.signature).not.toMatch(/^posix:shell:/)
  })

  it('detects command substitution inside double quotes', () => {
    const service = new CommandPermissionService()
    const result = checkPosix(service, 'conv-1', 'echo "$(touch changed.txt)"')

    expect(result.allowed).toBe(false)
    expect(result.risk.level).toBe('critical')
    expect(result.signature).toMatch(/^posix:shell:[a-f0-9]{64}$/)
  })

  it('exposes shell-control classification to trusted command adapters', () => {
    const service = new CommandPermissionService()

    expect(service.hasShellControlSyntax('deepchat model invoke', 'posix')).toBe(false)
    expect(service.hasShellControlSyntax('deepchat model invoke > output.txt', 'posix')).toBe(true)
  })

  it('does not let a broad command approval authorize a redirected command', () => {
    const service = new CommandPermissionService()
    const grantId = service.approve('conv-1', 'posix:deepchat model', false)
    if (!grantId) throw new Error('Expected one-shot grant')

    const redirected = service.checkPermission(
      'conv-1',
      'deepchat model invoke --prompt hello > output.txt',
      POSIX_COMMAND_SHELL
    )
    const original = checkPosix(service, 'conv-1', 'deepchat model invoke --prompt hello', grantId)

    expect(redirected.allowed).toBe(false)
    expect(redirected.signature).toMatch(/^posix:shell:[a-f0-9]{64}$/)
    expect(original.allowed).toBe(true)
  })

  it('allows only the exact shell expression that was approved', () => {
    const service = new CommandPermissionService()
    const command = 'deepchat model invoke --prompt hello > output.txt'
    const signature = buildCommandPermissionSignature(command, POSIX_COMMAND_SHELL)
    const grantId = service.approve('conv-1', signature, false)
    if (!grantId) throw new Error('Expected one-shot grant')

    expect(checkPosix(service, 'conv-1', command, grantId).allowed).toBe(true)
    expect(
      checkPosix(service, 'conv-1', 'deepchat model invoke --prompt hello > other.txt').allowed
    ).toBe(false)
  })

  it('isolates identical command approvals by shell profile', () => {
    const service = new CommandPermissionService()
    const command = 'npm install react'
    const posix = checkPosix(service, 'conv-1', command)
    const grantId = service.approve('conv-1', posix.signature, false)
    if (!grantId) throw new Error('Expected one-shot grant')

    expect(
      service.checkPermission('conv-1', command, WINDOWS_POWERSHELL_COMMAND_SHELL).allowed
    ).toBe(false)
    expect(checkPosix(service, 'conv-1', command, grantId).allowed).toBe(true)
  })

  it('isolates approvals between profiles that share the POSIX dialect', () => {
    const service = new CommandPermissionService()
    const command = 'npm install react'
    const posixSignature = checkPosix(service, 'conv-1', command).signature
    const gitBashSignature = checkGitBash(service, 'conv-1', command).signature

    expect(posixSignature).toBe('posix:npm install')
    expect(gitBashSignature).toBe('git-bash:npm install')

    const posixGrantId = service.approve('conv-1', posixSignature, false)
    if (!posixGrantId) throw new Error('Expected POSIX one-shot grant')

    expect(checkGitBash(service, 'conv-1', command, posixGrantId).allowed).toBe(false)
    expect(checkPosix(service, 'conv-1', command, posixGrantId).allowed).toBe(true)

    const gitBashGrantId = service.approve('conv-1', gitBashSignature, false)
    if (!gitBashGrantId) throw new Error('Expected Git Bash one-shot grant')

    expect(checkPosix(service, 'conv-1', command, gitBashGrantId).allowed).toBe(false)
    expect(checkGitBash(service, 'conv-1', command, gitBashGrantId).allowed).toBe(true)
  })

  it('models PowerShell single quotes, substitution, and destructive removal', () => {
    const service = new CommandPermissionService()

    expect(
      service.checkPermission(
        'conv-1',
        "Write-Output '; $(Get-Item secret)'",
        WINDOWS_POWERSHELL_COMMAND_SHELL
      ).risk.level
    ).toBe('low')
    expect(
      service.checkPermission(
        'conv-1',
        'Write-Output "$(Get-Item secret)"',
        WINDOWS_POWERSHELL_COMMAND_SHELL
      ).risk.level
    ).toBe('critical')
    expect(
      service.checkPermission(
        'conv-1',
        'Remove-Item C:\\data -Recurse -Force',
        WINDOWS_POWERSHELL_COMMAND_SHELL
      ).risk.level
    ).toBe('critical')
  })

  it('preserves case-sensitive POSIX risk matching', () => {
    const service = new CommandPermissionService()

    expect(checkPosix(service, 'conv-1', 'RM target').risk.level).toBe('medium')
    expect(checkPosix(service, 'conv-1', 'CURL https://example.com').risk.level).toBe('medium')
  })

  it('requires exact approval for PowerShell parenthesized expressions', () => {
    const service = new CommandPermissionService()
    const command = "Write-Output ([System.IO.File]::Delete('C:\\data.txt'))"
    const result = service.checkPermission('conv-1', command, WINDOWS_POWERSHELL_COMMAND_SHELL)

    expect(result.allowed).toBe(false)
    expect(result.risk.level).toBe('critical')
    expect(result.signature).toMatch(/^windows-powershell:shell:[a-f0-9]{64}$/)
  })

  it('treats CMD grouping and caret syntax conservatively', () => {
    const service = new CommandPermissionService()

    expect(service.hasShellControlSyntax('echo ^& safe', 'cmd')).toBe(true)
    expect(service.hasShellControlSyntax('echo "quoted^" & whoami"', 'cmd')).toBe(true)
    expect(service.hasShellControlSyntax('(echo first) && echo second', 'cmd')).toBe(true)
  })

  it('treats CMD variable expansion as control syntax', () => {
    const service = new CommandPermissionService()

    expect(service.hasShellControlSyntax('echo "%COMSPEC%"', 'cmd')).toBe(true)
    expect(service.hasShellControlSyntax('echo !DEEPCHAT_COMMAND!', 'cmd')).toBe(true)
    expect(service.hasShellControlSyntax('echo ^%PATH^%', 'cmd')).toBe(true)
  })

  it('does not whitelist CMD sort because /O can write an arbitrary file', () => {
    const service = new CommandPermissionService()
    const result = service.checkPermission(
      'conv-1',
      'sort /O secrets.txt input.txt',
      CMD_COMMAND_SHELL
    )

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
  })

  it.each([
    'diff --output=secrets.patch before.txt after.txt',
    'find . -delete',
    'find . -exec rm {} +',
    'find . -e\\xec rm {} \\;',
    'sort -o secrets.txt input.txt',
    'sort --out=secrets.txt input.txt',
    "sort --co''mpress-program=arbitrary-program input.txt",
    'uniq input.txt secrets.txt'
  ])('requires approval for Git Bash utilities with side-effecting modes in %j', (command) => {
    const service = new CommandPermissionService()
    const result = checkGitBash(service, 'conv-1', command)

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
  })

  it('keeps Git Bash hardening isolated from the legacy POSIX profile', () => {
    const service = new CommandPermissionService()

    expect(checkGitBash(service, 'conv-1', 'ls -la').allowed).toBe(true)
    expect(checkPosix(service, 'conv-1', 'find . -delete').allowed).toBe(true)
  })

  it('requires approval when a Git Bash safe command has environment assignments', () => {
    const service = new CommandPermissionService()

    expect(checkGitBash(service, 'conv-1', 'PATH=/attacker ls').allowed).toBe(false)
    expect(checkGitBash(service, 'conv-1', "LC_ALL='C UTF-8' ls").allowed).toBe(false)
    expect(checkPosix(service, 'conv-1', 'PATH=/attacker ls').allowed).toBe(true)
  })
})

describe('CommandPermissionCache', () => {
  it('supports session approvals', () => {
    const cache = new CommandPermissionCache()
    cache.approve('conv-1', 'npm install', true)

    expect(cache.isApproved('conv-1', 'npm install')).toBe(true)
    expect(cache.isApproved('conv-1', 'npm install')).toBe(true)
  })

  it('consumes one-time approvals', () => {
    const cache = new CommandPermissionCache()
    const grantId = cache.approve('conv-1', 'npm install', false)
    if (!grantId) throw new Error('Expected one-shot grant')

    expect(cache.isApproved('conv-1', 'npm install')).toBe(false)
    expect(cache.isApproved('conv-1', 'npm install', grantId)).toBe(true)
    expect(cache.isApproved('conv-1', 'npm install', grantId)).toBe(false)
  })

  it('clears cached approvals', () => {
    const cache = new CommandPermissionCache()
    cache.approve('conv-1', 'npm install', true)
    cache.clearConversation('conv-1')

    expect(cache.isApproved('conv-1', 'npm install')).toBe(false)

    cache.approve('conv-2', 'git pull', true)
    cache.clearAll()
    expect(cache.isApproved('conv-2', 'git pull')).toBe(false)
  })

  it('revokes only the selected one-time approval', () => {
    const cache = new CommandPermissionCache()
    const firstGrantId = cache.approve('conv-1', 'posix:first', false)
    const secondGrantId = cache.approve('conv-1', 'posix:second', false)
    if (!firstGrantId || !secondGrantId) throw new Error('Expected one-shot grants')

    expect(cache.revokeOnce('conv-1', 'posix:first', firstGrantId)).toBe(true)
    expect(cache.isApproved('conv-1', 'posix:first', firstGrantId)).toBe(false)
    expect(cache.isApproved('conv-1', 'posix:second', secondGrantId)).toBe(true)
  })

  it('tracks concurrent one-time grants for the same signature independently', () => {
    const cache = new CommandPermissionCache()
    const firstGrantId = cache.approve('conv-1', 'posix:npm install', false)
    const secondGrantId = cache.approve('conv-1', 'posix:npm install', false)
    if (!firstGrantId || !secondGrantId) throw new Error('Expected one-shot grants')

    expect(firstGrantId).not.toBe(secondGrantId)
    expect(cache.isApproved('conv-1', 'posix:npm install', firstGrantId)).toBe(true)
    expect(cache.revokeOnce('conv-1', 'posix:npm install', firstGrantId)).toBe(false)
    expect(cache.isApproved('conv-1', 'posix:npm install', secondGrantId)).toBe(true)
    expect(cache.isApproved('conv-1', 'posix:npm install', secondGrantId)).toBe(false)
  })
})
