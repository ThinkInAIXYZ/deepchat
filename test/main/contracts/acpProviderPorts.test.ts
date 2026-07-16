import { describe, expectTypeOf, it } from 'vitest'
import type { ProviderRuntimePort } from '@shared/types/provider'
import type {
  AcpAsLlmProviderPermissionPort,
  AcpAsLlmProviderSessionControlPort,
  AcpProviderAdminPort
} from '@/provider/ports'

type RetiredAcpMethodName =
  | 'prepareAcpSession'
  | 'getAcpWorkdir'
  | 'setAcpWorkdir'
  | 'clearAcpSession'
  | 'getAcpProcessModes'
  | 'setAcpPreferredProcessMode'
  | 'setAcpSessionMode'
  | 'getAcpSessionModes'
  | 'getAcpSessionCommands'
  | 'getAcpSessionConfigOptions'
  | 'setAcpSessionConfigOption'
  | 'resolveAgentPermission'
  | 'warmupAcpProcess'
  | 'getAcpProcessConfigOptions'
  | 'runAcpDebugAction'

type RetiredGenericAcpMethod = Extract<keyof ProviderRuntimePort, RetiredAcpMethodName>

describe('ACP provider ports', () => {
  it('keeps ACP runtime controls out of the generic provider presenter contract', () => {
    expectTypeOf<RetiredGenericAcpMethod>().toEqualTypeOf<never>()
  })

  it('keeps compatibility and admin capabilities on explicit ports', () => {
    expectTypeOf<AcpAsLlmProviderSessionControlPort>().toHaveProperty('setAcpWorkdir')
    expectTypeOf<AcpAsLlmProviderPermissionPort>().toHaveProperty('resolveAgentPermission')
    expectTypeOf<AcpProviderAdminPort>().toHaveProperty('runAcpDebugAction')
  })
})
