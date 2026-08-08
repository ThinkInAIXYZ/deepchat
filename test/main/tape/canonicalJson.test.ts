import { describe, expect, it } from 'vitest'
import { canonicalJsonStringifyData, hashJsonData } from '@/tape/domain/canonicalJson'

describe('strict canonical JSON', () => {
  it('preserves prototype-shaped keys and ignores object insertion order', () => {
    const prototypeShaped = JSON.parse('{"value":1,"__proto__":{"allowed":true}}')

    expect(canonicalJsonStringifyData(prototypeShaped)).toBe(
      '{"__proto__":{"allowed":true},"value":1}'
    )
    expect(hashJsonData({ second: 2, first: 1 })).toBe(hashJsonData({ first: 1, second: 2 }))
    expect(hashJsonData(prototypeShaped)).not.toBe(hashJsonData({ value: 1 }))
  })

  it('rejects values that cannot be represented as stable JSON data', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const sparse = new Array(2)
    sparse[1] = 'present'
    const symbolObject = { value: 1 }
    Object.defineProperty(symbolObject, Symbol('hidden'), { value: true, enumerable: true })
    const symbolArray = [1]
    Object.defineProperty(symbolArray, Symbol('hidden'), { value: true, enumerable: true })

    for (const value of [
      { value: Number.POSITIVE_INFINITY },
      { value: Number.NaN },
      { value: undefined },
      sparse,
      new Date(0),
      symbolObject,
      symbolArray,
      circular
    ]) {
      expect(() => canonicalJsonStringifyData(value)).toThrow(TypeError)
    }
  })

  it('rejects accessors without executing them', () => {
    let getterCalled = false
    const value = {}
    Object.defineProperty(value, 'secret', {
      enumerable: true,
      get: () => {
        getterCalled = true
        return 'leaked'
      }
    })

    expect(() => canonicalJsonStringifyData(value)).toThrow('non-data property')
    expect(getterCalled).toBe(false)
  })
})
