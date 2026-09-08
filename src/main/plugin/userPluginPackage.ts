import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import safeRegex from 'safe-regex2'
import type {
  UserPluginHook,
  UserPluginMcpServer,
  UserPluginPackage
} from '@shared/types/userPlugin'

const ROOT_VARIABLES = new Set([
  'PLUGIN_ROOT',
  'PLUGIN_DATA',
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PLUGIN_DATA'
])
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'SubagentStart'])
const RESERVED_PATH = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function pluginRelativePath(root: string, relative: string): string {
  const parts = relative.replace(/^\.\//, '').split('/')
  if (
    !parts.length ||
    relative.length > 1024 ||
    parts.length > 32 ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[\\:]/.test(part) ||
        [...part].some((char) => char.charCodeAt(0) < 32) ||
        part.endsWith('.') ||
        part.endsWith(' ') ||
        RESERVED_PATH.test(part)
    )
  ) {
    throw new Error(`Invalid plugin path: ${relative}`)
  }
  return path.join(root, ...parts)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 32768)
    throw new Error(`${label} must be a nonempty string`)
  return value
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`${label} must be a string array`)
  return value as string[]
}

function stringMap(value: unknown, label: string): Record<string, string> {
  const result = object(value, label)
  for (const [key, item] of Object.entries(result)) {
    if (typeof item !== 'string' || item.includes('\0'))
      throw new Error(`${label}.${key} must be a string without NUL`)
  }
  return result as Record<string, string>
}

function readJson(root: string, relative: string): unknown {
  const filename = pluginRelativePath(root, relative.replace(/\/$/, ''))
  if (fs.statSync(filename).size > 1024 * 1024)
    throw new Error(`Configuration exceeds 1 MiB: ${relative}`)
  return JSON.parse(fs.readFileSync(filename, 'utf8'))
}

function configuration(root: string, declared: unknown, fallback: string): unknown {
  if (declared !== undefined)
    return typeof declared === 'string' ? readJson(root, declared) : declared
  return fs.existsSync(path.join(root, fallback)) ? readJson(root, fallback) : undefined
}

function parseHooks(value: unknown, findings: string[]): UserPluginHook[] {
  if (value === undefined) return []
  const config = object(value, 'hooks configuration')
  const events = object(config.hooks ?? config, 'hooks')
  const result: UserPluginHook[] = []
  for (const [event, groups] of Object.entries(events)) {
    if (!EVENTS.has(event)) {
      findings.push(`Unsupported hook event: ${event}`)
      continue
    }
    if (!Array.isArray(groups)) throw new Error(`${event} must contain an array of hook groups`)
    for (const [groupIndex, rawGroup] of groups.entries()) {
      const group = object(rawGroup, `${event} group`)
      const matcher = group.matcher === undefined ? undefined : text(group.matcher, 'matcher')
      if (matcher && (matcher.length > 256 || !safeRegex(matcher)))
        throw new Error(`Unsafe hook matcher: ${event}`)
      if (matcher) new RegExp(matcher)
      if (event === 'UserPromptSubmit' && matcher) {
        findings.push('UserPromptSubmit matchers are unavailable')
        continue
      }
      const groupUnknown = Object.keys(group).filter((key) => !['matcher', 'hooks'].includes(key))
      if (groupUnknown.length) {
        findings.push(`Unsupported ${event} group fields: ${groupUnknown.join(', ')}`)
        continue
      }
      if (!Array.isArray(group.hooks)) throw new Error(`${event}.hooks must be an array`)
      for (const [index, rawHook] of group.hooks.entries()) {
        const hook = object(rawHook, `${event} hook`)
        const unknown = Object.keys(hook).filter(
          (key) => !['type', 'command', 'commandWindows', 'timeout', 'statusMessage'].includes(key)
        )
        if (hook.type !== 'command' || unknown.length) {
          findings.push(
            `Unsupported ${event} handler: ${String(hook.type)}${unknown.length ? ` (${unknown.join(', ')})` : ''}`
          )
          continue
        }
        const timeout = hook.timeout ?? 5
        if (
          typeof timeout !== 'number' ||
          !Number.isFinite(timeout) ||
          timeout <= 0 ||
          timeout > 30
        )
          throw new Error('Hook timeout must be between 0 and 30 seconds')
        result.push({
          id: `${event}:${groupIndex}:${index}`,
          event: event as UserPluginHook['event'],
          matcher,
          command: text(hook.command, 'hook command'),
          ...(hook.commandWindows === undefined
            ? {}
            : { commandWindows: text(hook.commandWindows, 'Windows command') }),
          timeout,
          ...(hook.statusMessage === undefined
            ? {}
            : { statusMessage: text(hook.statusMessage, 'status message') })
        })
      }
    }
  }
  if (result.some((hook) => hook.event === 'SessionStart')) {
    findings.push(
      'SessionStart resume runs on the first new input after an application restart; ordinary turns and page navigation do not restart a plugin'
    )
    if (
      result.some(
        (hook) =>
          hook.event === 'SessionStart' && (!hook.matcher || new RegExp(hook.matcher).test('clear'))
      )
    )
      findings.push(
        'SessionStart clear is unavailable; clearing messages starts a new hook history on the next input'
      )
  }
  if (
    process.platform === 'win32' &&
    result.some((hook) => !hook.commandWindows && /\$\{|\$[A-Za-z_]/.test(hook.command))
  )
    findings.push('Some hooks require a commandWindows override for the Windows shell')
  if (result.length > 64) throw new Error('Plugin contains more than 64 command hooks')
  return result
}

function parseMcp(value: unknown, findings: string[]): UserPluginMcpServer[] {
  if (value === undefined) return []
  const config = object(value, 'MCP configuration')
  if (config.mcp_servers && config.mcpServers)
    throw new Error('Ambiguous MCP configuration wrappers')
  const servers = object(config.mcp_servers ?? config.mcpServers ?? config, 'MCP servers')
  const result: UserPluginMcpServer[] = []
  for (const [name, raw] of Object.entries(servers)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name))
      throw new Error(`Invalid MCP server name: ${name}`)
    const server = object(raw, `MCP ${name}`)
    const known = [
      'type',
      'transport',
      'command',
      'args',
      'env',
      'env_vars',
      'cwd',
      'url',
      'headers',
      'http_headers',
      'env_http_headers',
      'bearer_token_env_var',
      'autoApprove',
      'enabled',
      'description'
    ]
    const unknown = Object.keys(server).filter((key) => !known.includes(key))
    // Unimplemented restrictions must never turn into a more permissive connection.
    if (unknown.length) {
      findings.push(`MCP ${name} unavailable: unsupported fields ${unknown.join(', ')}`)
      continue
    }
    if (server.autoApprove !== undefined)
      findings.push(`MCP ${name}: autoApprove is ignored; permissions remain host-owned`)
    if (server.enabled === false) {
      findings.push(`MCP ${name}: disabled by its package`)
      continue
    }
    if (server.enabled !== undefined && typeof server.enabled !== 'boolean')
      throw new Error(`Invalid MCP enabled flag: ${name}`)
    if (
      server.type !== undefined &&
      server.transport !== undefined &&
      server.type !== server.transport
    )
      throw new Error(`MCP ${name} declares conflicting transports`)
    if (server.headers !== undefined && server.http_headers !== undefined)
      throw new Error(`MCP ${name} declares conflicting header aliases`)
    if (server.command !== undefined && server.url !== undefined)
      throw new Error(`MCP ${name} declares both command and URL`)
    const transport =
      server.type ?? server.transport ?? (server.url === undefined ? 'stdio' : 'http')
    if (!['stdio', 'http', 'sse'].includes(String(transport))) {
      findings.push(`MCP ${name}: unsupported transport ${String(transport)}`)
      continue
    }
    const irrelevant =
      transport === 'stdio'
        ? ['headers', 'http_headers', 'env_http_headers', 'bearer_token_env_var']
        : ['command', 'args', 'env', 'env_vars', 'cwd']
    if (irrelevant.some((key) => server[key] !== undefined))
      throw new Error(`MCP ${name} has fields incompatible with ${transport}`)
    const headers = { ...stringMap(server.headers ?? server.http_headers ?? {}, 'MCP headers') }
    for (const [key, variable] of Object.entries(
      stringMap(server.env_http_headers ?? {}, 'MCP environment headers')
    )) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
        throw new Error(`Invalid header environment binding: ${variable}`)
      headers[key] = `\${${variable}}`
    }
    if (server.bearer_token_env_var !== undefined) {
      const variable = text(server.bearer_token_env_var, 'bearer token variable')
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
        throw new Error('Invalid bearer token variable')
      headers.Authorization = `Bearer \${${variable}}`
    }
    const forwardedEnv = strings(server.env_vars ?? [], 'MCP forwarded environment')
    if (forwardedEnv.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
      throw new Error('Invalid MCP forwarded environment name')
    const normalized: UserPluginMcpServer = {
      name,
      type: transport as UserPluginMcpServer['type'],
      requiredVariables: [],
      ...(transport === 'stdio'
        ? {
            command: text(server.command, 'MCP command'),
            args: strings(server.args ?? [], 'MCP arguments'),
            env: {
              ...Object.fromEntries(forwardedEnv.map((name) => [name, `\${${name}}`])),
              ...stringMap(server.env ?? {}, 'MCP environment')
            },
            ...(server.cwd === undefined ? {} : { cwd: text(server.cwd, 'MCP cwd') })
          }
        : { url: text(server.url, 'MCP URL'), headers })
    }
    if (normalized.url) {
      if (normalized.url.includes('${'))
        throw new Error('MCP URL must be literal; put environment-bound credentials in headers')
      const url = new URL(normalized.url)
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
      if (
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        url.username ||
        url.password
      )
        throw new Error(`Invalid MCP URL: ${name}`)
    }
    const variables = [
      ...JSON.stringify(normalized).matchAll(/\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g)
    ].map((match) => match[1])
    normalized.requiredVariables = [...new Set(variables.filter((key) => !ROOT_VARIABLES.has(key)))]
    result.push(normalized)
  }
  if (result.length > 32) throw new Error('Plugin contains more than 32 MCP servers')
  return result
}

export function readUserPluginPackage(root: string): UserPluginPackage {
  const manifest = object(readJson(root, '.codex-plugin/plugin.json'), 'Plugin manifest')
  const findings: string[] = []
  const name = text(manifest.name, 'Plugin name')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name)) throw new Error('Invalid plugin name')
  const author = manifest.author
  const publisher =
    typeof author === 'string'
      ? author
      : author
        ? text(object(author, 'author').name, 'author name')
        : 'Unknown'
  const skills: UserPluginPackage['skills'] = []
  const declaredSkills =
    manifest.skills ?? (fs.existsSync(path.join(root, 'skills')) ? './skills' : [])
  const directories =
    typeof declaredSkills === 'string' ? [declaredSkills] : strings(declaredSkills, 'skills')
  for (const directory of directories) {
    const relative = directory.replace(/^\.\//, '').replace(/\/$/, '')
    const skillDirectory = pluginRelativePath(root, relative)
    if (!fs.statSync(skillDirectory).isDirectory())
      throw new Error(`Skill path must be a directory: ${relative}`)
    const roots = fs.existsSync(path.join(skillDirectory, 'SKILL.md'))
      ? [relative]
      : fs
          .readdirSync(skillDirectory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${relative}/${entry.name}`)
    for (const skillRoot of roots) {
      const filename = pluginRelativePath(root, `${skillRoot}/SKILL.md`)
      if (!fs.existsSync(filename)) continue
      if (fs.statSync(filename).size > 1024 * 1024) throw new Error('SKILL.md exceeds 1 MiB')
      const metadata = matter(fs.readFileSync(filename, 'utf8'), {
        engines: {
          javascript: () => {
            throw new Error('JavaScript front matter is not supported')
          }
        }
      }).data
      const skillName = text(metadata.name, 'Skill name')
      text(metadata.description, 'Skill description')
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(skillName))
        throw new Error(`Invalid skill name: ${skillName}`)
      if (skills.some((skill) => skill.name === skillName))
        throw new Error(`Duplicate skill name: ${skillName}`)
      skills.push({ name: skillName, path: skillRoot })
    }
  }
  const supported = new Set([
    'name',
    'version',
    'description',
    'author',
    'homepage',
    'repository',
    'license',
    'keywords',
    'interface',
    'skills',
    'hooks',
    'mcpServers'
  ])
  for (const key of Object.keys(manifest))
    if (!supported.has(key)) findings.push(`Unsupported manifest declaration: ${key}`)
  if (fs.existsSync(path.join(root, '.app.json')))
    findings.push(
      'OpenAI app connector IDs require OpenAI account services and are unavailable in MioWork'
    )
  return {
    name,
    version:
      manifest.version === undefined ? 'unversioned' : text(manifest.version, 'Plugin version'),
    publisher,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    skills,
    hooks: parseHooks(configuration(root, manifest.hooks, 'hooks/hooks.json'), findings),
    mcpServers: parseMcp(configuration(root, manifest.mcpServers, '.mcp.json'), findings),
    findings
  }
}
