import { describe, expect, it } from 'vitest'
import {
  CLI_OUTPUT_ENV,
  CLI_TIMEOUT_ENV,
  DEFAULT_COMPUTE_TIMEOUT_MS,
  DEFAULT_MUTATION_TIMEOUT_MS,
  formatCliHelp,
  parseCliArguments
} from '../../../src/cli/args'

describe('CLI argument grammar', () => {
  it('maps the two-token command prefix to a canonical route', () => {
    const parsed = parseCliArguments(['system', 'status'], {})

    expect(parsed).toMatchObject({
      domain: 'system',
      verb: 'status',
      outputMode: 'text',
      timeoutMs: 30_000,
      helpRequested: false
    })
    expect(parsed.contract?.name).toBe('cli.status')
  })

  it('accepts global flags only after the domain and verb', () => {
    expect(parseCliArguments(['system', 'doctor', '--jsonl', '--timeout=2500'], {})).toMatchObject({
      outputMode: 'jsonl',
      timeoutMs: 2_500
    })

    expect(() => parseCliArguments(['--json', 'system', 'doctor'], {})).toThrow(
      'deepchat <domain> <verb>'
    )
    expect(() => parseCliArguments(['system', '--json', 'doctor'], {})).toThrow(
      'deepchat <domain> <verb>'
    )
  })

  it('uses validated environment defaults and explicit output override', () => {
    expect(
      parseCliArguments(['system', 'version', '--json'], {
        [CLI_OUTPUT_ENV]: 'text',
        [CLI_TIMEOUT_ENV]: '9000'
      })
    ).toMatchObject({ outputMode: 'json', timeoutMs: 9_000 })

    expect(() => parseCliArguments(['system', 'version'], { [CLI_OUTPUT_ENV]: 'xml' })).toThrow(
      `${CLI_OUTPUT_ENV} must be`
    )
  })

  it('rejects ambiguous and unbounded options', () => {
    expect(() => parseCliArguments(['system', 'status', '--json', '--jsonl'], {})).toThrow(
      'mutually exclusive'
    )
    expect(() => parseCliArguments(['system', 'status', '--timeout', '1800001'], {})).toThrow(
      'must not exceed'
    )
    expect(() => parseCliArguments(['system', 'status', '--timeout', '--json'], {})).toThrow(
      'Missing value for --timeout'
    )
    expect(() => parseCliArguments(['system', 'status', 'extra'], {})).toThrow('Unknown option')
  })

  it('keeps top-level help local while command help follows the two-token grammar', () => {
    expect(parseCliArguments(['help'], {})).toMatchObject({
      domain: 'help',
      verb: '',
      contract: null,
      helpRequested: true
    })
    expect(() => parseCliArguments(['help', 'commands'], {})).toThrow('deepchat help')
    expect(() => parseCliArguments(['--help'], {})).toThrow('deepchat <domain> <verb>')
    expect(formatCliHelp({ domain: 'agent', verb: 'run' })).toContain('--max-turns <n>')
    expect(formatCliHelp({ domain: 'run', verb: 'watch' })).toContain('--cursor <event-cursor>')
    expect(formatCliHelp({ domain: 'model', verb: 'list' })).toContain(
      'deepchat model list --provider <id>'
    )
  })

  it('parses Programmatic Tool commands without widening ordinary Agent invocation', () => {
    expect(
      parseCliArguments(['tool', 'search', '--query', 'calendar', '--limit', '4'], {})
    ).toMatchObject({
      contract: { name: 'tool.search' },
      operation: 'rpc',
      readStdin: false,
      params: { query: 'calendar', limit: 4 }
    })
    expect(
      parseCliArguments(['tool', 'describe', '--target', 'calendar_search'], {})
    ).toMatchObject({
      contract: { name: 'tool.describe' },
      readStdin: false,
      params: { target: 'calendar_search' }
    })
    expect(parseCliArguments(['tool', 'call'], {})).toMatchObject({
      contract: { name: 'tool.call' },
      readStdin: true,
      params: {}
    })
    expect(parseCliArguments(['tool', 'batch'], {})).toMatchObject({
      contract: { name: 'tool.batch' },
      readStdin: true,
      params: {}
    })

    expect(() => parseCliArguments(['tool', 'search'], {})).toThrow('requires --query')
    expect(() => parseCliArguments(['tool', 'describe'], {})).toThrow('requires --target')
    expect(() => parseCliArguments(['tool', 'call', '--stdin'], {})).toThrow('--stdin is not valid')
    expect(formatCliHelp({ domain: 'tool', verb: 'call' })).toContain('request JSON on stdin')
  })

  it('parses artifact ownership commands without accepting output flags on metadata operations', () => {
    const id = 'artifact_identifier_123'

    expect(
      parseCliArguments(['artifact', 'get', '--id', id, '--out', './image.png', '--overwrite'], {})
    ).toMatchObject({
      operation: 'download',
      params: { id },
      outputPath: './image.png',
      overwrite: true
    })
    expect(parseCliArguments(['artifact', 'describe', `--id=${id}`], {})).toMatchObject({
      operation: 'rpc',
      params: { id }
    })
    expect(() =>
      parseCliArguments(['artifact', 'delete', '--id', id, '--out', './invalid'], {})
    ).toThrow('only valid for deepchat artifact get')
    expect(() => parseCliArguments(['artifact', 'get', '--id', id], {})).toThrow('requires --out')
    expect(() =>
      parseCliArguments(['artifact', 'get', '--id', id, '--out', '--overwrite'], {})
    ).toThrow('Missing value for --out')
  })

  it('parses raw model input without allowing an ambiguous prompt source', () => {
    expect(
      parseCliArguments(
        [
          'model',
          'invoke',
          '--provider',
          'provider-1',
          '--model',
          'model-1',
          '--system',
          'Be concise',
          '--stdin',
          '--temperature=0.2',
          '--max-tokens',
          '256'
        ],
        {}
      )
    ).toMatchObject({
      operation: 'stream',
      readStdin: true,
      timeoutMs: DEFAULT_COMPUTE_TIMEOUT_MS,
      params: {
        providerId: 'provider-1',
        modelId: 'model-1',
        messages: [{ role: 'system', content: 'Be concise' }],
        temperature: 0.2,
        maxTokens: 256
      }
    })

    expect(() =>
      parseCliArguments(
        [
          'model',
          'invoke',
          '--provider',
          'provider-1',
          '--model',
          'model-1',
          '--prompt',
          'hello',
          '--stdin'
        ],
        {}
      )
    ).toThrow('exactly one of --prompt or --stdin')
  })

  it('parses bounded durable Agent creation options', () => {
    expect(
      parseCliArguments(
        [
          'agent',
          'run',
          '--prompt',
          'Run the benchmark',
          '--agent',
          'deepchat',
          '--provider',
          'provider-1',
          '--model',
          'model-1',
          '--system',
          'Be concise',
          '--title',
          'Benchmark run',
          '--project-dir',
          '/tmp/project',
          '--skills',
          'bench,reporting',
          '--disable-tools',
          'dangerous-tool',
          '--max-turns',
          '8'
        ],
        {}
      )
    ).toMatchObject({
      contract: { name: 'sessions.runDetached' },
      operation: 'rpc',
      timeoutMs: DEFAULT_COMPUTE_TIMEOUT_MS,
      params: {
        prompt: 'Run the benchmark',
        agentId: 'deepchat',
        providerId: 'provider-1',
        modelId: 'model-1',
        systemPrompt: 'Be concise',
        title: 'Benchmark run',
        projectDir: '/tmp/project',
        activeSkills: ['bench', 'reporting'],
        disabledAgentTools: ['dangerous-tool'],
        maxTurns: 8
      }
    })
    expect(parseCliArguments(['agent', 'run', '--stdin'], {})).toMatchObject({
      readStdin: true,
      params: {}
    })
    expect(() => parseCliArguments(['agent', 'run', '--prompt', 'hello', '--stdin'], {})).toThrow(
      'exactly one of --prompt or --stdin'
    )
    expect(() =>
      parseCliArguments(['agent', 'run', '--prompt', 'hello', '--skills', 'bench,bench'], {})
    ).toThrow('duplicate identifiers')
  })

  it('keeps run identity and message/event cursors in separate typed options', () => {
    expect(
      parseCliArguments(
        [
          'run',
          'get',
          '--run',
          'run-1',
          '--cursor',
          '{"orderSeq":42,"id":"message-42"}',
          '--limit',
          '25'
        ],
        {}
      )
    ).toMatchObject({
      contract: { name: 'runs.get' },
      operation: 'rpc',
      params: {
        runId: 'run-1',
        cursor: { orderSeq: 42, id: 'message-42' },
        limit: 25
      }
    })
    expect(
      parseCliArguments(
        ['run', 'watch', '--run', 'run-1', '--cursor', 'epoch-1:42', '--limit', '10'],
        {}
      )
    ).toMatchObject({
      contract: { name: 'events.subscribe' },
      operation: 'stream',
      timeoutMs: DEFAULT_COMPUTE_TIMEOUT_MS,
      params: { runId: 'run-1', cursor: 'epoch-1:42', messageLimit: 10 }
    })
    expect(parseCliArguments(['run', 'cancel', '--run', 'run-1'], {})).toMatchObject({
      contract: { name: 'runs.cancel' },
      params: { runId: 'run-1' }
    })
    expect(() => parseCliArguments(['run', 'get'], {})).toThrow('requires --run')
    expect(() =>
      parseCliArguments(['run', 'get', '--run', 'run-1', '--cursor', 'epoch-1:42'], {})
    ).toThrow('JSON message cursor')
    expect(() =>
      parseCliArguments(['run', 'watch', '--run', 'run-1', '--cursor', '{"orderSeq":1}'], {})
    ).toThrow('valid event cursor')
  })

  it('keeps model flags after the two-token capability signature', () => {
    expect(() =>
      parseCliArguments(
        ['--json', 'model', 'invoke', '--provider', 'provider-1', '--model', 'model-1'],
        {}
      )
    ).toThrow('deepchat <domain> <verb>')
    expect(() => parseCliArguments(['provider', 'list', '--provider', 'provider-1'], {})).toThrow(
      'not valid for deepchat provider list'
    )
    expect(parseCliArguments(['provider', 'list', '--enabled-only'], {})).toMatchObject({
      params: { enabledOnly: true }
    })
  })

  it('parses allowlisted settings reads and one scalar update', () => {
    expect(
      parseCliArguments(['settings', 'get', '--keys', 'fontSizeLevel, privacyModeEnabled'], {})
    ).toMatchObject({
      contract: { name: 'settings.getPublic' },
      params: { keys: ['fontSizeLevel', 'privacyModeEnabled'] }
    })
    expect(
      parseCliArguments(['settings', 'set', '--key', 'fontSizeLevel', '--value', '3'], {})
    ).toMatchObject({
      contract: { name: 'settings.updatePublic' },
      params: { changes: [{ key: 'fontSizeLevel', value: 3 }] }
    })
    expect(
      parseCliArguments(['settings', 'set', '--key', 'fontFamily', '--value', 'Berkeley Mono'], {})
    ).toMatchObject({
      params: { changes: [{ key: 'fontFamily', value: 'Berkeley Mono' }] }
    })
    expect(
      parseCliArguments(['settings', 'set', '--key', 'fontSizeLevel', '--value', '3e0'], {})
    ).toMatchObject({
      params: { changes: [{ key: 'fontSizeLevel', value: 3 }] }
    })

    expect(() => parseCliArguments(['settings', 'get', '--keys', ','], {})).toThrow(
      'at least one setting key'
    )
    expect(() => parseCliArguments(['settings', 'set', '--key', 'loggingEnabled'], {})).toThrow(
      'requires --key and --value'
    )
  })

  it('parses provider administration without accepting credentials in argv', () => {
    expect(
      parseCliArguments(
        [
          'provider',
          'add',
          '--name',
          'Local API',
          '--api-type',
          'openai-completions',
          '--base-url',
          'http://localhost:8080/v1',
          '--enabled',
          'false'
        ],
        {}
      )
    ).toMatchObject({
      contract: { name: 'providers.addPublic' },
      params: {
        name: 'Local API',
        apiType: 'openai-completions',
        baseUrl: 'http://localhost:8080/v1',
        enabled: false
      }
    })
    expect(
      parseCliArguments(['provider', 'set-credential', '--provider', 'provider-1', '--stdin'], {})
    ).toMatchObject({
      contract: { name: 'providers.setCredential' },
      params: { providerId: 'provider-1', action: 'set', kind: 'api-key' },
      readStdin: true
    })
    expect(parseCliArguments(['provider', 'test', '--provider', 'provider-1'], {})).toMatchObject({
      contract: { name: 'providers.testPublicConnection' }
    })
    expect(() =>
      parseCliArguments(
        ['provider', 'set-credential', '--provider', 'provider-1', '--value', 'secret'],
        {}
      )
    ).toThrow('--value is not valid')
    expect(() => parseCliArguments(['provider', 'update', '--provider', 'provider-1'], {})).toThrow(
      'at least one update'
    )
  })

  it('parses model administration with full config supplied only through stdin', () => {
    expect(
      parseCliArguments(['model', 'enable', '--provider', 'provider-1', '--model', 'model-1'], {})
    ).toMatchObject({
      contract: { name: 'models.setStatus' },
      params: { providerId: 'provider-1', modelId: 'model-1', enabled: true }
    })
    expect(
      parseCliArguments(
        ['model', 'config-set', '--provider', 'provider-1', '--model', 'model-1', '--stdin'],
        {}
      )
    ).toMatchObject({
      contract: { name: 'models.setPublicConfig' },
      params: { providerId: 'provider-1', modelId: 'model-1' },
      readStdin: true
    })
    expect(() =>
      parseCliArguments(
        ['model', 'config-set', '--provider', 'provider-1', '--model', 'model-1'],
        {}
      )
    ).toThrow('requires --stdin')
  })

  it('maps image and video options without exposing file output paths', () => {
    expect(
      parseCliArguments(
        [
          'image',
          'generate',
          '--provider',
          'provider-1',
          '--model',
          'image-1',
          '--prompt',
          'a lighthouse',
          '--size',
          '1024x1024',
          '--quality',
          'high',
          '--format',
          'webp',
          '--compression',
          '80',
          '--background',
          'opaque',
          '--moderation',
          'auto'
        ],
        {}
      )
    ).toMatchObject({
      operation: 'stream',
      timeoutMs: DEFAULT_COMPUTE_TIMEOUT_MS,
      params: {
        providerId: 'provider-1',
        modelId: 'image-1',
        prompt: 'a lighthouse',
        options: {
          size: '1024x1024',
          quality: 'high',
          outputFormat: 'webp',
          outputCompression: 80,
          background: 'opaque',
          moderation: 'auto'
        }
      }
    })

    expect(
      parseCliArguments(
        [
          'video',
          'generate',
          '--provider=provider-1',
          '--model=video-1',
          '--stdin',
          '--seconds=8',
          '--ratio=16:9',
          '--duration',
          '-1',
          '--resolution=1080p',
          '--watermark=false',
          '--audio=true'
        ],
        {}
      )
    ).toMatchObject({
      operation: 'stream',
      readStdin: true,
      params: {
        providerId: 'provider-1',
        modelId: 'video-1',
        options: {
          seconds: '8',
          ratio: '16:9',
          duration: -1,
          resolution: '1080p',
          watermark: false,
          generateAudio: true
        }
      }
    })

    expect(() =>
      parseCliArguments(
        [
          'image',
          'generate',
          '--provider',
          'provider-1',
          '--model',
          'image-1',
          '--prompt',
          'hello',
          '--out',
          './image.png'
        ],
        {}
      )
    ).toThrow('Artifact options are not valid')
  })

  it('maps speech input and rejects ambiguous or cross-domain media flags', () => {
    expect(
      parseCliArguments(
        [
          'audio',
          'speak',
          '--provider',
          'provider-1',
          '--model',
          'tts-1',
          '--text',
          'hello',
          '--voice',
          'alloy',
          '--format',
          'wav',
          '--speed',
          '1.25',
          '--instructions',
          'Speak softly'
        ],
        {}
      )
    ).toMatchObject({
      operation: 'stream',
      params: {
        providerId: 'provider-1',
        modelId: 'tts-1',
        text: 'hello',
        options: {
          voice: 'alloy',
          responseFormat: 'wav',
          speed: 1.25,
          instructions: 'Speak softly'
        }
      }
    })

    expect(() =>
      parseCliArguments(
        [
          'audio',
          'speak',
          '--provider',
          'provider-1',
          '--model',
          'tts-1',
          '--text',
          'hello',
          '--stdin'
        ],
        {}
      )
    ).toThrow('exactly one of --text or --stdin')
    expect(() =>
      parseCliArguments(
        [
          'video',
          'generate',
          '--provider',
          'provider-1',
          '--model',
          'video-1',
          '--prompt',
          'hello',
          '--voice',
          'alloy'
        ],
        {}
      )
    ).toThrow('--voice is not valid for deepchat video generate')
  })

  it('keeps media-specific options discoverable from command help', () => {
    expect(formatCliHelp({ domain: 'image', verb: 'generate' })).toContain('--compression <n>')
    expect(formatCliHelp({ domain: 'video', verb: 'generate' })).toContain('--watermark <bool>')
    expect(formatCliHelp({ domain: 'audio', verb: 'speak' })).toContain('--voice <value>')
  })

  it('selects upload and artifact contracts for audio transcription', () => {
    expect(
      parseCliArguments(
        [
          'audio',
          'transcribe',
          '--provider',
          'provider-1',
          '--model',
          'whisper-1',
          '--file',
          './meeting.MP3'
        ],
        {}
      )
    ).toMatchObject({
      operation: 'upload',
      inputPath: './meeting.MP3',
      uploadMaxBytes: 25 * 1024 * 1024,
      contract: { name: 'audio.transcribeUpload' },
      params: {
        providerId: 'provider-1',
        modelId: 'whisper-1',
        mimeType: 'audio/mpeg',
        filename: 'meeting.MP3'
      }
    })

    expect(
      parseCliArguments(
        [
          'audio',
          'transcribe',
          '--provider',
          'provider-1',
          '--model',
          'whisper-1',
          '--artifact',
          'artifact_identifier_123'
        ],
        {}
      )
    ).toMatchObject({
      operation: 'rpc',
      contract: { name: 'audio.transcribeArtifact' },
      params: {
        providerId: 'provider-1',
        modelId: 'whisper-1',
        artifactId: 'artifact_identifier_123'
      }
    })
  })

  it('maps OCR input modes and bounded PDF options', () => {
    expect(
      parseCliArguments(
        [
          'ocr',
          'extract',
          '--file',
          './scan.pdf',
          '--backend',
          'cpu',
          '--page-count',
          '12',
          '--max-tokens',
          '4096'
        ],
        {}
      )
    ).toMatchObject({
      operation: 'upload',
      inputPath: './scan.pdf',
      uploadMaxBytes: 50 * 1024 * 1024,
      contract: { name: 'ocr.extractUpload' },
      params: {
        mimeType: 'application/pdf',
        backend: 'cpu',
        sourcePageCountHint: 12,
        generationTokenLimit: 4096
      }
    })
    expect(
      parseCliArguments(['ocr', 'extract', '--artifact', 'artifact_identifier_123'], {})
    ).toMatchObject({
      operation: 'rpc',
      contract: { name: 'ocr.extractArtifact' },
      params: { artifactId: 'artifact_identifier_123' }
    })
    expect(parseCliArguments(['ocr', 'status'], {}).contract?.name).toBe('ocr.getRuntimeStatus')
    expect(parseCliArguments(['ocr', 'clear-cache'], {})).toMatchObject({
      contract: { name: 'ocr.clearCache' },
      timeoutMs: DEFAULT_COMPUTE_TIMEOUT_MS
    })
  })

  it('rejects ambiguous or unverifiable file-input options', () => {
    expect(() =>
      parseCliArguments(
        ['ocr', 'extract', '--file', './scan.png', '--artifact', 'artifact_identifier_123'],
        {}
      )
    ).toThrow('exactly one of --file or --artifact')
    expect(() => parseCliArguments(['ocr', 'extract', '--file', './scan.unknown'], {})).toThrow(
      'provide --mime'
    )
    expect(() =>
      parseCliArguments(['ocr', 'extract', '--file', './scan.png', '--mime', '   '], {})
    ).toThrow('--mime must not be empty')
    expect(() =>
      parseCliArguments(
        ['ocr', 'extract', '--artifact', 'artifact_identifier_123', '--mime', 'image/png'],
        {}
      )
    ).toThrow('--mime is only valid together with --file')
    expect(() =>
      parseCliArguments(['ocr', 'extract', '--file', './scan.pdf', '--max-tokens', '16001'], {})
    ).toThrow('--max-tokens must not exceed 16000')
    expect(() =>
      parseCliArguments(['ocr', 'extract', '--file', './scan.png', '--page-count', '1'], {})
    ).toThrow('only valid for PDF input')
  })

  it('keeps transcription and OCR options discoverable', () => {
    expect(formatCliHelp({ domain: 'audio', verb: 'transcribe' })).toContain('--mime <type>')
    expect(formatCliHelp({ domain: 'ocr', verb: 'extract' })).toContain('--page-count <n>')
    expect(formatCliHelp()).toContain('ocr clear-cache')
  })

  it('parses public Skill management without exposing arbitrary paths', () => {
    expect(parseCliArguments(['skill', 'list'], {})).toMatchObject({
      operation: 'rpc',
      contract: { name: 'skills.listPublic' },
      params: {}
    })
    expect(
      parseCliArguments(
        ['skill', 'install', '--file', './safe-skill.zip', '--agent', 'agent-1', '--overwrite'],
        {}
      )
    ).toMatchObject({
      operation: 'upload',
      contract: { name: 'skills.installUpload' },
      inputPath: './safe-skill.zip',
      uploadMaxBytes: 200 * 1024 * 1024,
      params: {
        agentId: 'agent-1',
        filename: 'safe-skill.zip',
        overwrite: true
      }
    })
    expect(
      parseCliArguments(
        ['skill', 'install', '--url', 'https://skills.example/archive.zip?signature=private'],
        {}
      )
    ).toMatchObject({
      operation: 'rpc',
      contract: { name: 'skills.installPublicUrl' },
      params: {
        url: 'https://skills.example/archive.zip?signature=private',
        overwrite: false
      }
    })
    expect(parseCliArguments(['skill', 'disable', '--name', 'safe-skill'], {})).toMatchObject({
      contract: { name: 'skills.setPublicStatus' },
      params: { name: 'safe-skill', enabled: false }
    })
    expect(parseCliArguments(['skill', 'remove', '--name', 'safe-skill'], {})).toMatchObject({
      contract: { name: 'skills.uninstallPublic' },
      params: { name: 'safe-skill' }
    })

    expect(() =>
      parseCliArguments(['skill', 'install', '--file', 'a.zip', '--url', 'https://x'], {})
    ).toThrow('exactly one of --file or --url')
    expect(() => parseCliArguments(['skill', 'enable'], {})).toThrow('requires --name')
    expect(() => parseCliArguments(['skill', 'list', '--overwrite'], {})).toThrow(
      '--overwrite is not valid'
    )
  })

  it('keeps Skill commands discoverable', () => {
    expect(formatCliHelp({ domain: 'skill', verb: 'install' })).toContain(
      '--file <archive>|--url <https-url>'
    )
    expect(formatCliHelp()).toContain('skill remove')
  })

  it('parses public MCP administration without accepting inline configuration', () => {
    expect(parseCliArguments(['mcp', 'list'], {})).toMatchObject({
      operation: 'rpc',
      contract: { name: 'mcp.listPublic' },
      params: {}
    })
    expect(
      parseCliArguments(['mcp', 'add', '--name', 'local-server', '--stdin'], {})
    ).toMatchObject({
      contract: { name: 'mcp.addPublic' },
      params: { serverName: 'local-server' },
      readStdin: true,
      timeoutMs: DEFAULT_MUTATION_TIMEOUT_MS
    })
    expect(
      parseCliArguments(['mcp', 'update', '--name=local-server', '--stdin'], {})
    ).toMatchObject({
      contract: { name: 'mcp.updatePublic' },
      params: { serverName: 'local-server' },
      readStdin: true
    })
    expect(parseCliArguments(['mcp', 'disable', '--name', 'local-server'], {})).toMatchObject({
      contract: { name: 'mcp.setPublicStatus' },
      params: { serverName: 'local-server', enabled: false }
    })
    expect(parseCliArguments(['mcp', 'start', '--name', 'local-server'], {})).toMatchObject({
      contract: { name: 'mcp.startPublic' },
      params: { serverName: 'local-server' }
    })
    expect(parseCliArguments(['mcp', 'stop', '--name', 'local-server'], {})).toMatchObject({
      contract: { name: 'mcp.stopPublic' },
      params: { serverName: 'local-server' }
    })
    expect(parseCliArguments(['mcp', 'remove', '--name', 'local-server'], {})).toMatchObject({
      contract: { name: 'mcp.removePublic' },
      params: { serverName: 'local-server' }
    })

    expect(() => parseCliArguments(['mcp', 'add', '--name', 'local-server'], {})).toThrow(
      'requires --stdin'
    )
    expect(() => parseCliArguments(['mcp', 'update', '--stdin'], {})).toThrow('requires --name')
    expect(() => parseCliArguments(['mcp', 'list', '--name', 'unexpected'], {})).toThrow(
      '--name is not valid'
    )
  })

  it('leaves enough time for approvals and large artifact delivery by default', () => {
    expect(
      parseCliArguments(['provider', 'remove', '--provider', 'provider-1'], {}).timeoutMs
    ).toBe(DEFAULT_MUTATION_TIMEOUT_MS)
    expect(parseCliArguments(['skill', 'enable', '--name', 'skill-1'], {}).timeoutMs).toBe(
      DEFAULT_MUTATION_TIMEOUT_MS
    )
    expect(
      parseCliArguments(
        ['artifact', 'get', '--id', 'artifact_identifier_123', '--out', './output.bin'],
        {}
      ).timeoutMs
    ).toBe(DEFAULT_COMPUTE_TIMEOUT_MS)
  })

  it('keeps MCP commands discoverable', () => {
    expect(formatCliHelp({ domain: 'mcp', verb: 'add' })).toContain('--name <name> --stdin')
    expect(formatCliHelp()).toContain('mcp remove')
  })
})
