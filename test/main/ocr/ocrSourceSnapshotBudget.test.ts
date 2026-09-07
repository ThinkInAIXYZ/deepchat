import { describe, expect, it } from 'vitest'

import {
  OcrSourceSnapshotBudget,
  OcrSourceSnapshotBudgetError
} from '../../../src/main/ocr/ocrSourceSnapshotBudget'

describe('OcrSourceSnapshotBudget', () => {
  it('enforces one shared item and byte budget across extraction services', () => {
    const budget = new OcrSourceSnapshotBudget(2, 10)
    budget.reserve(4)
    budget.reserve(6)

    expect(() => budget.reserve(1)).toThrow(OcrSourceSnapshotBudgetError)
    expect(budget.getStatus()).toEqual({ reservedSnapshots: 2, reservedBytes: 10 })

    budget.release(4)
    budget.reserve(1)
    expect(budget.getStatus()).toEqual({ reservedSnapshots: 2, reservedBytes: 7 })
  })
})
