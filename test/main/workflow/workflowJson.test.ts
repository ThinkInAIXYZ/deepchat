import { describe, expect, it, vi } from 'vitest'
import { canonicalizeWorkflowJson } from '@/workflow/domain/json'

describe('workflow canonical JSON', () => {
  it('produces one hash regardless of object insertion order', () => {
    const left = canonicalizeWorkflowJson(
      {
        z: 1,
        nested: { b: true, a: 'value' }
      },
      { maxBytes: 1024 }
    )
    const right = canonicalizeWorkflowJson(
      {
        nested: { a: 'value', b: true },
        z: 1
      },
      { maxBytes: 1024 }
    )

    expect(left.json).toBe(right.json)
    expect(left.sha256).toBe(right.sha256)
  })

  it('rejects accessors without invoking them', () => {
    const getter = vi.fn(() => 'secret')
    const value = {}
    Object.defineProperty(value, 'token', {
      enumerable: true,
      get: getter
    })

    expect(() => canonicalizeWorkflowJson(value, { maxBytes: 1024 })).toThrow('non-data property')
    expect(getter).not.toHaveBeenCalled()
  })

  it('rejects cycles, unsafe keys, and oversized payloads', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const unsafe = JSON.parse('{"__proto__":{"polluted":true}}') as unknown

    expect(() => canonicalizeWorkflowJson(cyclic, { maxBytes: 1024 })).toThrow('cycle')
    expect(() => canonicalizeWorkflowJson(unsafe, { maxBytes: 1024 })).toThrow('unsafe key')
    expect(() => canonicalizeWorkflowJson('x'.repeat(20), { maxBytes: 10 })).toThrow(
      'exceeds the 10-byte limit'
    )
  })

  it('normalizes negative zero and accepts repeated non-cyclic values', () => {
    const shared = { value: -0 }
    const result = canonicalizeWorkflowJson([shared, shared], { maxBytes: 1024 })

    expect(JSON.parse(result.json)).toEqual([{ value: 0 }, { value: 0 }])
  })

  it('enforces one total collection-entry budget across nested branches', () => {
    expect(() =>
      canonicalizeWorkflowJson(
        {
          left: [1, 2],
          right: [3, 4]
        },
        {
          maxBytes: 1_024,
          maxCollectionEntries: 5
        }
      )
    ).toThrow('5-entry limit')
  })
})
