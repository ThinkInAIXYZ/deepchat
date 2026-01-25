/**
 * Unit tests for AgentRegistry
 * Tests agent registration, exact match lookup, prefix match lookup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgentRegistry } from '@/presenter/agentic/registry'
import type { IAgentPresenter } from '@/presenter/agentic/types'

describe('AgentRegistry', () => {
  let registry: AgentRegistry
  let mockAgent1: IAgentPresenter
  let mockAgent2: IAgentPresenter
  let mockWildcardAgent: IAgentPresenter

  beforeEach(() => {
    registry = new AgentRegistry()

    // Create mock agents
    mockAgent1 = {
      agentId: 'deepchat.default',
      createSession: vi.fn(),
      getSession: vi.fn(),
      loadSession: vi.fn(),
      closeSession: vi.fn(),
      sendMessage: vi.fn(),
      cancelMessage: vi.fn(),
      setModel: vi.fn(),
      setMode: vi.fn(),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter

    mockAgent2 = {
      agentId: 'acp.anthropic.claude-code',
      createSession: vi.fn(),
      getSession: vi.fn(),
      loadSession: vi.fn(),
      closeSession: vi.fn(),
      sendMessage: vi.fn(),
      cancelMessage: vi.fn(),
      setModel: vi.fn(),
      setMode: vi.fn(),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter

    mockWildcardAgent = {
      agentId: 'acp.*',
      createSession: vi.fn(),
      getSession: vi.fn(),
      loadSession: vi.fn(),
      closeSession: vi.fn(),
      sendMessage: vi.fn(),
      cancelMessage: vi.fn(),
      setModel: vi.fn(),
      setMode: vi.fn(),
      setEmitterProvider: vi.fn()
    } as unknown as IAgentPresenter
  })

  describe('register', () => {
    it('should register an agent presenter', () => {
      registry.register(mockAgent1)

      expect(registry.getRegisteredIds()).toContain('deepchat.default')
    })

    it('should register multiple agents', () => {
      registry.register(mockAgent1)
      registry.register(mockAgent2)

      const ids = registry.getRegisteredIds()
      expect(ids).toContain('deepchat.default')
      expect(ids).toContain('acp.anthropic.claude-code')
    })

    it('should register agents with wildcard IDs', () => {
      registry.register(mockWildcardAgent)

      expect(registry.getRegisteredIds()).toContain('acp.*')
    })

    it('should allow re-registering the same agent (overwrite)', () => {
      registry.register(mockAgent1)
      registry.register(mockAgent1)

      expect(registry.getRegisteredIds().filter((id) => id === 'deepchat.default')).toHaveLength(1)
    })
  })

  describe('get - exact match', () => {
    it('should return agent by exact match', () => {
      registry.register(mockAgent1)

      const result = registry.get('deepchat.default')

      expect(result).toBe(mockAgent1)
    })

    it('should return undefined for non-existent agent', () => {
      const result = registry.get('non.existent.agent')

      expect(result).toBeUndefined()
    })

    it('should not match wildcard patterns with get()', () => {
      registry.register(mockWildcardAgent)

      // get() does exact match only, not prefix match
      const result = registry.get('acp.anthropic.claude-code')

      expect(result).toBeUndefined()
    })

    it('should return the wildcard agent itself when looking up exact wildcard ID', () => {
      registry.register(mockWildcardAgent)

      const result = registry.get('acp.*')

      expect(result).toBe(mockWildcardAgent)
    })
  })

  describe('getByPrefix - prefix match with wildcards', () => {
    beforeEach(() => {
      registry.register(mockAgent1)
      registry.register(mockWildcardAgent)
    })

    it('should return exact match when available', () => {
      const result = registry.getByPrefix('deepchat.default')

      expect(result).toBe(mockAgent1)
    })

    it('should match wildcard pattern for prefix lookup', () => {
      // 'acp.*' should match 'acp.anthropic.claude-code'
      const result = registry.getByPrefix('acp.anthropic.claude-code')

      expect(result).toBe(mockWildcardAgent)
    })

    it('should match wildcard pattern for any agent with that prefix', () => {
      // 'acp.*' should match 'acp.anything'
      const result = registry.getByPrefix('acp.anything')

      expect(result).toBe(mockWildcardAgent)
    })

    it('should return undefined when no match found', () => {
      const result = registry.getByPrefix('non.existent.agent')

      expect(result).toBeUndefined()
    })

    it('should prioritize exact match over wildcard match', () => {
      // Register both exact and wildcard
      const exactAcpAgent = {
        agentId: 'acp.test',
        createSession: vi.fn(),
        getSession: vi.fn(),
        loadSession: vi.fn(),
        closeSession: vi.fn(),
        sendMessage: vi.fn(),
        cancelMessage: vi.fn(),
        setModel: vi.fn(),
        setMode: vi.fn(),
        setEmitterProvider: vi.fn()
      } as unknown as IAgentPresenter

      registry.register(exactAcpAgent)

      // Exact match should return exact agent, not wildcard
      const result = registry.getByPrefix('acp.test')

      expect(result).toBe(exactAcpAgent)
      expect(result).not.toBe(mockWildcardAgent)
    })

    it('should handle multiple wildcards correctly', () => {
      const anotherWildcard = {
        agentId: 'deepchat.*',
        createSession: vi.fn(),
        getSession: vi.fn(),
        loadSession: vi.fn(),
        closeSession: vi.fn(),
        sendMessage: vi.fn(),
        cancelMessage: vi.fn(),
        setModel: vi.fn(),
        setMode: vi.fn(),
        setEmitterProvider: vi.fn()
      } as unknown as IAgentPresenter

      registry.register(anotherWildcard)

      // 'deepchat.*' should match 'deepchat.custom'
      const result1 = registry.getByPrefix('deepchat.custom')
      expect(result1).toBe(anotherWildcard)

      // 'acp.*' should still match 'acp.something'
      const result2 = registry.getByPrefix('acp.something')
      expect(result2).toBe(mockWildcardAgent)
    })
  })

  describe('has', () => {
    beforeEach(() => {
      registry.register(mockAgent1)
      registry.register(mockWildcardAgent)
    })

    it('should return true for exact match', () => {
      expect(registry.has('deepchat.default')).toBe(true)
    })

    it('should return true for prefix match with wildcard', () => {
      expect(registry.has('acp.anthropic.claude-code')).toBe(true)
    })

    it('should return false when agent not found', () => {
      expect(registry.has('non.existent.agent')).toBe(false)
    })

    it('should return true for exact wildcard ID match', () => {
      expect(registry.has('acp.*')).toBe(true)
    })
  })

  describe('getRegisteredIds', () => {
    it('should return empty array when no agents registered', () => {
      const ids = registry.getRegisteredIds()

      expect(ids).toEqual([])
    })

    it('should return all registered agent IDs', () => {
      registry.register(mockAgent1)
      registry.register(mockAgent2)
      registry.register(mockWildcardAgent)

      const ids = registry.getRegisteredIds()

      expect(ids).toHaveLength(3)
      expect(ids).toContain('deepchat.default')
      expect(ids).toContain('acp.anthropic.claude-code')
      expect(ids).toContain('acp.*')
    })

    it('should return IDs in registration order (Map preserves insertion order)', () => {
      registry.register(mockAgent1)
      registry.register(mockWildcardAgent)
      registry.register(mockAgent2)

      const ids = registry.getRegisteredIds()

      expect(ids).toEqual(['deepchat.default', 'acp.*', 'acp.anthropic.claude-code'])
    })
  })

  describe('clear', () => {
    it('should clear all registered agents', () => {
      registry.register(mockAgent1)
      registry.register(mockAgent2)

      expect(registry.getRegisteredIds()).toHaveLength(2)

      registry.clear()

      expect(registry.getRegisteredIds()).toEqual([])
      expect(registry.get('deepchat.default')).toBeUndefined()
      expect(registry.getByPrefix('deepchat.default')).toBeUndefined()
    })

    it('should allow registering new agents after clear', () => {
      registry.register(mockAgent1)
      registry.clear()
      registry.register(mockAgent2)

      expect(registry.getRegisteredIds()).toEqual(['acp.anthropic.claude-code'])
      expect(registry.get('acp.anthropic.claude-code')).toBe(mockAgent2)
    })
  })

  describe('Edge cases', () => {
    it('should handle agent IDs with dots correctly', () => {
      const agentWithDots = {
        agentId: 'very.nested.agent.id',
        createSession: vi.fn(),
        getSession: vi.fn(),
        loadSession: vi.fn(),
        closeSession: vi.fn(),
        sendMessage: vi.fn(),
        cancelMessage: vi.fn(),
        setModel: vi.fn(),
        setMode: vi.fn(),
        setEmitterProvider: vi.fn()
      } as unknown as IAgentPresenter

      registry.register(agentWithDots)

      expect(registry.get('very.nested.agent.id')).toBe(agentWithDots)
    })

    it('should handle wildcard at different positions', () => {
      const middleWildcard = {
        agentId: 'deepchat.*.test',
        createSession: vi.fn(),
        getSession: vi.fn(),
        loadSession: vi.fn(),
        closeSession: vi.fn(),
        sendMessage: vi.fn(),
        cancelMessage: vi.fn(),
        setModel: vi.fn(),
        setMode: vi.fn(),
        setEmitterProvider: vi.fn()
      } as unknown as IAgentPresenter

      registry.register(middleWildcard)

      // Wildcard only matches end (endsWith logic in implementation)
      // This tests the current implementation behavior
      const result = registry.getByPrefix('deepchat.custom.test')
      expect(result).toBeUndefined() // Current impl only checks endsWith('*')
    })

    it('should handle empty string agent ID (edge case)', () => {
      const emptyAgent = {
        agentId: '',
        createSession: vi.fn(),
        getSession: vi.fn(),
        loadSession: vi.fn(),
        closeSession: vi.fn(),
        sendMessage: vi.fn(),
        cancelMessage: vi.fn(),
        setModel: vi.fn(),
        setMode: vi.fn(),
        setEmitterProvider: vi.fn()
      } as unknown as IAgentPresenter

      registry.register(emptyAgent)

      expect(registry.get('')).toBe(emptyAgent)
      expect(registry.has('')).toBe(true)
    })
  })
})
