import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import SessionSkillsIndicator from '@/components/chat-input/SessionSkillsIndicator.vue'

const PassThrough = defineComponent({
  template: '<div><slot /></div>'
})

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    label: String,
    tooltip: String
  },
  emits: ['click'],
  template: `
    <button
      v-bind="$attrs"
      :disabled="disabled"
      :aria-label="label || tooltip"
      @click="$emit('click')"
    >
      <slot />
    </button>
  `
})

const mountIndicator = (props: {
  activeSkills: string[]
  loading?: boolean
  removingSkill?: string | null
  disabled?: boolean
}) =>
  mount(SessionSkillsIndicator, {
    props,
    global: {
      stubs: {
        DcButton: ButtonStub,
        Popover: PassThrough,
        PopoverTrigger: PassThrough,
        PopoverContent: PassThrough
      },
      mocks: {
        $t: (key: string) => key
      }
    }
  })

describe('SessionSkillsIndicator', () => {
  it('lists persistent Session Skills and emits explicit removals', async () => {
    const wrapper = mountIndicator({ activeSkills: ['review', 'database-migration'] })

    expect(wrapper.text()).toContain('review')
    expect(wrapper.text()).toContain('database-migration')

    await wrapper.get('[data-skill-name="review"]').trigger('click')

    expect(wrapper.emitted('remove')).toEqual([['review']])
    expect(wrapper.get('[data-skill-name="review"]').attributes('aria-label')).toBe(
      'chat.pendingInput.remove: review'
    )
  })

  it('disables every removal while one full-list update is pending', () => {
    const wrapper = mountIndicator({
      activeSkills: ['review', 'database-migration'],
      removingSkill: 'review'
    })

    expect(wrapper.get('[data-skill-name="review"]').attributes('disabled')).toBeDefined()
    expect(
      wrapper.get('[data-skill-name="database-migration"]').attributes('disabled')
    ).toBeDefined()
  })

  it('disables removals while Session state is loading', () => {
    const wrapper = mountIndicator({ activeSkills: ['review'], loading: true })

    expect(wrapper.get('[data-skill-name="review"]').attributes('disabled')).toBeDefined()
  })
})
