import { describe, expect, it } from 'vitest'
import {
  MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE,
  MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE,
  getMoonshotKimiTemperaturePolicy,
  resolveMoonshotKimiTemperaturePolicy
} from '../../../src/shared/moonshotKimiPolicy'

describe('moonshot Kimi temperature policy', () => {
  it('locks Kimi For Coding fixed-thinking model temperature', () => {
    expect(getMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-for-coding')).toMatchObject({
      modelId: 'kimi-for-coding',
      baseModelId: 'kimi-for-coding',
      lockTemperatureControl: true
    })

    expect(
      resolveMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-for-coding', true)
    ).toEqual(
      expect.objectContaining({
        reasoningEnabled: true,
        temperature: MOONSHOT_KIMI_THINKING_ENABLED_TEMPERATURE,
        thinkingType: 'enabled'
      })
    )

    expect(
      resolveMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-for-coding', false)
    ).toEqual(
      expect.objectContaining({
        reasoningEnabled: false,
        temperature: MOONSHOT_KIMI_THINKING_DISABLED_TEMPERATURE,
        thinkingType: 'disabled'
      })
    )
  })

  it('locks Kimi Code K2.7 model aliases', () => {
    expect(getMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-k2.7-code')).toMatchObject({
      baseModelId: 'kimi-k2.7-code'
    })
    expect(
      getMoonshotKimiTemperaturePolicy('kimi-for-coding', 'kimi-k2.7-code-highspeed')
    ).toMatchObject({
      baseModelId: 'kimi-k2.7-code-highspeed'
    })
  })
})
