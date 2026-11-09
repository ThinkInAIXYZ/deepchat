import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DimQuestionBatch from '@/components/chat/DimQuestionBatch.vue'

it('submits all native questions with intact multi-select labels and custom answers', async () => {
  const wrapper = mount(DimQuestionBatch, {
    props: {
      questions: [
        {
          id: 'colour',
          question: 'Colours?',
          options: [{ label: 'red, green' }, { label: 'blue' }],
          multiSelect: true,
          allowCustom: false
        },
        {
          id: 'language',
          question: 'Language?',
          options: [{ label: 'Rust' }, { label: 'TS' }],
          multiSelect: false,
          allowCustom: true
        }
      ]
    }
  })
  const confirm = () =>
    wrapper.findAll('button').find((button) => button.text() === 'common.confirm')!
  expect(confirm().attributes('disabled')).toBeDefined()
  const groups = wrapper.findAll('fieldset')
  const choices = groups[0].findAll('[data-testid="dc-choice-option"]')
  await choices[0].trigger('click')
  await choices[1].trigger('click')
  await groups[1].get('input').setValue('Native plugin')
  await confirm().trigger('click')
  expect(wrapper.emitted('answer')).toEqual([
    [
      [
        { questionId: 'colour', selected: ['red, green', 'blue'] },
        { questionId: 'language', selected: [], custom: 'Native plugin' }
      ]
    ]
  ])
  await wrapper.setProps({ processing: true })
  expect(confirm().attributes('disabled')).toBeDefined()
})
