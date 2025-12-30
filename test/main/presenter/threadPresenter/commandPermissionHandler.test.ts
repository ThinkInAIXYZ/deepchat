import { describe, expect, it } from 'vitest'
import {
  CommandPermissionCache,
  CommandPermissionHandler
} from '@/presenter/threadPresenter/handlers/commandPermissionHandler'

describe('CommandPermissionHandler', () => {
  it('allows whitelisted commands without approval', () => {
    const handler = new CommandPermissionHandler()
    const result = handler.checkPermission('conv-1', 'ls -la')

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe('whitelist')
    expect(result.risk.level).toBe('low')
  })

  it('requires approval for install commands', () => {
    const handler = new CommandPermissionHandler()
    const result = handler.checkPermission('conv-1', 'npm install react')

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('permission')
    expect(result.risk.level).toBe('medium')
  })

  it('flags destructive commands as critical', () => {
    const handler = new CommandPermissionHandler()
    const result = handler.assessCommandRisk('rm -rf /')

    expect(result.level).toBe('critical')
  })

  it('extracts command signatures', () => {
    const handler = new CommandPermissionHandler()
    expect(handler.extractCommandSignature('git pull origin main')).toBe('git pull')
    expect(handler.extractCommandSignature('rm -rf /')).toBe('rm -rf /')
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
