import { describe, expect, it } from 'vitest'
import {
  appendPromptAssemblySection,
  assemblePromptSections,
  createOpaquePromptAssembly,
  createPromptAssemblySection,
  reconcilePromptAssembly,
  recordPromptAssemblyObservation
} from '@/agent/deepchat/resources/promptAssembly'
import type { DeepChatPromptDegradationCode } from '@shared/types/prompt-assembly'

describe('promptAssembly', () => {
  it('preserves explicit section separators and omits empty content', () => {
    const assembly = assemblePromptSections([
      createPromptAssemblySection({
        kind: 'configured_prompt',
        sourceRef: 'configured',
        content: 'Configured'
      }),
      createPromptAssemblySection({
        kind: 'agents_instructions',
        sourceRef: 'agents',
        content: 'Agents',
        separatorBefore: '\n'
      }),
      createPromptAssemblySection({
        kind: 'tooling',
        sourceRef: 'tooling',
        content: ''
      }),
      createPromptAssemblySection({
        kind: 'verification_policy',
        sourceRef: 'verification',
        content: 'Verify'
      })
    ])

    expect(assembly.prompt).toBe('Configured\nAgents\n\nVerify')
    expect(assembly.sections[2]).toMatchObject({ inclusion: 'omitted', content: '' })
    expect(Object.isFrozen(assembly)).toBe(true)
    expect(Object.isFrozen(assembly.sections)).toBe(true)
  })

  it('deduplicates degradation codes in deterministic order', () => {
    const section = createPromptAssemblySection({
      kind: 'tooling',
      sourceRef: 'tooling',
      content: 'Tools',
      degradationCodes: ['tooling_build_failed', 'environment_build_failed', 'tooling_build_failed']
    })

    expect(section.degradationCodes).toEqual(['environment_build_failed', 'tooling_build_failed'])
  })

  it('snapshots caller-owned sections at every assembly boundary', () => {
    const degradationCodes: DeepChatPromptDegradationCode[] = ['tooling_build_failed']
    const section = {
      ...createPromptAssemblySection({
        kind: 'tooling',
        sourceRef: 'tooling',
        content: 'Tools'
      }),
      degradationCodes
    }
    section.content = 'Snapshot'
    const assembled = assemblePromptSections([section])
    const appended = appendPromptAssemblySection(assemblePromptSections([]), section)
    const observed = recordPromptAssemblyObservation(assemblePromptSections([]), section)
    const expected = createPromptAssemblySection({
      kind: 'tooling',
      sourceRef: 'tooling',
      content: 'Snapshot',
      degradationCodes
    })

    section.content = 'Changed'
    degradationCodes.push('environment_build_failed')

    expect(assembled.prompt).toBe('Snapshot')
    expect(appended.prompt).toBe('Snapshot')
    for (const assembly of [assembled, appended, observed]) {
      expect(assembly.sections[0]).toMatchObject({
        content: 'Snapshot',
        contentHash: expected.contentHash,
        inclusion: 'degraded',
        degradationCodes: ['tooling_build_failed']
      })
      expect(assembly.sections[0]).not.toBe(section)
      expect(Object.isFrozen(assembly.sections[0])).toBe(true)
      expect(Object.isFrozen(assembly.sections[0]?.degradationCodes)).toBe(true)
    }

    const duplicateSource = { ...expected }
    const duplicateAssembly = appendPromptAssemblySection(
      { prompt: 'Snapshot', sections: [duplicateSource] },
      duplicateSource
    )
    duplicateSource.content = 'Changed duplicate'

    expect(duplicateAssembly.sections[0]?.content).toBe('Snapshot')
    expect(Object.isFrozen(duplicateAssembly)).toBe(true)
    expect(Object.isFrozen(duplicateAssembly.sections[0])).toBe(true)

    const frozenStaleSection = Object.freeze({ ...expected, content: 'Frozen snapshot' })
    const frozenStaleAssembly = assemblePromptSections([frozenStaleSection])
    const frozenExpected = createPromptAssemblySection({
      kind: 'tooling',
      sourceRef: 'tooling',
      content: 'Frozen snapshot',
      degradationCodes
    })

    expect(frozenStaleAssembly.sections[0]?.contentHash).toBe(frozenExpected.contentHash)
  })

  it('keeps matching provenance and degrades mismatched projections to the effective prompt', () => {
    const declared = assemblePromptSections([
      createPromptAssemblySection({
        kind: 'configured_prompt',
        sourceRef: 'configured',
        content: 'Declared'
      })
    ])

    expect(reconcilePromptAssembly(declared, 'Declared')).toBe(declared)

    const reconciled = reconcilePromptAssembly(declared, 'Effective')
    expect(reconciled).toMatchObject({
      prompt: 'Effective',
      sections: [
        {
          kind: 'effective_system_prompt',
          sourceRef: 'runtime:effective-system-message',
          inclusion: 'degraded',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          degradationCodes: ['prompt_projection_mismatch'],
          content: 'Effective'
        }
      ]
    })
  })

  it('preserves opaque and reconciled provider prompt bytes', () => {
    const opaquePrompt = '  Legacy prompt\n\n'
    const opaque = createOpaquePromptAssembly(opaquePrompt)

    expect(opaque.prompt).toBe(opaquePrompt)
    expect(opaque.sections[0]).toMatchObject({
      content: opaquePrompt,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      degradationCodes: ['legacy_prompt_provenance']
    })

    const effectivePrompt = '\n Effective prompt  '
    const reconciled = reconcilePromptAssembly(opaque, effectivePrompt)
    expect(reconciled.prompt).toBe(effectivePrompt)
    expect(reconciled.sections[0]).toMatchObject({
      content: effectivePrompt,
      degradationCodes: ['prompt_projection_mismatch']
    })
  })

  it('does not turn observed provenance into prompt content during a later append', () => {
    const configured = assemblePromptSections([
      createPromptAssemblySection({
        kind: 'configured_prompt',
        sourceRef: 'configured',
        content: 'Configured safety text'
      })
    ])
    const observed = recordPromptAssemblyObservation(
      configured,
      createPromptAssemblySection({
        kind: 'attachment_safety',
        sourceRef: 'runtime:attachment-text-safety',
        content: 'Configured safety text'
      })
    )
    const appended = appendPromptAssemblySection(
      observed,
      createPromptAssemblySection({
        kind: 'verification_policy',
        sourceRef: 'runtime:verification',
        content: 'Verify'
      })
    )

    expect(appended.prompt).toBe('Configured safety text\n\nVerify')
    expect(appended.sections).toHaveLength(3)
  })
})
