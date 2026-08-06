import { describe, expect, it } from 'vitest'
import { CommandPermissionCache, CommandPermissionService } from '@/tool/permission'

describe('CommandPermissionService', () => {
  it('allows whitelisted commands without approval', () => {
    const service = new CommandPermissionService()
    const result = service.checkPermission('conv-1', 'ls -la')

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('whitelist')
    expect(result.risk.level).toBe('low')
  })

  it('requires approval for install commands', () => {
    const service = new CommandPermissionService()
    const result = service.checkPermission('conv-1', 'npm install react')

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
    expect(result.risk.level).toBe('medium')
  })

  it('flags destructive commands as critical', () => {
    const service = new CommandPermissionService()
    const result = service.assessCommandRisk('rm -rf /')

    expect(result.level).toBe('critical')
  })

  it('extracts command signatures', () => {
    const service = new CommandPermissionService()
    expect(service.extractCommandSignature('git pull origin main')).toBe('git pull')
    expect(service.extractCommandSignature('rm -rf /')).toBe('rm -rf /')
  })

  it('keeps deepchat outside the implicit safe-command set', () => {
    const service = new CommandPermissionService()
    const result = service.checkPermission('conv-1', 'deepchat model invoke --prompt hello')

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
    expect(result.signature).toBe('deepchat model')
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
    const result = service.checkPermission('conv-1', command)

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
    expect(result.risk.level).toBe('critical')
    expect(result.signature).toMatch(/^shell:[a-f0-9]{64}$/)
  })

  it.each([
    'echo "a > b"',
    "grep 'a&b' notes.txt",
    "echo '\$(touch changed.txt)'",
    'echo escaped\\>value'
  ])('does not treat quoted or escaped shell characters as control syntax in %j', (command) => {
    const service = new CommandPermissionService()
    const result = service.checkPermission('conv-1', command)

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('whitelist')
    expect(result.risk.level).toBe('low')
    expect(result.signature).not.toMatch(/^shell:/)
  })

  it('detects command substitution inside double quotes', () => {
    const service = new CommandPermissionService()
    const result = service.checkPermission('conv-1', 'echo "$(touch changed.txt)"')

    expect(result.allowed).toBe(false)
    expect(result.risk.level).toBe('critical')
    expect(result.signature).toMatch(/^shell:[a-f0-9]{64}$/)
  })

  it('exposes shell-control classification to trusted command adapters', () => {
    const service = new CommandPermissionService()

    expect(service.hasShellControlSyntax('deepchat model invoke')).toBe(false)
    expect(service.hasShellControlSyntax('deepchat model invoke > output.txt')).toBe(true)
  })

  it('does not let a broad command approval authorize a redirected command', () => {
    const service = new CommandPermissionService()
    service.approve('conv-1', 'deepchat model', false)

    const redirected = service.checkPermission(
      'conv-1',
      'deepchat model invoke --prompt hello > output.txt'
    )
    const original = service.checkPermission('conv-1', 'deepchat model invoke --prompt hello')

    expect(redirected.allowed).toBe(false)
    expect(redirected.signature).toMatch(/^shell:[a-f0-9]{64}$/)
    expect(original.allowed).toBe(true)
  })

  it('allows only the exact shell expression that was approved', () => {
    const service = new CommandPermissionService()
    const command = 'deepchat model invoke --prompt hello > output.txt'
    const signature = service.extractCommandSignature(command)
    service.approve('conv-1', signature, false)

    expect(service.checkPermission('conv-1', command).allowed).toBe(true)
    expect(
      service.checkPermission('conv-1', 'deepchat model invoke --prompt hello > other.txt').allowed
    ).toBe(false)
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
    cache.approve('conv-1', 'npm install', false)

    expect(cache.isApproved('conv-1', 'npm install')).toBe(true)
    expect(cache.isApproved('conv-1', 'npm install')).toBe(false)
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
})
