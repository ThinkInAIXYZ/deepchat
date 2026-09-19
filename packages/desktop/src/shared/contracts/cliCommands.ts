import {
  cliCapabilitiesRoute,
  cliDoctorRoute,
  cliStatusRoute,
  cliVersionRoute
} from './routes/cli.routes'
import {
  artifactsDeleteRoute,
  artifactsDescribeRoute,
  artifactsReadRoute
} from './routes/artifacts.routes'
import { audioTranscribeArtifactRoute, audioTranscribeUploadRoute } from './routes/audio.routes'
import {
  modelsGetPublicConfigRoute,
  modelsInvokeRoute,
  modelsListRuntimeRoute,
  modelsResetConfigRoute,
  modelsSetPublicConfigRoute,
  modelsSetStatusRoute
} from './routes/models.routes'
import {
  imagesGenerateRoute,
  speechGenerateRoute,
  videosGenerateRoute
} from './routes/media.routes'
import {
  mcpAddPublicRoute,
  mcpListPublicRoute,
  mcpRemovePublicRoute,
  mcpSetPublicStatusRoute,
  mcpStartPublicRoute,
  mcpStopPublicRoute,
  mcpUpdatePublicRoute
} from './routes/mcp.routes'
import {
  ocrClearCacheRoute,
  ocrExtractArtifactRoute,
  ocrExtractUploadRoute,
  ocrGetRuntimeStatusRoute
} from './routes/ocr.routes'
import {
  providersAddPublicRoute,
  providersListPublicRoute,
  providersRemoveRoute,
  providersSetCredentialRoute,
  providersTestPublicConnectionRoute,
  providersUpdatePublicRoute
} from './routes/providers.routes'
import {
  eventsSubscribeRoute,
  runsCancelRoute,
  runsGetRoute,
  sessionsRunDetachedRoute
} from './routes/runs.routes'
import { settingsGetPublicRoute, settingsUpdatePublicRoute } from './routes/settings.routes'
import {
  skillsInstallPublicUrlRoute,
  skillsInstallUploadRoute,
  skillsListPublicRoute,
  skillsSetPublicStatusRoute,
  skillsUninstallPublicRoute
} from './routes/skills.routes'
import {
  toolBatchRoute,
  toolCallRoute,
  toolDescribeRoute,
  toolSearchRoute
} from './routes/tools.routes'

export type CliRpcContract =
  | typeof cliStatusRoute
  | typeof cliVersionRoute
  | typeof cliCapabilitiesRoute
  | typeof cliDoctorRoute
  | typeof artifactsDescribeRoute
  | typeof artifactsReadRoute
  | typeof artifactsDeleteRoute
  | typeof modelsInvokeRoute
  | typeof imagesGenerateRoute
  | typeof videosGenerateRoute
  | typeof speechGenerateRoute
  | typeof audioTranscribeUploadRoute
  | typeof audioTranscribeArtifactRoute
  | typeof ocrGetRuntimeStatusRoute
  | typeof ocrExtractUploadRoute
  | typeof ocrExtractArtifactRoute
  | typeof ocrClearCacheRoute
  | typeof providersListPublicRoute
  | typeof providersTestPublicConnectionRoute
  | typeof providersAddPublicRoute
  | typeof providersUpdatePublicRoute
  | typeof providersSetCredentialRoute
  | typeof providersRemoveRoute
  | typeof modelsListRuntimeRoute
  | typeof modelsGetPublicConfigRoute
  | typeof modelsSetStatusRoute
  | typeof modelsSetPublicConfigRoute
  | typeof modelsResetConfigRoute
  | typeof settingsGetPublicRoute
  | typeof settingsUpdatePublicRoute
  | typeof skillsListPublicRoute
  | typeof skillsInstallPublicUrlRoute
  | typeof skillsInstallUploadRoute
  | typeof skillsSetPublicStatusRoute
  | typeof skillsUninstallPublicRoute
  | typeof mcpListPublicRoute
  | typeof mcpAddPublicRoute
  | typeof mcpUpdatePublicRoute
  | typeof mcpRemovePublicRoute
  | typeof mcpSetPublicStatusRoute
  | typeof mcpStartPublicRoute
  | typeof mcpStopPublicRoute
  | typeof sessionsRunDetachedRoute
  | typeof runsGetRoute
  | typeof runsCancelRoute
  | typeof eventsSubscribeRoute
  | typeof toolSearchRoute
  | typeof toolDescribeRoute
  | typeof toolCallRoute
  | typeof toolBatchRoute

export type CliCommandTimeoutClass = 'standard' | 'long-running' | 'approved-mutation'
export type CliAgentInvocation = 'deny' | 'allow' | Readonly<{ contract: CliRpcContract }>

export type CliCommandDefinition = Readonly<{
  domain: string
  verb: string
  contract: CliRpcContract
  timeoutClass: CliCommandTimeoutClass
  agentInvocation: CliAgentInvocation
}>

const standard = 'standard' as const
const longRunning = 'long-running' as const
const approvedMutation = 'approved-mutation' as const

export const CLI_COMMAND_DEFINITIONS = [
  {
    domain: 'system',
    verb: 'status',
    contract: cliStatusRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'system',
    verb: 'version',
    contract: cliVersionRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'system',
    verb: 'capabilities',
    contract: cliCapabilitiesRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'system',
    verb: 'doctor',
    contract: cliDoctorRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'artifact',
    verb: 'describe',
    contract: artifactsDescribeRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'artifact',
    verb: 'get',
    contract: artifactsReadRoute,
    timeoutClass: longRunning,
    agentInvocation: 'deny'
  },
  {
    domain: 'artifact',
    verb: 'delete',
    contract: artifactsDeleteRoute,
    timeoutClass: standard,
    agentInvocation: 'deny'
  },
  {
    domain: 'model',
    verb: 'invoke',
    contract: modelsInvokeRoute,
    timeoutClass: longRunning,
    agentInvocation: 'allow'
  },
  {
    domain: 'image',
    verb: 'generate',
    contract: imagesGenerateRoute,
    timeoutClass: longRunning,
    agentInvocation: 'allow'
  },
  {
    domain: 'video',
    verb: 'generate',
    contract: videosGenerateRoute,
    timeoutClass: longRunning,
    agentInvocation: 'allow'
  },
  {
    domain: 'audio',
    verb: 'speak',
    contract: speechGenerateRoute,
    timeoutClass: longRunning,
    agentInvocation: 'allow'
  },
  {
    domain: 'audio',
    verb: 'transcribe',
    contract: audioTranscribeUploadRoute,
    timeoutClass: longRunning,
    agentInvocation: { contract: audioTranscribeArtifactRoute }
  },
  {
    domain: 'ocr',
    verb: 'status',
    contract: ocrGetRuntimeStatusRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'ocr',
    verb: 'extract',
    contract: ocrExtractUploadRoute,
    timeoutClass: longRunning,
    agentInvocation: { contract: ocrExtractArtifactRoute }
  },
  {
    domain: 'ocr',
    verb: 'clear-cache',
    contract: ocrClearCacheRoute,
    timeoutClass: longRunning,
    agentInvocation: 'deny'
  },
  {
    domain: 'provider',
    verb: 'list',
    contract: providersListPublicRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'provider',
    verb: 'test',
    contract: providersTestPublicConnectionRoute,
    timeoutClass: standard,
    agentInvocation: 'deny'
  },
  {
    domain: 'provider',
    verb: 'add',
    contract: providersAddPublicRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'provider',
    verb: 'update',
    contract: providersUpdatePublicRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'provider',
    verb: 'set-credential',
    contract: providersSetCredentialRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'provider',
    verb: 'clear-credential',
    contract: providersSetCredentialRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'provider',
    verb: 'remove',
    contract: providersRemoveRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'model',
    verb: 'list',
    contract: modelsListRuntimeRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'model',
    verb: 'config-get',
    contract: modelsGetPublicConfigRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'model',
    verb: 'enable',
    contract: modelsSetStatusRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'model',
    verb: 'disable',
    contract: modelsSetStatusRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'model',
    verb: 'config-set',
    contract: modelsSetPublicConfigRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'model',
    verb: 'config-reset',
    contract: modelsResetConfigRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'settings',
    verb: 'get',
    contract: settingsGetPublicRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'settings',
    verb: 'set',
    contract: settingsUpdatePublicRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'allow'
  },
  {
    domain: 'skill',
    verb: 'list',
    contract: skillsListPublicRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'skill',
    verb: 'install',
    contract: skillsInstallPublicUrlRoute,
    timeoutClass: longRunning,
    agentInvocation: 'allow'
  },
  {
    domain: 'skill',
    verb: 'enable',
    contract: skillsSetPublicStatusRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'skill',
    verb: 'disable',
    contract: skillsSetPublicStatusRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'skill',
    verb: 'remove',
    contract: skillsUninstallPublicRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'mcp',
    verb: 'list',
    contract: mcpListPublicRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'mcp',
    verb: 'add',
    contract: mcpAddPublicRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'allow'
  },
  {
    domain: 'mcp',
    verb: 'update',
    contract: mcpUpdatePublicRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'mcp',
    verb: 'enable',
    contract: mcpSetPublicStatusRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'mcp',
    verb: 'disable',
    contract: mcpSetPublicStatusRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'mcp',
    verb: 'start',
    contract: mcpStartPublicRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'mcp',
    verb: 'stop',
    contract: mcpStopPublicRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'mcp',
    verb: 'remove',
    contract: mcpRemovePublicRoute,
    timeoutClass: approvedMutation,
    agentInvocation: 'deny'
  },
  {
    domain: 'agent',
    verb: 'run',
    contract: sessionsRunDetachedRoute,
    timeoutClass: longRunning,
    agentInvocation: 'deny'
  },
  {
    domain: 'run',
    verb: 'get',
    contract: runsGetRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'run',
    verb: 'watch',
    contract: eventsSubscribeRoute,
    timeoutClass: longRunning,
    agentInvocation: 'deny'
  },
  {
    domain: 'run',
    verb: 'cancel',
    contract: runsCancelRoute,
    timeoutClass: standard,
    agentInvocation: 'allow'
  },
  {
    domain: 'tool',
    verb: 'search',
    contract: toolSearchRoute,
    timeoutClass: standard,
    agentInvocation: 'deny'
  },
  {
    domain: 'tool',
    verb: 'describe',
    contract: toolDescribeRoute,
    timeoutClass: standard,
    agentInvocation: 'deny'
  },
  {
    domain: 'tool',
    verb: 'call',
    contract: toolCallRoute,
    timeoutClass: longRunning,
    agentInvocation: 'deny'
  },
  {
    domain: 'tool',
    verb: 'batch',
    contract: toolBatchRoute,
    timeoutClass: longRunning,
    agentInvocation: 'deny'
  }
] as const satisfies readonly CliCommandDefinition[]

export function cliCommandKey(domain: string, verb: string): string {
  return `${domain} ${verb}`
}

function createCliCommandRegistry(
  definitions: readonly CliCommandDefinition[]
): ReadonlyMap<string, CliCommandDefinition> {
  const registry = new Map<string, CliCommandDefinition>()
  for (const definition of definitions) {
    const key = cliCommandKey(definition.domain, definition.verb)
    if (registry.has(key)) throw new Error(`Duplicate CLI command definition: ${key}`)
    registry.set(key, definition)
  }
  return registry
}

export const CLI_COMMAND_REGISTRY = createCliCommandRegistry(CLI_COMMAND_DEFINITIONS)

export function getCliCommandDefinition(
  domain: string,
  verb: string
): CliCommandDefinition | undefined {
  return CLI_COMMAND_REGISTRY.get(cliCommandKey(domain, verb))
}

export function getAgentCliCommandContract(
  definition: CliCommandDefinition
): CliRpcContract | undefined {
  if (definition.agentInvocation === 'deny') return undefined
  if (definition.agentInvocation === 'allow') return definition.contract
  return definition.agentInvocation.contract
}
