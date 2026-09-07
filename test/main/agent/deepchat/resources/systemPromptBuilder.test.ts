import type { ProviderSettingsPort } from '@/provider/settings'
import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'

import type { DeepChatAgentInstance } from '@/agent/deepchat/instance/deepChatAgentInstance'
import {
  appendCliProgrammaticToolAdapterSection,
  buildSystemPromptAssemblyWithSkills,
  buildSystemPromptWithSkills
} from '@/agent/deepchat/resources/systemPromptBuilder'
import {
  assemblePromptSections,
  createPromptAssemblySection
} from '@/agent/deepchat/resources/promptAssembly'
import { LIVE_DELEGATION_AGENT_TOOL_NAME } from '@shared/agentTools'
import { UNTRUSTED_CHILD_OUTPUT_POLICY } from '@shared/orchestration/resultSafety'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

describe('DeepChat system prompt builder', () => {
  it('appends one fixed CLI Programmatic adapter section', () => {
    const baseAssembly = assemblePromptSections([
      createPromptAssemblySection({
        kind: 'configured_prompt',
        sourceRef: 'test:configured-prompt',
        content: 'BASE PROMPT'
      })
    ])

    const first = appendCliProgrammaticToolAdapterSection(baseAssembly)
    const second = appendCliProgrammaticToolAdapterSection(first)

    expect(second).toBe(first)
    expect(first.sections).toHaveLength(2)
    expect(first.sections[1]).toMatchObject({
      kind: 'tooling',
      sourceRef: 'runtime:cli-programmatic-tool-adapter',
      inclusion: 'included'
    })
    expect(first.prompt).toContain('## Programmatic Tool Access')
    expect(first.prompt).toContain('Discovery does not authorize a target.')
    expect(first.prompt).toContain('rechecks current authority and policy before execution')
    expect(first.prompt).toContain('Pass call and batch JSON through the `exec` stdin field')
    expect(first.prompt).toContain('--target <name>')
    expect(first.prompt).toContain('Describe targets may use exact double quotes')
    expect(first.prompt).toContain('never use single quotes or escapes')
    expect(first.prompt).toContain('Omit the `timeoutMs`, `background`, and `yieldMs` exec fields')
  })

  it('rejects an invalid command shell before optional prompt contributors can mask it', async () => {
    const assertCurrent = vi.fn()

    await expect(
      buildSystemPromptWithSkills(
        { assertCurrent } as never,
        {
          commandShell: { ...POSIX_COMMAND_SHELL, pathStyle: 'win32' }
        } as never
      )
    ).rejects.toThrow()

    expect(assertCurrent).not.toHaveBeenCalled()
  })

  it('assembles byte-identical prompts without a composed-prompt memo', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => true,
      getProjectDir: () => '/tmp/deepchat-system-prompt-builder-test-no-agents'
    } as unknown as DeepChatAgentInstance
    const assertCurrent = vi.fn()
    const dependencies = {
      providerSettings: {} as unknown as ProviderSettingsPort,
      skillSettings: {
        isEnabled: () => false,
        isDraftSuggestionsEnabled: () => false
      },
      providerCatalogPort: {
        getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
        getCustomModels: () => []
      },
      skillService: {
        getMetadataList: vi.fn().mockResolvedValue([]),
        getAllSkills: vi.fn().mockResolvedValue([]),
        getActiveSkills: vi.fn().mockResolvedValue([]),
        loadSkillContent: vi.fn(),
        resolveSessionAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      toolService: {
        buildToolSystemPrompt: vi.fn().mockReturnValue('')
      },
      assertCurrent,
      isAcpBackedSubagentSession: () => false,
      resolveProjectDir: () => null,
      logSlowStep: vi.fn()
    }

    const first = await buildSystemPromptWithSkills(dependencies, {
      sessionId: 'session-1',
      basePrompt: '  BASE PROMPT  ',
      toolDefinitions: [],
      commandShell: POSIX_COMMAND_SHELL,
      resourceInstance: instance
    })
    const second = await buildSystemPromptWithSkills(dependencies, {
      sessionId: 'session-1',
      basePrompt: '  BASE PROMPT  ',
      toolDefinitions: [],
      commandShell: POSIX_COMMAND_SHELL,
      resourceInstance: instance
    })
    const assembly = await buildSystemPromptAssemblyWithSkills(dependencies, {
      sessionId: 'session-1',
      basePrompt: '  BASE PROMPT  ',
      toolDefinitions: [],
      commandShell: POSIX_COMMAND_SHELL,
      resourceInstance: instance
    })
    const acpAssembly = await buildSystemPromptAssemblyWithSkills(
      { ...dependencies, isAcpBackedSubagentSession: () => true },
      {
        sessionId: 'session-1',
        basePrompt: '  BASE PROMPT  ',
        toolDefinitions: [],
        commandShell: POSIX_COMMAND_SHELL,
        resourceInstance: instance
      }
    )
    const explicit = await buildSystemPromptWithSkills(dependencies, {
      sessionId: 'session-1',
      basePrompt: '  BASE PROMPT  ',
      toolDefinitions: [
        {
          source: 'agent',
          server: { name: 'subagents' },
          function: { name: LIVE_DELEGATION_AGENT_TOOL_NAME }
        }
      ] as any,
      orchestrationPolicy: 'explicit',
      commandShell: POSIX_COMMAND_SHELL,
      resourceInstance: instance
    })
    const proactive = await buildSystemPromptWithSkills(dependencies, {
      sessionId: 'session-1',
      basePrompt: '  BASE PROMPT  ',
      toolDefinitions: [
        {
          source: 'agent',
          server: { name: 'subagents' },
          function: { name: LIVE_DELEGATION_AGENT_TOOL_NAME }
        }
      ] as any,
      orchestrationPolicy: 'proactive',
      commandShell: POSIX_COMMAND_SHELL,
      resourceInstance: instance
    })
    const sameNameMcp = await buildSystemPromptWithSkills(dependencies, {
      sessionId: 'session-1',
      basePrompt: '  BASE PROMPT  ',
      toolDefinitions: [
        {
          source: 'mcp',
          server: { name: 'third-party' },
          function: { name: 'workflow' }
        }
      ] as any,
      commandShell: POSIX_COMMAND_SHELL,
      resourceInstance: instance
    })

    expect(first).toContain('BASE PROMPT')
    expect(first).toContain('You are powered by the model named GPT-4o.')
    expect(first).toContain('## Verification Policy')
    expect(first).not.toContain('## Multi-Agent Orchestration Policy')
    expect(second).toBe(first)
    expect(assembly.prompt).toBe(first)
    expect(acpAssembly).toMatchObject({
      prompt: 'BASE PROMPT',
      sections: [{ kind: 'configured_prompt', inclusion: 'included' }]
    })
    expect(first).toBe(
      [
        'BASE PROMPT',
        [
          'You are powered by the model named GPT-4o.',
          'The exact model ID is openai/gpt-4o',
          'Here is some useful information about the environment you are running in:',
          '<env>',
          'Working directory: /tmp/deepchat-system-prompt-builder-test-no-agents',
          'Is directory a git repo: no',
          `Platform: ${process.platform}`,
          'Shell: sh.',
          `Today's date: ${new Date().toDateString()}`,
          '</env>'
        ].join('\n'),
        [
          '## Verification Policy',
          'After changing code, configuration, tests, docs that affect behavior, or generated assets, check verification status before the final response.',
          'If verification was not run, state the reason explicitly in the final response.'
        ].join('\n')
      ].join('\n\n')
    )
    expect(assembly.sections.map((section) => section.kind)).toEqual([
      'configured_prompt',
      'runtime_capabilities',
      'system_environment',
      'agents_instructions',
      'skills_metadata',
      'pinned_skills',
      'tooling',
      'orchestration_policy',
      'permission_rules',
      'verification_policy'
    ])
    expect(assembly.sections.find((section) => section.kind === 'configured_prompt')).toMatchObject(
      {
        inclusion: 'included',
        contentHash: '2f438783cf88972d8d9fd3394aac256edde99cd6d9a8e9166aff93ec5bcfc2c4'
      }
    )
    expect(explicit).toContain('## Multi-Agent Orchestration Policy')
    expect(explicit).toContain('explicit multi-Agent collaboration')
    expect(explicit).toContain('user, an active Skill, or project instructions explicitly request')
    expect(explicit).toContain(`Use \`${LIVE_DELEGATION_AGENT_TOOL_NAME}\``)
    expect(explicit).toContain('`send` for non-triggering context')
    expect(explicit).toContain(UNTRUSTED_CHILD_OUTPUT_POLICY)
    expect(proactive).toContain('enabled proactive multi-Agent collaboration')
    expect(proactive).toContain('Never delegate merely to demonstrate')
    expect(sameNameMcp).not.toContain('## Multi-Agent Orchestration Policy')
    expect(assertCurrent).toHaveBeenCalled()
  })

  it('does not project active Skill bodies without Tape-materialized overrides', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => false
    } as unknown as DeepChatAgentInstance
    const loadSkillContent = vi.fn(async (_agentId: string, skillName: string) => ({
      name: skillName,
      content: `${skillName} instructions`
    }))

    const prompt = await buildSystemPromptWithSkills(
      {
        providerSettings: {} as unknown as ProviderSettingsPort,
        skillSettings: {
          isEnabled: () => true,
          isDraftSuggestionsEnabled: () => false
        },
        providerCatalogPort: {
          getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
          getCustomModels: () => []
        },
        skillService: {
          resolveSessionAgentId: vi.fn().mockResolvedValue('writer'),
          getMetadataList: vi.fn().mockResolvedValue([
            { name: 'skill-a', description: 'Skill A' },
            { name: 'skill-b', description: 'Skill B' }
          ]),
          getAllSkills: vi.fn().mockResolvedValue([
            { name: 'skill-a', description: 'Skill A' },
            { name: 'skill-b', description: 'Skill B' }
          ]),
          getActiveSkills: vi.fn().mockResolvedValue(['skill-a', 'skill-b']),
          loadSkillContent
        },
        toolService: { buildToolSystemPrompt: vi.fn().mockReturnValue('') },
        assertCurrent: vi.fn(),
        isAcpBackedSubagentSession: () => false,
        resolveProjectDir: () => null,
        logSlowStep: vi.fn()
      },
      {
        sessionId: 'session-1',
        basePrompt: '',
        toolDefinitions: [
          {
            source: 'agent',
            server: { name: 'agent-skills' },
            function: { name: 'skill_list' }
          }
        ] as any,
        activeSkillNamesOverride: ['skill-a', 'skill-b'],
        commandShell: POSIX_COMMAND_SHELL,
        resourceInstance: instance
      }
    )

    expect(prompt).not.toContain('### skill-a')
    expect(prompt).not.toContain('### skill-b')
    expect(prompt).toContain('- skill-a: Skill A')
    expect(prompt).toContain('- skill-b: Skill B')
    expect(prompt).toContain('use `skill_list` with a query')
    expect(prompt).not.toContain('call `skill_view` first')
    expect(prompt).not.toContain('Viewing a skill root')
    expect(loadSkillContent).not.toHaveBeenCalled()
  })

  it('keeps routing catalog bytes stable across message-scoped activation changes', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => false
    } as unknown as DeepChatAgentInstance
    const compactCatalog = [
      { name: 'skill-a', description: 'Skill A routes alpha tasks' },
      { name: 'skill-b', description: 'Skill B routes beta tasks' }
    ]
    const getMetadataList = vi.fn().mockResolvedValue(compactCatalog)
    const dependencies = {
      providerSettings: {} as unknown as ProviderSettingsPort,
      skillSettings: {
        isEnabled: () => true,
        isDraftSuggestionsEnabled: () => false
      },
      providerCatalogPort: {
        getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
        getCustomModels: () => []
      },
      skillService: {
        resolveSessionAgentId: vi.fn().mockResolvedValue('writer'),
        getMetadataList,
        getActiveSkills: vi.fn().mockResolvedValue([]),
        loadSkillContent: vi.fn(async (_agentId: string, skillName: string) => ({
          name: skillName,
          content: `${skillName} instructions`
        }))
      },
      toolService: { buildToolSystemPrompt: vi.fn().mockReturnValue('') },
      assertCurrent: vi.fn(),
      isAcpBackedSubagentSession: () => false,
      resolveProjectDir: () => null,
      logSlowStep: vi.fn()
    }
    const toolDefinitions = [
      {
        source: 'agent',
        server: { name: 'agent-skills' },
        function: { name: 'skill_list' }
      },
      {
        source: 'agent',
        server: { name: 'agent-skills' },
        function: { name: 'skill_view' }
      }
    ] as any
    const build = async (activeSkillNamesOverride: string[]) =>
      await buildSystemPromptAssemblyWithSkills(dependencies, {
        sessionId: 'session-1',
        basePrompt: '',
        toolDefinitions,
        activeSkillNamesOverride,
        sessionActiveSkillNamesOverride: [],
        contextLength: 8_000,
        commandShell: POSIX_COMMAND_SHELL,
        resourceInstance: instance
      })

    const first = await build(['skill-a'])
    const second = await build(['skill-b'])

    expect(first.sections.find((section) => section.kind === 'skills_metadata')?.content).toBe(
      second.sections.find((section) => section.kind === 'skills_metadata')?.content
    )
    expect(
      first.sections.find((section) => section.kind === 'skills_metadata')?.degradationCodes ?? []
    ).not.toContain('skill_catalog_omitted')

    getMetadataList.mockResolvedValue(
      Array.from({ length: 100 }, (_, index) => ({
        name: `catalog-${index}`,
        description: `Catalog entry ${index} ${'detail '.repeat(100)}`
      }))
    )
    const omitted = await build([])
    expect(
      omitted.sections.find((section) => section.kind === 'skills_metadata')?.degradationCodes
    ).toContain('skill_catalog_omitted')
  })

  it('does not bypass materialization when catalog metadata is temporarily unavailable', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => false
    } as unknown as DeepChatAgentInstance
    const loadSkillContent = vi.fn().mockResolvedValue({
      name: 'skill-a',
      content: 'skill-a instructions'
    })

    try {
      const assembly = await buildSystemPromptAssemblyWithSkills(
        {
          providerSettings: {} as unknown as ProviderSettingsPort,
          skillSettings: {
            isEnabled: () => true,
            isDraftSuggestionsEnabled: () => false
          },
          providerCatalogPort: {
            getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
            getCustomModels: () => []
          },
          skillService: {
            resolveSessionAgentId: vi.fn().mockResolvedValue('writer'),
            getMetadataList: vi.fn().mockRejectedValue(new Error('catalog unavailable')),
            getAllSkills: vi.fn().mockRejectedValue(new Error('catalog unavailable')),
            getActiveSkills: vi.fn().mockResolvedValue([]),
            loadSkillContent
          },
          toolService: { buildToolSystemPrompt: vi.fn().mockReturnValue('') },
          assertCurrent: vi.fn(),
          isAcpBackedSubagentSession: () => false,
          resolveProjectDir: () => null,
          logSlowStep: vi.fn()
        },
        {
          sessionId: 'session-1',
          basePrompt: '',
          toolDefinitions: [],
          activeSkillNamesOverride: ['skill-a'],
          commandShell: POSIX_COMMAND_SHELL,
          resourceInstance: instance
        }
      )

      expect(loadSkillContent).not.toHaveBeenCalled()
      expect(assembly.prompt).not.toContain('### skill-a\nskill-a instructions')
      expect(assembly.sections.find((section) => section.kind === 'skills_metadata')).toMatchObject({
        inclusion: 'omitted',
        degradationCodes: ['skill_metadata_unavailable']
      })
      const pinnedSkills = assembly.sections.find((section) => section.kind === 'pinned_skills')
      expect(pinnedSkills).toMatchObject({ inclusion: 'omitted' })
      expect(pinnedSkills).not.toHaveProperty('degradationCodes')
    } finally {
      consoleWarn.mockRestore()
    }
  })

  it('renders exact Session Skill overrides without reading cached Skill content', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const loadSkillContent = vi.fn()
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => false
    } as unknown as DeepChatAgentInstance
    const dependencies = {
      providerSettings: {} as unknown as ProviderSettingsPort,
      skillSettings: {
        isEnabled: () => true,
        isDraftSuggestionsEnabled: () => false
      },
      providerCatalogPort: {
        getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
        getCustomModels: () => []
      },
      skillService: {
        resolveSessionAgentId: vi.fn().mockResolvedValue('writer'),
        getMetadataList: vi.fn().mockResolvedValue([
          { name: 'skill-a', description: 'Skill A' },
          { name: 'skill-b', description: 'Skill B' }
        ]),
        getActiveSkills: vi.fn(),
        loadSkillContent
      },
      toolService: { buildToolSystemPrompt: vi.fn().mockReturnValue('') },
      assertCurrent: vi.fn(),
      isAcpBackedSubagentSession: () => false,
      resolveProjectDir: () => null,
      logSlowStep: vi.fn()
    }

    const assembly = await buildSystemPromptAssemblyWithSkills(dependencies, {
      sessionId: 'session-1',
      basePrompt: '',
      toolDefinitions: [],
      activeSkillNamesOverride: ['skill-a'],
      sessionActiveSkillNamesOverride: ['skill-a'],
      sessionSkillBodiesOverride: [{ name: 'skill-a', content: 'exact materialized body' }],
      commandShell: POSIX_COMMAND_SHELL,
      resourceInstance: instance
    })

    expect(loadSkillContent).not.toHaveBeenCalled()
    expect(assembly.sections.find((section) => section.kind === 'pinned_skills')?.content).toBe(
      [
        '## Active Skills',
        'These Session Skills are persistent context for this conversation. Follow them when relevant.',
        '',
        '### skill-a',
        'exact materialized body'
      ].join('\n')
    )
    await expect(
      buildSystemPromptAssemblyWithSkills(dependencies, {
        sessionId: 'session-1',
        basePrompt: '',
        toolDefinitions: [],
        activeSkillNamesOverride: ['skill-a'],
        sessionActiveSkillNamesOverride: ['skill-a'],
        sessionSkillBodiesOverride: [{ name: 'skill-b', content: 'wrong body' }],
        commandShell: POSIX_COMMAND_SHELL,
        resourceInstance: instance
      })
    ).rejects.toThrow('does not match the active Skill set')
  })

  it('observes model, tool prompt, and package script changes on the next assembly', async () => {
    let modelName = 'Model One'
    let toolPrompt = 'TOOL PROMPT ONE'
    let packageJson = JSON.stringify({
      name: 'example',
      scripts: { verify: 'vitest run' }
    })
    vi.mocked(fs.existsSync).mockImplementation((filePath) =>
      String(filePath).endsWith('package.json')
    )
    vi.mocked(fs.readFileSync).mockImplementation(() => packageJson)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'dynamic-model' }),
      hasProjectDir: () => true,
      getProjectDir: () => '/tmp/dynamic-system-prompt'
    } as unknown as DeepChatAgentInstance
    const dependencies = {
      providerSettings: {} as unknown as ProviderSettingsPort,
      skillSettings: {
        isEnabled: () => false,
        isDraftSuggestionsEnabled: () => false
      },
      providerCatalogPort: {
        getProviderModels: () => [{ id: 'dynamic-model', name: modelName }],
        getCustomModels: () => []
      },
      skillService: {
        getMetadataList: vi.fn().mockResolvedValue([]),
        getAllSkills: vi.fn().mockResolvedValue([]),
        getActiveSkills: vi.fn().mockResolvedValue([]),
        loadSkillContent: vi.fn(),
        resolveSessionAgentId: vi.fn().mockResolvedValue('deepchat')
      },
      toolService: {
        buildToolSystemPrompt: vi.fn(() => toolPrompt)
      },
      assertCurrent: vi.fn(),
      isAcpBackedSubagentSession: () => false,
      resolveProjectDir: () => null,
      logSlowStep: vi.fn()
    }
    const input = {
      sessionId: 'session-1',
      basePrompt: 'Base',
      toolDefinitions: [],
      commandShell: POSIX_COMMAND_SHELL,
      resourceInstance: instance
    }

    const first = await buildSystemPromptWithSkills(dependencies, input)
    modelName = 'Model Two'
    toolPrompt = 'TOOL PROMPT TWO'
    packageJson = JSON.stringify({
      name: 'example',
      scripts: { check: 'tsgo --noEmit' }
    })
    const second = await buildSystemPromptWithSkills(dependencies, input)

    expect(first).toContain('Model One')
    expect(first).toContain('TOOL PROMPT ONE')
    expect(first).toContain('`verify`')
    expect(second).toContain('Model Two')
    expect(second).toContain('TOOL PROMPT TWO')
    expect(second).toContain('`check`')
    expect(second).not.toContain('TOOL PROMPT ONE')
    expect(second).not.toContain('`verify`')
    expect(fs.readFileSync).toHaveBeenCalledTimes(2)
  })

  it('does not load unmaterialized Skill bodies when tooling degrades', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => true,
      getProjectDir: () => '/tmp/deepchat-system-prompt-builder-degraded'
    } as unknown as DeepChatAgentInstance

    try {
      const assembly = await buildSystemPromptAssemblyWithSkills(
        {
          providerSettings: {} as unknown as ProviderSettingsPort,
          skillSettings: {
            isEnabled: () => true,
            isDraftSuggestionsEnabled: () => false
          },
          providerCatalogPort: {
            getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
            getCustomModels: () => []
          },
          skillService: {
            resolveSessionAgentId: vi.fn().mockResolvedValue('writer'),
            getMetadataList: vi.fn().mockResolvedValue([
              { name: 'skill-a', description: 'Skill A' },
              { name: 'skill-b', description: 'Skill B' }
            ]),
            getAllSkills: vi.fn().mockResolvedValue([
              { name: 'skill-a', description: 'Skill A' },
              { name: 'skill-b', description: 'Skill B' }
            ]),
            getActiveSkills: vi.fn().mockResolvedValue([]),
            loadSkillContent: vi.fn()
          },
          toolService: {
            buildToolSystemPrompt: vi.fn(() => {
              throw new Error('tooling unavailable')
            })
          },
          assertCurrent: vi.fn(),
          isAcpBackedSubagentSession: () => false,
          resolveProjectDir: () => null,
          logSlowStep: vi.fn()
        },
        {
          sessionId: 'session-1',
          basePrompt: '',
          toolDefinitions: [],
          activeSkillNamesOverride: ['skill-a', 'skill-b'],
          commandShell: POSIX_COMMAND_SHELL,
          resourceInstance: instance
        }
      )

      expect(assembly.prompt).not.toContain('### skill-a')
      expect(assembly.prompt).not.toContain('### skill-b')
      const pinnedSkills = assembly.sections.find((section) => section.kind === 'pinned_skills')
      expect(pinnedSkills).toMatchObject({ inclusion: 'omitted' })
      expect(pinnedSkills).not.toHaveProperty('degradationCodes')
      expect(assembly.sections.find((section) => section.kind === 'tooling')).toMatchObject({
        inclusion: 'omitted',
        degradationCodes: ['tooling_build_failed']
      })
    } finally {
      consoleWarn.mockRestore()
    }
  })

  it('records a missing scoped Agent identity even when resolution returns null', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' })
    )
    const instance = {
      getRuntimeState: () => ({ providerId: 'openai', modelId: 'gpt-4o' }),
      hasProjectDir: () => true,
      getProjectDir: () => '/tmp/deepchat-system-prompt-builder-no-agent'
    } as unknown as DeepChatAgentInstance

    const assembly = await buildSystemPromptAssemblyWithSkills(
      {
        providerSettings: {} as unknown as ProviderSettingsPort,
        skillSettings: {
          isEnabled: () => true,
          isDraftSuggestionsEnabled: () => false
        },
        providerCatalogPort: {
          getProviderModels: () => [{ id: 'gpt-4o', name: 'GPT-4o' }],
          getCustomModels: () => []
        },
        skillService: {
          resolveSessionAgentId: vi.fn().mockResolvedValue(null),
          getMetadataList: vi.fn().mockResolvedValue([]),
          getAllSkills: vi.fn().mockResolvedValue([]),
          getActiveSkills: vi.fn().mockResolvedValue([]),
          loadSkillContent: vi.fn()
        },
        toolService: { buildToolSystemPrompt: vi.fn().mockReturnValue('') },
        assertCurrent: vi.fn(),
        isAcpBackedSubagentSession: () => false,
        resolveProjectDir: () => null,
        logSlowStep: vi.fn()
      },
      {
        sessionId: 'session-1',
        basePrompt: '',
        toolDefinitions: [],
        commandShell: POSIX_COMMAND_SHELL,
        resourceInstance: instance
      }
    )

    expect(assembly.sections.find((section) => section.kind === 'skills_metadata')).toMatchObject({
      inclusion: 'omitted',
      degradationCodes: ['skill_agent_unavailable']
    })
    expect(assembly.sections.find((section) => section.kind === 'pinned_skills')).toMatchObject({
      inclusion: 'omitted',
      degradationCodes: ['skill_agent_unavailable']
    })
  })
})
