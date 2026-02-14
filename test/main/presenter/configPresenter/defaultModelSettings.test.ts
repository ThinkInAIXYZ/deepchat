import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('ConfigPresenter defaultModel settings', () => {
  let mockGetSetting: ReturnType<typeof vi.fn>
  let mockSetSetting: ReturnType<typeof vi.fn>
  let configPresenterProxy: {
    getSetting: ReturnType<typeof vi.fn>
    setSetting: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSetting = vi.fn()
    mockSetSetting = vi.fn()
    configPresenterProxy = {
      getSetting: mockGetSetting,
      setSetting: mockSetSetting
    }
  })

  describe('getDefaultModel', () => {
    it('returns undefined when no default model is set', () => {
      mockGetSetting.mockReturnValue(undefined)
      const result = configPresenterProxy.getSetting('defaultModel')
      expect(result).toBeUndefined()
    })

    it('returns the default model when set', () => {
      const defaultModel = { providerId: 'openai', modelId: 'gpt-4o' }
      mockGetSetting.mockReturnValue(defaultModel)
      const result = configPresenterProxy.getSetting('defaultModel')
      expect(result).toEqual(defaultModel)
    })
  })

  describe('setDefaultModel', () => {
    it('sets the default model', () => {
      const defaultModel = { providerId: 'anthropic', modelId: 'claude-3-5-sonnet-20241022' }
      configPresenterProxy.setSetting('defaultModel', defaultModel)
      expect(mockSetSetting).toHaveBeenCalledWith('defaultModel', defaultModel)
    })

    it('clears the default model when set to undefined', () => {
      configPresenterProxy.setSetting('defaultModel', undefined)
      expect(mockSetSetting).toHaveBeenCalledWith('defaultModel', undefined)
    })
  })

  describe('getDefaultVisionModel', () => {
    it('returns undefined when no default vision model is set', () => {
      mockGetSetting.mockReturnValue(undefined)
      const result = configPresenterProxy.getSetting('defaultVisionModel')
      expect(result).toBeUndefined()
    })

    it('returns the default vision model when set', () => {
      const defaultVisionModel = { providerId: 'openai', modelId: 'gpt-4o' }
      mockGetSetting.mockReturnValue(defaultVisionModel)
      const result = configPresenterProxy.getSetting('defaultVisionModel')
      expect(result).toEqual(defaultVisionModel)
    })
  })

  describe('setDefaultVisionModel', () => {
    it('sets the default vision model', () => {
      const defaultVisionModel = { providerId: 'google', modelId: 'gemini-2.0-flash' }
      configPresenterProxy.setSetting('defaultVisionModel', defaultVisionModel)
      expect(mockSetSetting).toHaveBeenCalledWith('defaultVisionModel', defaultVisionModel)
    })
  })
})
