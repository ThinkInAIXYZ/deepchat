import { describe, it, expect } from 'vitest'
import { buildClientCapabilities } from '@/presenter/agentPresenter/acp'

describe('AcpCapabilities', () => {
  describe('buildClientCapabilities', () => {
    it('enables fs and terminal by default', () => {
      const caps = buildClientCapabilities()

      expect(caps.fs).toEqual({
        readTextFile: true,
        writeTextFile: true
      })
      expect(caps.terminal).toBe(true)
    })

    it('allows disabling fs capabilities', () => {
      const caps = buildClientCapabilities({ enableFs: false })

      expect(caps.fs).toBeUndefined()
      expect(caps.terminal).toBe(true)
    })

    it('allows disabling terminal capabilities', () => {
      const caps = buildClientCapabilities({ enableTerminal: false })

      expect(caps.fs).toEqual({
        readTextFile: true,
        writeTextFile: true
      })
      expect(caps.terminal).toBeUndefined()
    })

    it('allows disabling all capabilities', () => {
      const caps = buildClientCapabilities({
        enableFs: false,
        enableTerminal: false
      })

      expect(caps.fs).toBeUndefined()
      expect(caps.terminal).toBeUndefined()
    })
  })
})
