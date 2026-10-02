import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ModelType } from '@shared/model'

const passthrough = defineComponent({ template: '<div><slot /></div>' })
const selectStub = defineComponent({
  name: 'Select',
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template: '<div><slot /></div>'
})

async function setup() {
  vi.resetModules()
  const checkProvider = vi.fn().mockResolvedValue({ isOk: true, errorMsg: null })
  vi.doMock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
  vi.doMock('@/stores/providerStore', () => ({ useProviderStore: () => ({ checkProvider }) }))
  vi.doMock('@/stores/modelStore', () => ({
    useModelStore: () => ({
      allProviderModels: [
        {
          providerId: 'p1',
          models: [
            { id: 'text', name: 'Text', type: ModelType.Chat },
            { id: 'video', name: 'Video', type: ModelType.VideoGeneration },
            { id: 'image', name: 'Image', type: ModelType.ImageGeneration },
            { id: 'embed', name: 'Embedding', type: ModelType.Embedding }
          ]
        }
      ],
      customModels: [
        { providerId: 'p1', models: [{ id: 'custom', name: 'Custom', type: ModelType.Chat }] }
      ]
    })
  }))
  vi.doMock('@shadcn/components/ui/dialog', () =>
    Object.fromEntries(
      [
        'Dialog',
        'DialogContent',
        'DialogDescription',
        'DialogFooter',
        'DialogHeader',
        'DialogTitle'
      ].map((name) => [name, passthrough])
    )
  )
  vi.doMock('@shadcn/components/ui/select', () => ({
    Select: selectStub,
    SelectContent: passthrough,
    SelectItem: passthrough,
    SelectTrigger: passthrough,
    SelectValue: passthrough
  }))
  const component = (await import('@/components/settings/ModelCheckDialog.vue')).default
  const wrapper = mount(component, { props: { providerId: 'p1', open: true } })
  const choose = async (id: string) => {
    wrapper.findComponent(selectStub).vm.$emit('update:modelValue', id)
    await flushPromises()
  }
  return { wrapper, choose, checkProvider }
}

describe('text model checks', () => {
  it('offers only text models, includes custom models, and allows retry after a model error', async () => {
    const { wrapper, choose, checkProvider } = await setup()
    expect(
      wrapper
        .findAll('[data-testid="model-check-option"]')
        .map((item) => item.attributes('data-model-id'))
    ).toEqual(['text', 'custom'])
    checkProvider.mockResolvedValueOnce({ isOk: false, errorMsg: 'AccessDenied.Unpurchased' })
    await choose('text')
    await wrapper.get('[data-testid="model-check-submit"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="model-check-result"]').text()).toContain(
      'AccessDenied.Unpurchased'
    )
    await choose('custom')
    expect(wrapper.find('[data-testid="model-check-result"]').exists()).toBe(false)
    await wrapper.get('[data-testid="model-check-submit"]').trigger('click')
    await flushPromises()
    expect(checkProvider).toHaveBeenLastCalledWith('p1', 'custom')
    expect(wrapper.get('[data-testid="model-check-result"]').attributes('data-success')).toBe(
      'true'
    )
  })

  it('ignores a late result after closing and starting another check', async () => {
    const { wrapper, choose, checkProvider } = await setup()
    let finish!: (value: { isOk: boolean; errorMsg: string }) => void
    checkProvider.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await choose('text')
    await wrapper.get('[data-testid="model-check-submit"]').trigger('click')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await choose('custom')
    await wrapper.get('[data-testid="model-check-submit"]').trigger('click')
    await flushPromises()
    finish({ isOk: false, errorMsg: 'stale failure' })
    await flushPromises()
    expect(wrapper.get('[data-testid="model-check-result"]').attributes('data-success')).toBe(
      'true'
    )
    expect(wrapper.text()).not.toContain('stale failure')
  })
})
