import { describe, expect, it } from 'vitest'
import path from 'path'
import { FilePermissionService } from '@/presenter/permission'

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
})
