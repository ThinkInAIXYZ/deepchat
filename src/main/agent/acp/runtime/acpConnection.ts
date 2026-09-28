import type { ClientApp, Stream } from '@agentclientprotocol/sdk'
import type * as schema from '@agentclientprotocol/sdk'
import type { AcpLegacyModelState } from './acpConfigState'

export type AcpSetSessionModelRequest = { sessionId: string; modelId: string }
export type AcpSetSessionModelResponse = Record<string, unknown>

// Preserve the runtime's method surface while the SDK owns dispatch and cancellation.
export function connectAcpClient(app: ClientApp, stream: Stream) {
  const connection = app.connect(stream)
  const agent = connection.agent
  type WithLegacyModels<T> = T & { models?: AcpLegacyModelState | null }
  return {
    signal: connection.signal,
    closed: connection.closed,
    close: (error?: unknown) => connection.close(error),
    request: agent.request.bind(agent) as typeof agent.request,
    initialize: (params: schema.InitializeRequest) => agent.request('initialize', params),
    authenticate: (params: schema.AuthenticateRequest) => agent.request('authenticate', params),
    newSession: (params: schema.NewSessionRequest) =>
      agent.request('session/new', params) as Promise<WithLegacyModels<schema.NewSessionResponse>>,
    loadSession: (params: schema.LoadSessionRequest) =>
      agent.request('session/load', params) as Promise<
        WithLegacyModels<schema.LoadSessionResponse>
      >,
    resumeSession: (params: schema.ResumeSessionRequest) =>
      agent.request('session/resume', params) as Promise<
        WithLegacyModels<schema.ResumeSessionResponse>
      >,
    closeSession: (params: schema.CloseSessionRequest) => agent.request('session/close', params),
    unstable_forkSession: (params: schema.ForkSessionRequest) =>
      agent.request('session/fork', params),
    listSessions: (params: schema.ListSessionsRequest) => agent.request('session/list', params),
    prompt: (params: schema.PromptRequest) => agent.request('session/prompt', params),
    cancel: (params: schema.CancelNotification) => agent.notify('session/cancel', params),
    setSessionMode: (params: schema.SetSessionModeRequest) =>
      agent.request('session/set_mode', params),
    setSessionConfigOption: (params: schema.SetSessionConfigOptionRequest) =>
      agent.request('session/set_config_option', params),
    // Pre-config-option agents still use this removed experimental method.
    unstable_setSessionModel: (params: AcpSetSessionModelRequest) =>
      agent.request<AcpSetSessionModelResponse>('session/set_model', params),
    extMethod: (method: string, params: Record<string, unknown>) =>
      agent.request<Record<string, unknown>>(
        method.startsWith('_') ? method : `_${method}`,
        params
      ),
    extNotification: (method: string, params: Record<string, unknown>) =>
      agent.notify(method.startsWith('_') ? method : `_${method}`, params)
  }
}

export type AcpConnection = ReturnType<typeof connectAcpClient>
