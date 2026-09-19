import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'

const alertDialogStub = defineComponent({
  name: 'AlertDialog',
  props: {
    open: { type: Boolean, default: false }
  },
  emits: ['update:open'],
  template: '<div data-testid="alert-dialog" :data-open="String(open)"><slot /></div>'
})

const actionStub = defineComponent({
  name: 'AlertDialogAction',
  emits: ['click'],
  template: '<button type="button" @click="$emit(\'click\')"><slot /></button>'
})

const cancelStub = defineComponent({
  name: 'AlertDialogCancel',
  emits: ['click'],
  template: '<button type="button" @click="$emit(\'click\')"><slot /></button>'
})

const passthroughStub = (name: string) =>
  defineComponent({
    name,
    template: '<div><slot /></div>'
  })

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

describe('UpdateTaskCheckDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not emit cancel when dialog closes via open state change', async () => {
    const { default: UpdateTaskCheckDialog } =
      await import('../../../src/renderer/src/components/ui/UpdateTaskCheckDialog.vue')

    const wrapper = mount(UpdateTaskCheckDialog, {
      props: {
        open: true
      },
      global: {
        stubs: {
          AlertDialog: alertDialogStub,
          AlertDialogAction: actionStub,
          AlertDialogCancel: cancelStub,
          AlertDialogContent: passthroughStub('AlertDialogContent'),
          AlertDialogDescription: passthroughStub('AlertDialogDescription'),
          AlertDialogFooter: passthroughStub('AlertDialogFooter'),
          AlertDialogHeader: passthroughStub('AlertDialogHeader'),
          AlertDialogTitle: passthroughStub('AlertDialogTitle'),
          Icon: true
        }
      }
    })

    await wrapper.findComponent(alertDialogStub).vm.$emit('update:open', false)

    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })

  it('emits cancel only when cancel button is clicked', async () => {
    const { default: UpdateTaskCheckDialog } =
      await import('../../../src/renderer/src/components/ui/UpdateTaskCheckDialog.vue')

    const wrapper = mount(UpdateTaskCheckDialog, {
      props: {
        open: true
      },
      global: {
        stubs: {
          AlertDialog: alertDialogStub,
          AlertDialogAction: actionStub,
          AlertDialogCancel: cancelStub,
          AlertDialogContent: passthroughStub('AlertDialogContent'),
          AlertDialogDescription: passthroughStub('AlertDialogDescription'),
          AlertDialogFooter: passthroughStub('AlertDialogFooter'),
          AlertDialogHeader: passthroughStub('AlertDialogHeader'),
          AlertDialogTitle: passthroughStub('AlertDialogTitle'),
          Icon: true
        }
      }
    })

    const buttons = wrapper.findAll('button')
    await buttons[0].trigger('click')

    expect(wrapper.emitted('cancel')).toEqual([[]])
  })
})
