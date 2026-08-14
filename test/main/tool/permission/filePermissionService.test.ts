import { describe, expect, it } from 'vitest'
import path from 'path'
import { FilePermissionService } from '@/tool/permission'

describe('FilePermissionService', () => {
  it('keeps read approvals from granting write access', () => {
    const service = new FilePermissionService()
    const target = path.resolve('/external/file.txt')
    const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target

    service.approve('conv-1', [target], 'read', false)

    expect(service.getApprovedPaths('conv-1', 'read')).toContain(normalizedTarget)
    expect(service.getApprovedPaths('conv-1', 'write')).not.toContain(normalizedTarget)
    expect(service.getApprovedPaths('conv-1', 'all')).not.toContain(normalizedTarget)
  })

  it('upgrades permissions without downgrading existing approvals', () => {
    const service = new FilePermissionService()
    const target = path.resolve('/external/file.txt')
    const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target

    service.approve('conv-1', [target], 'write', false)
    service.approve('conv-1', [target], 'read', false)

    expect(service.getApprovedPaths('conv-1', 'read')).toContain(normalizedTarget)
    expect(service.getApprovedPaths('conv-1', 'write')).toContain(normalizedTarget)
    expect(service.getApprovedPaths('conv-1', 'all')).not.toContain(normalizedTarget)

    service.approve('conv-1', [target], 'all', false)
    expect(service.getApprovedPaths('conv-1', 'all')).toContain(normalizedTarget)
  })

  it('revokes only provisional paths and preserves older approvals', () => {
    const service = new FilePermissionService()
    const existing = path.resolve('/external/existing.txt')
    const provisional = path.resolve('/external/provisional.txt')
    const normalizedExisting = process.platform === 'win32' ? existing.toLowerCase() : existing
    const normalizedProvisional =
      process.platform === 'win32' ? provisional.toLowerCase() : provisional
    service.approve('conv-1', [existing], 'read', false)
    const leaseId = service.approveProvisional('conv-1', [provisional], 'write')

    expect(service.getApprovedPaths('conv-1', 'write', leaseId)).toContain(normalizedProvisional)
    expect(service.getApprovedPaths('conv-1', 'write')).not.toContain(normalizedProvisional)
    service.revokeProvisional('conv-1', leaseId)

    expect(service.getApprovedPaths('conv-1', 'read')).toContain(normalizedExisting)
    expect(service.getApprovedPaths('conv-1', 'write')).not.toContain(normalizedProvisional)
  })

  it('finalizes provisional paths into ordinary conversation approvals', () => {
    const service = new FilePermissionService()
    const target = path.resolve('/external/finalized.txt')
    const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target
    const leaseId = service.approveProvisional('conv-1', [target], 'write')

    service.finalizeProvisional('conv-1', leaseId)
    service.revokeProvisional('conv-1', leaseId)

    expect(service.getApprovedPaths('conv-1', 'write')).toContain(normalizedTarget)
  })

  it('limits a provisional capability to the exact lease', () => {
    const service = new FilePermissionService()
    const first = path.resolve('/external/first.txt')
    const second = path.resolve('/external/second.txt')
    const third = path.resolve('/external/third.txt')
    const normalizedFirst = process.platform === 'win32' ? first.toLowerCase() : first
    const normalizedSecond = process.platform === 'win32' ? second.toLowerCase() : second
    service.approve('conv-1', [first], 'write', false)
    const leaseId = service.approveProvisional('conv-1', [second], 'write')
    service.approveProvisional('conv-1', [third], 'write')

    expect(service.getApprovedPaths('conv-1', 'write', leaseId)).toEqual([
      normalizedFirst,
      normalizedSecond
    ])
    expect(service.getApprovedPaths('conv-1', 'write', 'another-lease')).toEqual([])
    expect(service.getApprovedPaths('conv-1', 'write')).toEqual([normalizedFirst])
  })
})
