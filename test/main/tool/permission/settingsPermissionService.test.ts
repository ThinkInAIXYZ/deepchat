import { describe, expect, it } from 'vitest'
import { SettingsPermissionService } from '@/tool/permission'

describe('SettingsPermissionService', () => {
  it('revokes an unconsumed provisional approval', () => {
    const service = new SettingsPermissionService()
    const leaseId = service.approveProvisional('conv-1', 'set_language')

    service.revokeProvisional('conv-1', leaseId)

    expect(service.consumeApproval('conv-1', 'set_language')).toBe(false)
  })

  it('keeps a consumed provisional approval consumed after finalization', () => {
    const service = new SettingsPermissionService()
    const leaseId = service.approveProvisional('conv-1', 'set_language')

    expect(service.consumeApproval('conv-1', 'set_language', leaseId)).toBe(true)
    service.finalizeProvisional('conv-1', leaseId)

    expect(service.consumeApproval('conv-1', 'set_language')).toBe(false)
  })

  it('finalizes an unconsumed provisional approval as one-time authority', () => {
    const service = new SettingsPermissionService()
    const leaseId = service.approveProvisional('conv-1', 'set_language')

    service.finalizeProvisional('conv-1', leaseId)

    expect(service.consumeApproval('conv-1', 'set_language')).toBe(true)
    expect(service.consumeApproval('conv-1', 'set_language')).toBe(false)
  })

  it('keeps independently finalized same-tool leases isolated', () => {
    const service = new SettingsPermissionService()
    const firstLeaseId = service.approveProvisional('conv-1', 'set_language')
    const secondLeaseId = service.approveProvisional('conv-1', 'set_language')

    expect(service.consumeApproval('conv-1', 'set_language', firstLeaseId)).toBe(true)
    service.finalizeProvisional('conv-1', secondLeaseId)
    service.finalizeProvisional('conv-1', firstLeaseId)

    expect(service.consumeApproval('conv-1', 'set_language')).toBe(true)
    expect(service.consumeApproval('conv-1', 'set_language')).toBe(false)
  })

  it('consumes only the provisional capability supplied by the operation', () => {
    const service = new SettingsPermissionService()
    const firstLeaseId = service.approveProvisional('conv-1', 'set_language')
    const secondLeaseId = service.approveProvisional('conv-1', 'set_language')

    expect(service.consumeApproval('conv-1', 'set_language', firstLeaseId)).toBe(true)
    expect(service.consumeApproval('conv-1', 'set_language', firstLeaseId)).toBe(false)
    expect(service.consumeApproval('conv-1', 'set_language', secondLeaseId)).toBe(true)
  })

  it('does not let an ordinary call consume another operation provisional approval', () => {
    const service = new SettingsPermissionService()
    const leaseId = service.approveProvisional('conv-1', 'set_language')

    expect(service.consumeApproval('conv-1', 'set_language')).toBe(false)
    expect(service.consumeApproval('conv-1', 'set_language', leaseId)).toBe(true)
  })

  it('does not substitute ordinary authority for an invalid operation capability', () => {
    const service = new SettingsPermissionService()
    service.approve('conv-1', 'set_language', false)

    expect(service.consumeApproval('conv-1', 'set_language', 'missing-lease')).toBe(false)
    expect(service.consumeApproval('conv-1', 'set_language')).toBe(true)
  })
})
