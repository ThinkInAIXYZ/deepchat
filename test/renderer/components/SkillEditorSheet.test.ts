import { describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { SkillMetadata } from '../../../src/shared/types/skill'

const passthrough = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

const inputStub = defineComponent({
  name: 'Input',
  inheritAttrs: false,
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    }
  },
  emits: ['update:modelValue', 'update:model-value'],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const textareaStub = defineComponent({
  name: 'Textarea',
  inheritAttrs: false,
  props: {
    modelValue: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue'],
  template:
    '<textarea v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
})

const buttonStub = defineComponent({
  name: 'Button',
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
})

const skill: SkillMetadata = {
  name: 'write-tests',
  description: 'Write tests',
  path: '/skills/write-tests/SKILL.md',
  allowedTools: ['Read', 'Write']
} as SkillMetadata

describe('SkillEditorSheet', () => {
  async function setup() {
    vi.resetModules()

    const skillClient = {
      readSkillFile: vi.fn().mockResolvedValue(`---
name: write-tests
description: Write tests
---

Use tests well.`)
    }
    const skillsStore = reactive({
      skillExtensions: {},
      skillScripts: {},
      loadSkillRuntime: vi.fn().mockResolvedValue(undefined),
      saveSkillWithExtension: vi.fn().mockResolvedValue({ success: true })
    })

    vi.doMock('@api/SkillClient', () => ({
      createSkillClient: () => skillClient
    }))
    vi.doMock('@/stores/skillsStore', () => ({
      useSkillsStore: () => skillsStore
    }))
    vi.doMock('@/components/use-toast', () => ({
      useToast: () => ({ toast: vi.fn() })
    }))
    vi.doMock('vue-i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key
      })
    }))

    const SkillEditorSheet = (
      await import('../../../src/renderer/settings/components/skills/SkillEditorSheet.vue')
    ).default
    const wrapper = mount(SkillEditorSheet, {
      props: {
        skill,
        open: true
      },
      global: {
        stubs: {
          Badge: passthrough('Badge'),
          Button: buttonStub,
          Input: inputStub,
          Label: passthrough('Label'),
          ScrollArea: passthrough('ScrollArea'),
          Select: passthrough('Select'),
          SelectContent: passthrough('SelectContent'),
          SelectItem: passthrough('SelectItem'),
          SelectTrigger: passthrough('SelectTrigger'),
          SelectValue: passthrough('SelectValue'),
          Separator: passthrough('Separator'),
          Sheet: passthrough('Sheet'),
          SheetContent: passthrough('SheetContent'),
          SheetDescription: passthrough('SheetDescription'),
          SheetFooter: passthrough('SheetFooter'),
          SheetHeader: passthrough('SheetHeader'),
          SheetTitle: passthrough('SheetTitle'),
          SkillFolderTree: passthrough('SkillFolderTree'),
          Switch: passthrough('Switch'),
          Textarea: textareaStub
        }
      }
    })
    await flushPromises()

    return {
      wrapper,
      skillClient,
      skillsStore
    }
  }

  it('loads skill content through SkillClient', async () => {
    const { wrapper, skillClient, skillsStore } = await setup()

    expect(skillClient.readSkillFile).toHaveBeenCalledWith('write-tests')
    expect(skillsStore.loadSkillRuntime).toHaveBeenCalledWith('write-tests')
    expect((wrapper.get('#skill-content').element as HTMLTextAreaElement).value).toBe(
      'Use tests well.'
    )
  })
})
