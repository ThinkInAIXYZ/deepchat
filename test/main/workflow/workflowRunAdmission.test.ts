import { describe, expect, it } from 'vitest'
import { WorkflowRunAdmission } from '@/workflow/runAdmission'

describe('WorkflowRunAdmission', () => {
  it('uses a separate bounded permit pool for utility processes', async () => {
    const admission = new WorkflowRunAdmission(1, 1)
    expect(admission.availableSchedulingSlots()).toBe(2)
    const first = await admission.acquire({ ownerId: 'parent-a' })
    expect(admission.availableSchedulingSlots()).toBe(1)
    let secondAdmitted = false
    const second = admission.acquire({ ownerId: 'parent-b' }).then((permit) => {
      secondAdmitted = true
      return permit
    })

    await Promise.resolve()
    expect(secondAdmitted).toBe(false)
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 1 })
    expect(admission.availableSchedulingSlots()).toBe(0)

    first.release()
    const secondPermit = await second
    expect(secondAdmitted).toBe(true)
    expect(admission.snapshot()).toMatchObject({ active: 1, pending: 0 })
    expect(admission.availableSchedulingSlots()).toBe(1)
    secondPermit.release()
    expect(admission.snapshot()).toMatchObject({ active: 0, pending: 0 })
    expect(admission.availableSchedulingSlots()).toBe(2)
  })
})
