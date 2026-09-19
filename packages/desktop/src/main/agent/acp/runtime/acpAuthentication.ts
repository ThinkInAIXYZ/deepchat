import type { AcpAuthChallenge, AcpAuthMethodView } from '@shared/types/acp'
import type * as schema from '@agentclientprotocol/sdk/dist/schema/index.js'

export const ACP_AUTH_REQUIRED_CODE = -32000

export function isAcpAuthRequiredRpcError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === ACP_AUTH_REQUIRED_CODE
  )
}

export function normalizeAcpAuthMethod(method: schema.AuthMethod): AcpAuthMethodView {
  const type = 'type' in method ? method.type : 'agent'
  return {
    id: method.id,
    name: method.name,
    ...(method.description ? { description: method.description } : {}),
    type: type === 'agent' || type === 'terminal' ? type : 'unsupported'
  }
}

export class AcpAuthenticationRequiredError extends Error {
  readonly code = ACP_AUTH_REQUIRED_CODE

  constructor(readonly challenge: AcpAuthChallenge) {
    super(`Authentication required for ACP agent ${challenge.agentId}`)
    this.name = 'AcpAuthenticationRequiredError'
  }
}

export function isAcpAuthenticationRequiredError(
  error: unknown
): error is AcpAuthenticationRequiredError {
  return error instanceof AcpAuthenticationRequiredError
}
