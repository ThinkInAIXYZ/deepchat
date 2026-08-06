import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import DcConfirmDialog from '../../../src/dc-ui/components/confirm-dialog/DcConfirmDialog.vue'
import DcSheetPanel from '../../../src/dc-ui/components/sheet-panel/DcSheetPanel.vue'
import DcToggleRow from '../../../src/dc-ui/components/toggle-row/DcToggleRow.vue'
import DcTooltip from '../../../src/dc-ui/components/tooltip/DcTooltip.vue'

const mountedWrappers: VueWrapper[] = []

const passthrough = (name: string) =>
  defineComponent({
    name,
    inheritAttrs: false,
    template: '<div v-bind="$attrs"><slot /></div>'
  })

const sheetContentStub = defineComponent({
  name: 'SheetContent',
  inheritAttrs: false,
  template: '<div data-testid="sheet-content" v-bind="$attrs"><slot /></div>'
})

const alertDialogStub = defineComponent({
  name: 'AlertDialog',
  inheritAttrs: false,
  emits: ['update:open'],
  template: '<div><slot /></div>'
})

const alertDialogCancelStub = defineComponent({
  name: 'AlertDialogCancel',
  inheritAttrs: false,
  emits: ['click'],
  template:
    '<button data-testid="cancel" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
})

const alertDialogAsyncActionStub = defineComponent({
  name: 'AlertDialogAsyncAction',
  inheritAttrs: false,
  emits: ['click'],
  template:
    '<button data-testid="confirm" v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>'
})

const tooltipProviderStub = defineComponent({
  name: 'TooltipProvider',
  props: {
    delayDuration: Number
  },
  template:
    '<div data-testid="tooltip-provider" :data-delay-duration="delayDuration"><slot /></div>'
})

const tooltipStub = defineComponent({
  name: 'Tooltip',
  props: {
    delayDuration: Number,
    ignoreNonKeyboardFocus: Boolean
  },
  template:
    '<div data-testid="tooltip" :data-delay-duration="delayDuration" :data-ignore-non-keyboard-focus="ignoreNonKeyboardFocus"><slot /></div>'
})

const tooltipTriggerStub = defineComponent({
  name: 'TooltipTrigger',
  props: {
    disabled: Boolean
  },
  template: '<div data-testid="tooltip-trigger" :data-disabled="disabled"><slot /></div>'
})

const tooltipContentStub = defineComponent({
  name: 'TooltipContent',
  props: {
    side: String,
    sideOffset: Number
  },
  template:
    '<div data-testid="tooltip-content" :data-side="side" :data-side-offset="sideOffset"><slot /></div>'
})

const labelStub = defineComponent({
  name: 'Label',
  inheritAttrs: false,
  template: '<label v-bind="$attrs"><slot /></label>'
})

const switchStub = defineComponent({
  name: 'Switch',
  props: {
    modelValue: Boolean,
    disabled: Boolean,
    ariaLabel: String
  },
  emits: ['update:modelValue'],
  template:
    '<button data-testid="switch" :aria-label="ariaLabel" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />'
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

const mountComponent = <T>(component: T, options: Parameters<typeof mount<T>>[1]) => {
  const wrapper = mount(component, options)
  mountedWrappers.push(wrapper)
  return wrapper
}

describe('DcSheetPanel width contract', () => {
  const stubs = {
    Sheet: passthrough('Sheet'),
    SheetContent: sheetContentStub,
    SheetDescription: passthrough('SheetDescription'),
    SheetFooter: passthrough('SheetFooter'),
    SheetHeader: passthrough('SheetHeader'),
    SheetTitle: passthrough('SheetTitle'),
    ScrollArea: passthrough('ScrollArea'),
    Icon: true
  }

  it('overrides the underlying small-screen max-width for default panels', () => {
    const wrapper = mountComponent(DcSheetPanel, {
      props: { open: true, title: 'Panel' },
      global: { stubs }
    })

    expect(wrapper.get('[data-testid="sheet-content"]').classes()).toEqual(
      expect.arrayContaining(['sm:w-[min(48rem,92vw)]', 'sm:max-w-[min(48rem,92vw)]'])
    )
  })

  it('preserves the plain preset and lets callers replace the width classes', () => {
    const plainWrapper = mountComponent(DcSheetPanel, {
      props: { open: true, title: 'Plain', appearance: 'plain' },
      global: { stubs }
    })
    const customWrapper = mountComponent(DcSheetPanel, {
      props: { open: true, title: 'Custom', widthClass: 'sm:max-w-[80vw]' },
      global: { stubs }
    })

    expect(plainWrapper.get('[data-testid="sheet-content"]').classes()).toContain('sm:max-w-xl')
    expect(customWrapper.get('[data-testid="sheet-content"]').classes()).toContain(
      'sm:max-w-[80vw]'
    )
  })
})

describe('DcConfirmDialog cancel contract', () => {
  const stubs = {
    AlertDialog: alertDialogStub,
    AlertDialogAsyncAction: alertDialogAsyncActionStub,
    AlertDialogCancel: alertDialogCancelStub,
    AlertDialogContent: passthrough('AlertDialogContent'),
    AlertDialogDescription: passthrough('AlertDialogDescription'),
    AlertDialogFooter: passthrough('AlertDialogFooter'),
    AlertDialogHeader: passthrough('AlertDialogHeader'),
    AlertDialogTitle: passthrough('AlertDialogTitle'),
    Icon: true,
    Spinner: true
  }

  it('emits cancellation once when the cancel button closes the dialog', async () => {
    const wrapper = mountComponent(DcConfirmDialog, {
      props: { open: true, title: 'Delete?' },
      global: { stubs }
    })

    await wrapper.get('[data-testid="cancel"]').trigger('click')
    await wrapper.findComponent(alertDialogStub).vm.$emit('update:open', false)

    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(wrapper.emitted('cancel')).toEqual([[]])
  })

  it('does not treat confirmation as cancellation', async () => {
    const wrapper = mountComponent(DcConfirmDialog, {
      props: { open: true, title: 'Delete?' },
      global: { stubs }
    })

    await wrapper.get('[data-testid="confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([[]])
    expect(wrapper.emitted('cancel')).toBeUndefined()
  })
})

describe('DcTooltip forwarding contract', () => {
  const stubs = {
    Tooltip: tooltipStub,
    TooltipContent: tooltipContentStub,
    TooltipProvider: tooltipProviderStub,
    TooltipTrigger: tooltipTriggerStub
  }

  it('forwards the configured delay and content class to shadcn tooltip primitives', () => {
    const wrapper = mountComponent(DcTooltip, {
      props: {
        content: 'Connection timed out',
        contentClass: 'max-w-xs whitespace-normal break-words',
        delayDuration: 350,
        side: 'bottom',
        sideOffset: 12
      },
      slots: { default: '<button>Trigger</button>' },
      global: { stubs }
    })

    expect(wrapper.get('[data-testid="tooltip-provider"]').attributes('data-delay-duration')).toBe(
      '350'
    )
    expect(wrapper.get('[data-testid="tooltip"]').attributes('data-delay-duration')).toBe('350')
    expect(wrapper.get('[data-testid="tooltip-content"]').classes()).toEqual(
      expect.arrayContaining(['max-w-xs', 'whitespace-normal', 'break-words'])
    )
    expect(wrapper.get('[data-testid="tooltip-content"]').attributes()).toMatchObject({
      'data-side': 'bottom',
      'data-side-offset': '12'
    })
  })
})

describe('DcToggleRow layout contract', () => {
  const stubs = {
    Icon: true,
    Label: labelStub,
    Switch: switchStub
  }

  it('keeps trailing content aligned and does not indent iconless descriptions', () => {
    const wrapper = mountComponent(DcToggleRow, {
      props: {
        id: 'feature',
        label: 'Enable feature',
        description: 'Runs in the background',
        modelValue: false
      },
      slots: { trailing: '<span data-testid="trailing">Beta</span>' },
      global: { stubs }
    })

    const mainRow = wrapper.get('label').element.parentElement
    const trailing = wrapper.get('[data-testid="trailing"]').element.parentElement
    const description = wrapper.get('p')

    expect(mainRow?.classList).toContain('w-full')
    expect(trailing?.classList).toContain('ml-auto')
    expect(description.classes()).not.toContain('ps-7')
  })

  it('indents descriptions when an icon leads the row', () => {
    const wrapper = mountComponent(DcToggleRow, {
      props: {
        id: 'feature',
        label: 'Enable feature',
        description: 'Runs in the background',
        icon: 'lucide:zap',
        modelValue: false
      },
      global: { stubs }
    })

    expect(wrapper.get('p').classes()).toContain('ps-7')
  })
})
