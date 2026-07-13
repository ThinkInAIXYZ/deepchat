import { describe, expectTypeOf, it } from 'vitest'
import type { ILlmProviderPresenter } from '@shared/presenter'
import type { ILlmProviderPresenter as CoreLlmProviderPresenter } from '@shared/types/presenters/core.presenter'
import type {
  AcpAsLlmProviderPermissionPort,
  AcpAsLlmProviderSessionControlPort,
  AcpProviderAdminPort
} from '@/presenter/runtimePorts'

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

type RetiredGenericAcpMethod = Extract<keyof ILlmProviderPresenter, RetiredAcpMethodName>
type RetiredCoreAcpMethod = Extract<keyof CoreLlmProviderPresenter, RetiredAcpMethodName>

describe('ACP provider ports', () => {
  it('keeps ACP runtime controls out of the generic provider presenter contract', () => {
    expectTypeOf<RetiredGenericAcpMethod>().toEqualTypeOf<never>()
    expectTypeOf<RetiredCoreAcpMethod>().toEqualTypeOf<never>()
  })

  it('keeps compatibility and admin capabilities on explicit ports', () => {
    expectTypeOf<AcpAsLlmProviderSessionControlPort>().toHaveProperty('setAcpWorkdir')
    expectTypeOf<AcpAsLlmProviderPermissionPort>().toHaveProperty('resolveAgentPermission')
    expectTypeOf<AcpProviderAdminPort>().toHaveProperty('runAcpDebugAction')
  })
})
