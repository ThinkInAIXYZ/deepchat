import { TOOL_EXECUTION, type MCPToolDefinition } from '@shared/types/mcp'
import { formatCommandShellForModel, type ResolvedCommandShell } from '@shared/commandShell'
import { CODE_MODE_TOOL_SERVER_NAME } from '@shared/codeModeProtocol'
import { LIVE_DELEGATION_AGENT_TOOL_NAME } from '@shared/agentTools'
import { UPDATE_PLAN_TOOL_NAME } from '@shared/types/agent-plan'
import { QUESTION_TOOL_NAME } from '../agentTools/questionTool'

export const RUN_CODE_TOOL_NAME = 'run_code'
export const CODE_MODE_EXEC_TOOL_NAME = 'exec'
export const CODE_MODE_WAIT_TOOL_NAME = 'wait'
export const APPLY_PATCH_TOOL_NAME = 'apply_patch'
export const STR_REPLACE_EDITOR_TOOL_NAME = 'str_replace_editor'

const CODE_MODE_DIRECT_TOOL_NAMES = new Set([QUESTION_TOOL_NAME, LIVE_DELEGATION_AGENT_TOOL_NAME])

export function isCodeModeDirectToolName(name: string): boolean {
  return CODE_MODE_DIRECT_TOOL_NAMES.has(name)
}

export function filterCodeModeExecutionCatalog(
  executionCatalog: readonly MCPToolDefinition[]
): MCPToolDefinition[] {
  return executionCatalog.flatMap((tool) => {
    const name = tool.function.name.trim()
    if (isCodeModeDirectToolName(name)) return []
    if (name === tool.function.name) return [tool]
    return [{ ...tool, function: { ...tool.function, name } }]
  })
}

function renderCodeModeToolBoundary(
  frontend: 'codex' | 'function',
  executionCatalog: readonly MCPToolDefinition[]
): string {
  const directToolNames = executionCatalog
    .map((tool) => tool.function.name.trim())
    .filter(isCodeModeDirectToolName)
    .sort((left, right) => left.localeCompare(right))
  const topLevelToolNames = [
    ...(frontend === 'codex'
      ? [CODE_MODE_EXEC_TOOL_NAME, CODE_MODE_WAIT_TOOL_NAME]
      : [RUN_CODE_TOOL_NAME]),
    ...directToolNames
  ]

  return [
    '## Code Mode Tool Boundary',
    `Top-level tools for this turn: ${topLevelToolNames.map((name) => `\`${name}\``).join(', ')}.`,
    'Every other enabled tool is a Code Mode subtool. Subtools are available only inside the code entrypoint through `await tools.name(args)` and must never be issued as top-level tool calls.'
  ].join('\n')
}

function renderCodeModeProgressPrompt(executionCatalog: readonly MCPToolDefinition[]): string {
  if (!executionCatalog.some((tool) => tool.function.name.trim() === UPDATE_PLAN_TOOL_NAME)) {
    return ''
  }

  return [
    '## Progress Checklist in Code Mode',
    `Use the \`${UPDATE_PLAN_TOOL_NAME}\` subtool for non-trivial multi-step tasks by calling \`await tools.${UPDATE_PLAN_TOOL_NAME}(args)\` inside the code entrypoint.`,
    'Each call must provide the complete current checklist snapshot with at most one step in_progress.',
    'Keep the checklist current as work progresses and reconcile it before ending the turn.'
  ].join('\n')
}

const RUN_CODE_DESCRIPTION =
  'Execute a TypeScript program against Code Mode subtools. `run_code` is the only code entrypoint; call any separately exposed top-level tools directly and never call a subtool directly. Takes two required arguments: `code`, the BODY of an async function (erasable syntax only; top-level `await` and `return` work), and `description`, a short summary of what the program does. Invoke subtools only inside `code` as `await tools.name(args)` per the declarations in the system prompt. Only what you print or return comes back — curate it.'

const RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION =
  'Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: "Count TODO markers across packages"; "Read failing test and its fixture"; "Rename config key in every cordis.yml".'

const CODE_MODE_EXEC_DESCRIPTION = `Run JavaScript code to orchestrate/compose tool calls
- Evaluates the provided JavaScript code in a fresh V8 isolate as an async module.
- Invoke SDK-declared subtools only inside this program on the global \`tools\` object through \`await tools.name(args)\`. Subtool names are exposed as normalized JavaScript identifiers, for example \`await tools.mcp__ologs__get_profile(...)\`.
- Subtool methods take either a string or an object as their input argument.
- Subtools return either an object or a string, based on the description.
- Runs raw JavaScript -- no Node, no file system, no network access, no console.
- Accepts raw JavaScript source text, not JSON, quoted strings, or markdown code fences.
- You may optionally start the tool input with a first-line pragma like \`// @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}\`.
- \`yield_time_ms\` asks \`exec\` to yield early if the script is still running. Defaults to 10000 ms.
- \`max_output_tokens\` sets the token budget for direct \`exec\` results. Defaults to 10000 tokens.
- When the JS code is fully evaluated, the isolate's lifetime ends and unawaited promises are silently discarded.

- Global helpers:
- \`exit()\`: Immediately ends the current script successfully (like an early return from the top level).
- \`text(value: string | number | boolean | undefined | null)\`: Appends a text item. Non-string values are stringified with \`JSON.stringify(...)\` when possible.
- \`image(imageUrlOrItem: string | { image_url: string } | ImageContent)\`: Appends an image item. \`image_url\` should be a base64-encoded \`data:\` URL. To forward an MCP tool image, pass an individual \`ImageContent\` block from \`result.content\`, for example \`image(result.content[0])\`.
- \`audio(audioUrlOrItem: string | { audio_url: string } | AudioContent)\`: Appends an audio item. \`audio_url\` should be a base64-encoded \`data:\` URL. To forward an MCP tool audio block, pass an individual \`AudioContent\` block from \`result.content\`, for example \`audio(result.content[0])\`.
- \`generatedImage(result: { image_url: string; output_hint?: string })\`: Appends an image-generation result and its optional output hint. HTTP(S) URLs are not supported.
- \`store(key: string, value: any)\`: stores a serializable value under a string key for later \`exec\` calls in the same session.
- \`load(key: string)\`: returns the stored value for a key, or \`undefined\` if it is missing.
- \`notify(value: string | number | boolean | undefined | null)\`: immediately injects an extra \`custom_tool_call_output\` for the current \`exec\` call. Values are stringified like \`text(...)\`.
- \`setTimeout(callback: () => void, delayMs?: number)\`: schedules a callback to run later and returns a timeout id. Pending timeouts do not keep \`exec\` alive by themselves; await an explicit promise if you need to wait for one.
- \`clearTimeout(timeoutId?: number)\`: cancels a timeout created by \`setTimeout\`.
- \`ALL_TOOLS\`: metadata for the enabled subtools as \`{ name, description }\` entries.
- \`yield_control()\`: yields the accumulated output to the model immediately while the script keeps running.`

const CODE_MODE_WAIT_DESCRIPTION = `Waits on a yielded \`exec\` cell and returns new output or completion.
- Use \`wait\` only after \`exec\` returns \`Script running with cell ID ...\`.
- \`cell_id\` identifies the running \`exec\` cell to resume.
- \`yield_time_ms\` controls how long to wait for more output before yielding again. Defaults to 10000 ms.
- \`max_tokens\` limits how much new output this wait call returns. Defaults to 10000 tokens.
- \`terminate: true\` stops the running cell; false or omitted waits for output.
- \`wait\` returns only the new output since the last yield, or the final completion or termination result for that cell.
- If the cell is still running, \`wait\` may yield again with the same \`cell_id\`.
- If the cell has already finished, \`wait\` returns the completed result and closes the cell.`

const APPLY_PATCH_DESCRIPTION =
  'The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON. If a multi-operation patch reports a partial failure, re-view every affected file before retrying.'

const APPLY_PATCH_LARK_GRAMMAR = String.raw`start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF`

const CODE_MODE_EXEC_LARK_GRAMMAR = String.raw`start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`

const STR_REPLACE_EDITOR_DESCRIPTION = `Custom editing tool for viewing, creating and editing files
* State is persistent across command calls and discussions with the user
* If \`path\` is a file, \`view\` displays the result of applying \`cat -n\`. If \`path\` is a directory, \`view\` lists non-hidden files and directories up to 2 levels deep
* The \`create\` command cannot be used if the specified \`path\` already exists as a file
* If a \`command\` generates a long output, it will be truncated and marked with \`<response clipped>\`

Notes for using the \`str_replace\` command:
* The \`old_str\` parameter should match EXACTLY one or more consecutive lines from the original file. Be mindful of whitespaces!
* If the \`old_str\` parameter is not unique in the file, the replacement will not be performed. Make sure to include enough context in \`old_str\` to make it unique
* The \`new_str\` parameter should contain the edited lines that should replace the \`old_str\``

export function isCodexToolFrontend(providerId: string): boolean {
  return providerId.trim().toLowerCase() === 'openai-codex'
}

export function decorateExecForShell(
  definition: MCPToolDefinition,
  shell: ResolvedCommandShell
): MCPToolDefinition {
  if (definition.function.name !== 'exec') return definition
  return {
    ...definition,
    function: {
      ...definition.function,
      description: `${definition.function.description}\n\n${formatCommandShellForModel(shell)}`
    }
  }
}

export function createRunCodeToolDefinition(): MCPToolDefinition {
  return {
    execution: TOOL_EXECUTION.write,
    source: 'agent',
    type: 'function',
    providerPresentation: { type: 'function' },
    function: {
      name: RUN_CODE_TOOL_NAME,
      description: RUN_CODE_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The program: the body of an async TypeScript function.'
          },
          description: {
            type: 'string',
            description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
          }
        },
        required: ['code', 'description']
      }
    },
    server: {
      name: CODE_MODE_TOOL_SERVER_NAME,
      icons: '⌘',
      description: 'Code Mode runtime'
    }
  }
}

export function createCodexCodeModeToolDefinitions(
  executionCatalog: readonly MCPToolDefinition[]
): MCPToolDefinition[] {
  const nestedReference = renderCodexNestedToolReference(executionCatalog)
  const toolBoundary = renderCodeModeToolBoundary('codex', executionCatalog)
  const progressPrompt = renderCodeModeProgressPrompt(executionCatalog)
  return [
    {
      execution: TOOL_EXECUTION.write,
      source: 'agent',
      type: 'custom',
      providerPresentation: {
        type: 'freeform',
        format: { type: 'grammar', syntax: 'lark', definition: CODE_MODE_EXEC_LARK_GRAMMAR }
      },
      function: {
        name: CODE_MODE_EXEC_TOOL_NAME,
        description: [CODE_MODE_EXEC_DESCRIPTION, toolBoundary, progressPrompt, nestedReference]
          .filter(Boolean)
          .join('\n\n'),
        parameters: { type: 'object', properties: {} }
      },
      server: {
        name: CODE_MODE_TOOL_SERVER_NAME,
        icons: '⌘',
        description: 'Code Mode runtime'
      }
    },
    {
      execution: TOOL_EXECUTION.write,
      source: 'agent',
      type: 'function',
      function: {
        name: CODE_MODE_WAIT_TOOL_NAME,
        description: CODE_MODE_WAIT_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            cell_id: { type: 'string', description: 'Identifier of the running exec cell.' },
            yield_time_ms: {
              type: 'number',
              description: 'Wait before yielding more output. Defaults to 10000 ms.'
            },
            max_tokens: {
              type: 'number',
              description: 'Output token budget for this wait call. Defaults to 10000 tokens.'
            },
            terminate: {
              type: 'boolean',
              description: 'True stops the running exec cell; false or omitted waits for output.'
            }
          },
          required: ['cell_id']
        }
      },
      server: {
        name: CODE_MODE_TOOL_SERVER_NAME,
        icons: '⌛',
        description: 'Code Mode runtime'
      }
    }
  ]
}

export function createApplyPatchToolDefinition(): MCPToolDefinition {
  return {
    execution: TOOL_EXECUTION.write,
    source: 'agent',
    type: 'custom',
    providerPresentation: {
      type: 'freeform',
      format: { type: 'grammar', syntax: 'lark', definition: APPLY_PATCH_LARK_GRAMMAR }
    },
    function: {
      name: APPLY_PATCH_TOOL_NAME,
      description: APPLY_PATCH_DESCRIPTION,
      parameters: { type: 'object', properties: {} }
    },
    server: {
      name: 'agent-filesystem',
      icons: '📁',
      description: 'Agent FileSystem tools'
    }
  }
}

export function createStrReplaceEditorToolDefinition(): MCPToolDefinition {
  return {
    execution: TOOL_EXECUTION.write,
    source: 'agent',
    type: 'function',
    providerPresentation: { type: 'function' },
    function: {
      name: STR_REPLACE_EDITOR_TOOL_NAME,
      description: STR_REPLACE_EDITOR_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              'The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.',
            enum: ['view', 'create', 'str_replace', 'insert']
          },
          path: {
            type: 'string',
            description: 'Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`.'
          },
          file_text: {
            type: 'string',
            description:
              'Required parameter of `create` command, with the content of the file to be created.'
          },
          insert_line: {
            type: 'integer',
            description:
              'Required parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`.'
          },
          new_str: {
            type: 'string',
            description:
              'Optional parameter of `str_replace` command containing the new string (if not given, no string will be added). Required parameter of `insert` command containing the string to insert.'
          },
          old_str: {
            type: 'string',
            description:
              'Required parameter of `str_replace` command containing the string in `path` to replace.'
          },
          view_range: {
            type: 'array',
            description:
              'Optional parameter of `view` command when `path` points to a file. If none is given, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file.',
            items: { type: 'integer' }
          }
        },
        required: ['command', 'path']
      }
    },
    server: {
      name: 'agent-filesystem',
      icons: '📁',
      description: 'Agent FileSystem tools'
    }
  }
}

function renderTsType(schema: unknown): string {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'unknown'
  const value = schema as Record<string, unknown>
  if (Array.isArray(value.enum)) {
    return value.enum.map((item) => JSON.stringify(item)).join(' | ') || 'unknown'
  }
  if (Array.isArray(value.anyOf)) {
    return value.anyOf.map(renderTsType).join(' | ')
  }
  switch (value.type) {
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return `Array<${renderTsType(value.items)}>`
    case 'object': {
      const properties =
        value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)
          ? (value.properties as Record<string, unknown>)
          : {}
      const required = new Set(Array.isArray(value.required) ? value.required : [])
      const members = Object.entries(properties).map(
        ([name, property]) =>
          `${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${renderTsType(property)}`
      )
      return members.length > 0 ? `{ ${members.join('; ')} }` : 'Record<string, unknown>'
    }
    default:
      return 'unknown'
  }
}

function renderKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}

export function normalizeCodexToolName(name: string): string {
  const normalized = [...name]
    .map((character, index) => {
      const valid =
        character === '_' ||
        character === '$' ||
        (index === 0 ? /[A-Za-z]/.test(character) : /[A-Za-z0-9]/.test(character))
      return valid ? character : '_'
    })
    .join('')
  return normalized || '_'
}

function renderToolDescriptionComment(description: string, indent = ''): string[] {
  const collapsed = description
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll('*/', String.raw`*\/`)
  return collapsed ? [`${indent}/** ${collapsed} */`] : []
}

function renderCodexNestedToolReference(executionCatalog: readonly MCPToolDefinition[]): string {
  return filterCodeModeExecutionCatalog(executionCatalog)
    .sort((left, right) => left.function.name.localeCompare(right.function.name))
    .map((tool) => {
      const rawName = tool.function.name
      const name = normalizeCodexToolName(rawName)
      const inputName = tool.providerPresentation?.type === 'freeform' ? 'input' : 'args'
      const inputType =
        tool.providerPresentation?.type === 'freeform'
          ? 'string'
          : renderTsType(tool.raw?.inputSchema ?? tool.function.parameters)
      const outputType = renderTsType(tool.raw?.outputSchema)
      const heading = name === rawName ? `### \`${name}\`` : `### \`${name}\` (\`${rawName}\`)`
      return `${heading}\n${tool.function.description}\n\nexec subtool declaration:\n\`\`\`ts\ndeclare const tools: { ${name}(${inputName}: ${inputType}): Promise<${outputType}>; };\n\`\`\``
    })
    .join('\n\n')
}

export function renderCodeModeSdk(
  frontend: 'codex' | 'function',
  executionCatalog: readonly MCPToolDefinition[]
): string {
  const toolBoundary = renderCodeModeToolBoundary(frontend, executionCatalog)
  const tools = filterCodeModeExecutionCatalog(executionCatalog).sort((left, right) =>
    left.function.name.localeCompare(right.function.name)
  )
  const progressPrompt = renderCodeModeProgressPrompt(tools)
  const argumentMembers = tools.map((tool) => {
    return [
      ...renderToolDescriptionComment(tool.function.description, '  '),
      `  ${renderKey(tool.function.name)}: ${renderTsType(tool.raw?.inputSchema ?? tool.function.parameters)};`
    ].join('\n')
  })
  const outputMembers = tools.map(
    (tool) => `  ${renderKey(tool.function.name)}: ${renderTsType(tool.raw?.outputSchema)};`
  )
  const harnessDeclaration = [
    `interface SubtoolArgsMap {${argumentMembers.length > 0 ? `\n${argumentMembers.join('\n')}\n` : ''}}`,
    `interface SubtoolOutputMap {${outputMembers.length > 0 ? `\n${outputMembers.join('\n')}\n` : ''}}`,
    'type SubtoolName = keyof SubtoolOutputMap',
    [
      'declare class ToolCallError extends Error {',
      '  readonly name: "ToolCallError";',
      '  readonly toolName: SubtoolName;',
      '}'
    ].join('\n'),
    [
      'declare const tools: {',
      '  [K in SubtoolName]: (args: SubtoolArgsMap[K]) => Promise<SubtoolOutputMap[K]>;',
      '}'
    ].join('\n')
  ].join('\n\n')
  const codexMembers = tools.map((tool) =>
    [
      ...renderToolDescriptionComment(tool.function.description, '  '),
      `  ${normalizeCodexToolName(tool.function.name)}: (args: ${renderTsType(tool.function.parameters)}) => Promise<unknown>`
    ].join('\n')
  )
  const codexDeclaration = `declare const tools: {\n${codexMembers.join('\n')}\n}`

  if (frontend === 'codex') {
    return `## Writing code for exec

${toolBoundary}

\`exec\` runs the body of an async JavaScript module. Only values passed to the output helpers or returned by the module enter the tool result. Use \`yield_control()\` only when the cell must be resumed later with \`wait\`.

The top-level \`exec\` starts a Code Mode cell; \`tools.exec\` inside that cell runs the selected Shell command subtool.

${progressPrompt}

\`\`\`ts
${codexDeclaration}
declare const ALL_TOOLS: ReadonlyArray<{ name: string; description: string }>
declare function text(value: unknown): void
declare function store(key: string, value: unknown): void
declare function load(key: string): unknown
declare function notify(value: unknown): void
declare function yield_control(): Promise<void>
\`\`\``
  }

  return `## Writing code for run_code

${toolBoundary}

\`run_code\` takes two required arguments: \`code\` — the body of an async TypeScript function (erasable syntax only — no \`enum\` or namespaces; type annotations are advisory, the code runs type-stripped) — and \`description\`, a short summary of what the program does. Inside the program:

- Call subtools as \`await tools.name(args)\` — quoted access for exotic names: \`tools["my-tool"](args)\`. Every call resolves to the subtool's typed canonical JSON value. Subtool arguments must be lossless JSON.
- A FAILED subtool call rejects with \`ToolCallError\`, whose \`toolName\` identifies the failed subtool and whose \`message\` is human-readable — \`try/catch\` it to handle and continue.
- Independent read-only calls MAY overlap under \`Promise.all\` (safe calls run concurrently; mutating calls run alone, in submission order). Sequence dependent work with \`await\`.
- Emit results with \`return\` and/or \`console.log(...)\`. ONLY what you print or return comes back to you — intermediate subtool results never enter the conversation, so extract just what you need.

${progressPrompt}

Available Code Mode subtools (only callable inside \`run_code.code\` through \`tools\`):

\`\`\`ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

${harnessDeclaration}
\`\`\``
}
