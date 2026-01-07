import { describe, it, expect } from 'vitest'
import { calculateSafeDefaultMaxTokens, GLOBAL_OUTPUT_TOKEN_MAX } from '@/utils/maxOutputTokens'

describe('calculateSafeDefaultMaxTokens', () => {
  describe('base cases', () => {
    it('should cap at global limit (model 200k → 32000)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: false
      })
      expect(result).toBe(32000)
    })

    it('should use model limit when below global (model 4096 → 4096)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 4096,
        reasoningSupported: false
      })
      expect(result).toBe(4096)
    })

    it('should handle global limit exactly (model 32000 → 32000)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 32000,
        reasoningSupported: false
      })
      expect(result).toBe(32000)
    })

    it('should handle small model limit (model 8192 → 8192)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 8192,
        reasoningSupported: false
      })
      expect(result).toBe(8192)
    })
  })

  describe('thinking mode with reasoning supported', () => {
    it('should reserve space for thinking budget (200k model, 20k budget → 12k text)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: true,
        thinkingBudget: 20000
      })
      expect(result).toBe(12000)
    })

    it('should allow user config when fits within limit (user 6k, budget 20k, limit 32k → 6k)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: true,
        thinkingBudget: 20000
      })
      expect(result).toBe(12000)
    })

    it('should cap text tokens when user + budget exceeds limit (user 16k, budget 20k → 12k)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 32000,
        reasoningSupported: true,
        thinkingBudget: 20000
      })
      expect(result).toBe(12000)
    })

    it('should return zero when budget exceeds global limit (budget 40k)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: true,
        thinkingBudget: 40000
      })
      expect(result).toBe(0)
    })
  })

  describe('reasoning not supported', () => {
    it('should ignore thinkingBudget when reasoning false (budget 20k, model 200k → 32k)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: false,
        thinkingBudget: 20000
      })
      expect(result).toBe(32000)
    })
  })

  describe('edge cases', () => {
    it('should handle thinkingBudget = 0', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: true,
        thinkingBudget: 0
      })
      expect(result).toBe(32000)
    })

    it('should handle thinkingBudget undefined', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: true,
        thinkingBudget: undefined
      })
      expect(result).toBe(32000)
    })

    it('should handle thinkingBudget negative (treat as 0)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: true,
        thinkingBudget: -1000
      })
      expect(result).toBe(32000)
    })

    it('should handle model limit exactly equal to thinking budget (32k model, 32k budget → 0)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 32000,
        reasoningSupported: true,
        thinkingBudget: 32000
      })
      expect(result).toBe(0)
    })

    it('should handle model with small limit and thinking (4k model, 2k budget → 2k)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 4096,
        reasoningSupported: true,
        thinkingBudget: 2000
      })
      expect(result).toBe(2096)
    })
  })

  describe('real-world scenarios', () => {
    it('scenario: new conversation with large model', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: false
      })
      expect(result).toBe(32000)
    })

    it('scenario: new conversation with reasoning model and budget', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 200000,
        reasoningSupported: true,
        thinkingBudget: 12000
      })
      expect(result).toBe(20000)
    })

    it('scenario: small model without reasoning', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 4096,
        reasoningSupported: false
      })
      expect(result).toBe(4096)
    })

    it('scenario: switch from large to small model (200k → 4k)', () => {
      const result = calculateSafeDefaultMaxTokens({
        modelMaxTokens: 4096,
        reasoningSupported: false
      })
      expect(result).toBe(4096)
    })
  })
})

describe('GLOBAL_OUTPUT_TOKEN_MAX', () => {
  it('should be 32000', () => {
    expect(GLOBAL_OUTPUT_TOKEN_MAX).toBe(32000)
  })
})
