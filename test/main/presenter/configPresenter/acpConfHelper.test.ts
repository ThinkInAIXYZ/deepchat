import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AcpConfHelper } from '@/presenter/configPresenter/acpConfHelper'
import type { AcpBuiltinAgentId } from '@shared/presenter'

// Mock electron-store
vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      private data: Record<string, any> = {
        builtins: [],
        customs: [],
        enabled: false,
        useBuiltinRuntime: false,
        version: '2'
      }

      get(key: string) {
        return this.data[key]
      }

      set(key: string, value: any) {
        this.data[key] = value
      }

      clear() {
        this.data = {
          builtins: [],
          customs: [],
          enabled: false,
          useBuiltinRuntime: false,
          version: '2'
        }
      }
    }
  }
})

// Mock McpConfHelper
vi.mock('@/presenter/configPresenter/mcpConfHelper', () => {
  return {
    McpConfHelper: class MockMcpConfHelper {
      getAllServers() {
        return []
      }
    }
  }
})

describe('AcpConfHelper - Gemini CLI Integration', () => {
  let helper: AcpConfHelper

  beforeEach(() => {
    vi.clearAllMocks()
    helper = new AcpConfHelper()
  })

  describe('Builtin Agent Configuration', () => {
    it('should include gemini-cli in builtin agents list', () => {
      const builtins = helper.getBuiltins()
      const geminiAgent = builtins.find((agent) => agent.id === 'gemini-cli')

      expect(geminiAgent).toBeDefined()
      expect(geminiAgent?.name).toBe('Gemini CLI')
    })

    it('should have correct command template for gemini-cli', () => {
      const builtins = helper.getBuiltins()
      const geminiAgent = builtins.find((agent) => agent.id === 'gemini-cli')

      expect(geminiAgent).toBeDefined()

      // Get the default profile
      const profile = geminiAgent?.profiles[0]
      expect(profile).toBeDefined()
      expect(profile?.command).toBe('gemini')
      expect(profile?.args).toEqual(['--experimental-acp'])
    })

    it('should return gemini-cli in correct order', () => {
      const builtins = helper.getBuiltins()
      const agentIds = builtins.map((agent) => agent.id)

      expect(agentIds).toContain('gemini-cli')

      // Verify gemini-cli is after opencode (as per BUILTIN_ORDER)
      const geminiIndex = agentIds.indexOf('gemini-cli')
      const opencodeIndex = agentIds.indexOf('opencode')

      expect(geminiIndex).toBeGreaterThan(opencodeIndex)
    })

    it('should have default profile with correct name', () => {
      const builtins = helper.getBuiltins()
      const geminiAgent = builtins.find((agent) => agent.id === 'gemini-cli')

      const profile = geminiAgent?.profiles[0]
      expect(profile?.name).toBe('Default')
    })
  })

  describe('Agent Enablement', () => {
    it('should enable gemini-cli agent', () => {
      const result = helper.setBuiltinEnabled('gemini-cli', true)

      const builtins = helper.getBuiltins()
      const geminiAgent = builtins.find((agent) => agent.id === 'gemini-cli')

      expect(geminiAgent?.enabled).toBe(true)
    })

    it('should disable gemini-cli agent', () => {
      // First enable it
      helper.setBuiltinEnabled('gemini-cli', true)

      // Then disable it
      helper.setBuiltinEnabled('gemini-cli', false)

      const builtins = helper.getBuiltins()
      const geminiAgent = builtins.find((agent) => agent.id === 'gemini-cli')

      expect(geminiAgent?.enabled).toBe(false)
    })

    it('should include gemini-cli in enabled agents when enabled', () => {
      helper.setGlobalEnabled(true)
      helper.setBuiltinEnabled('gemini-cli', true)

      const enabledAgents = helper.getEnabledAgents()
      const geminiAgent = enabledAgents.find((agent) => agent.id === 'gemini-cli')

      expect(geminiAgent).toBeDefined()
      expect(geminiAgent?.command).toBe('gemini')
      expect(geminiAgent?.args).toEqual(['--experimental-acp'])
    })

    it('should not include gemini-cli in enabled agents when disabled', () => {
      helper.setGlobalEnabled(true)
      helper.setBuiltinEnabled('gemini-cli', false)

      const enabledAgents = helper.getEnabledAgents()
      const geminiAgent = enabledAgents.find((agent) => agent.id === 'gemini-cli')

      expect(geminiAgent).toBeUndefined()
    })
  })

  describe('Profile Management', () => {
    it('should add custom profile to gemini-cli', () => {
      const customProfile = {
        name: 'Custom Profile',
        command: 'gemini',
        args: [],
        env: { GEMINI_API_KEY: 'test-key' }
      }

      const addedProfile = helper.addBuiltinProfile('gemini-cli', customProfile)

      expect(addedProfile).toBeDefined()
      expect(addedProfile.id).toBeDefined()
      expect(typeof addedProfile.id).toBe('string')

      const builtins = helper.getBuiltins()
      const geminiAgent = builtins.find((agent) => agent.id === 'gemini-cli')

      expect(geminiAgent?.profiles.length).toBeGreaterThan(1)

      const foundProfile = geminiAgent?.profiles.find((p) => p.id === addedProfile.id)
      expect(foundProfile?.name).toBe('Custom Profile')
      expect(foundProfile?.command).toBe('gemini')
      expect(foundProfile?.env).toEqual({ GEMINI_API_KEY: 'test-key' })
    })

    it('should set active profile for gemini-cli', () => {
      const customProfile = {
        name: 'Custom Profile',
        command: 'gemini',
        args: [],
        env: {}
      }

      const addedProfile = helper.addBuiltinProfile('gemini-cli', customProfile, {
        activate: false
      })
      helper.setBuiltinActiveProfile('gemini-cli', addedProfile.id)

      const builtins = helper.getBuiltins()
      const geminiAgent = builtins.find((agent) => agent.id === 'gemini-cli')

      expect(geminiAgent?.activeProfileId).toBe(addedProfile.id)
    })
  })

  describe('Type Safety', () => {
    it('should accept gemini-cli as valid AcpBuiltinAgentId', () => {
      // This test verifies TypeScript compilation
      const agentId: AcpBuiltinAgentId = 'gemini-cli'

      expect(agentId).toBe('gemini-cli')

      // Should not throw error
      helper.setBuiltinEnabled(agentId, true)
      const builtins = helper.getBuiltins()
      const geminiAgent = builtins.find((agent) => agent.id === agentId)
      expect(geminiAgent?.enabled).toBe(true)
    })
  })
})
