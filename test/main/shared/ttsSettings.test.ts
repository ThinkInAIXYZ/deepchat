import { describe, expect, it } from 'vitest'
import { isChatAudioTtsModel, isTtsModelId } from '@shared/ttsSettings'

describe('TTS model helpers', () => {
  it('classifies only MiMo TTS variants as chat-audio TTS models', () => {
    expect(isChatAudioTtsModel('mimo-v2.5-tts')).toBe(true)
    expect(isChatAudioTtsModel('xiaomi-mimo-v2.5-tts-preview')).toBe(true)
    expect(isChatAudioTtsModel('xiaomimimo/mimo-v2.5-tts')).toBe(true)

    expect(isChatAudioTtsModel('mimo-v2.5-pro')).toBe(false)
    expect(isChatAudioTtsModel('xiaomimimo/mimo-v2.5-pro')).toBe(false)
    expect(isTtsModelId('mimo-v2.5-pro')).toBe(false)
  })
})
