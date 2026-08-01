import { WORKFLOW_RUNTIME_API_VERSION } from './runtimeProtocol'

export const WORKFLOW_AUTHORING_API_VERSION = WORKFLOW_RUNTIME_API_VERSION

export const WORKFLOW_AUTHORING_HELPERS = Object.freeze({
  agent: {
    minArgs: 2,
    maxArgs: 2,
    signature:
      'agent(prompt, { key, label?, phase?, agentId?, schema?, timeoutMs?, maxOutputBytes? })'
  },
  parallel: {
    minArgs: 2,
    maxArgs: 2,
    signature: 'parallel(key, [{ key, run(api) }, ...])'
  },
  pipeline: {
    minArgs: 3,
    maxArgs: 3,
    signature: 'pipeline(key, [{ key, value }, ...], [{ key, run(value, api, item) }, ...])'
  },
  mapLimit: {
    minArgs: 4,
    maxArgs: 4,
    signature: 'mapLimit(key, [{ key, value }, ...], limit, (value, api, item) => result)'
  },
  phase: {
    minArgs: 1,
    maxArgs: 2,
    signature: 'phase(key, { label?, detail? }?)'
  },
  log: {
    minArgs: 1,
    maxArgs: 1,
    signature: 'log(jsonValue)'
  }
} as const)

export type WorkflowAuthoringHelperName = keyof typeof WORKFLOW_AUTHORING_HELPERS

export const WORKFLOW_AUTHORING_GUIDE = [
  `DeepChat Workflow JavaScript API v${WORKFLOW_AUTHORING_API_VERSION}. Use top-level await and return bounded JSON.`,
  ...Object.values(WORKFLOW_AUTHORING_HELPERS).map(({ signature }) => `- ${signature}`),
  '- Every agent, group, item, task, and stage requires a stable non-empty key.',
  '- Launch input is available to the script as the top-level input value.',
  '- Use the scoped api argument inside parallel, pipeline, and mapLimit callbacks.',
  '- Promise.all and Promise.allSettled are available; timers, Promise.race, and Promise.any are not.',
  'Minimal parallel example:',
  "return await parallel('review', [",
  "  { key: 'architecture', run: (api) => api.agent('Review architecture', { key: 'worker' }) },",
  "  { key: 'tests', run: (api) => api.agent('Review tests', { key: 'worker' }) }",
  '])'
].join('\n')

export function isWorkflowAuthoringHelperName(
  value: string | null
): value is WorkflowAuthoringHelperName {
  return value !== null && Object.hasOwn(WORKFLOW_AUTHORING_HELPERS, value)
}
