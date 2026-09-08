import { defineComponent, ref } from 'vue'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogTitle, DialogClose } from '@shadcn/components/ui/dialog'

const Fixture = defineComponent({
  components: { Dialog, DialogContent, DialogTitle, DialogClose },
  props: { removeTrigger: Boolean },
  setup() {
    return { open: ref(false), showTrigger: ref(true) }
  },
  template: `<main tabindex="-1">
    <button v-if="showTrigger" @click="open = true">Details</button>
    <Dialog v-model:open="open">
      <DialogContent v-if="open" :aria-describedby="undefined">
        <DialogTitle>Local details</DialogTitle>
        <DialogClose @click="showTrigger = !removeTrigger">Done</DialogClose>
      </DialogContent>
    </Dialog>
  </main>`
})

describe('Programmatic dialog keyboard focus', () => {
  it.each([false, true])(
    'restores focus after close (removed opener: %s)',
    async (removeTrigger) => {
      const wrapper = mount(Fixture, { props: { removeTrigger }, attachTo: document.body })
      try {
        const trigger = wrapper.get('button')
        trigger.element.focus()
        await trigger.trigger('click')
        await flushPromises()
        const dialog = new DOMWrapper(document.body).get('[role="dialog"]')
        await dialog
          .findAll('button')
          .find((button) => button.text() === 'Done')!
          .trigger('click')
        await vi.waitFor(() => {
          expect(document.activeElement).toBe(
            removeTrigger ? wrapper.get('main').element : trigger.element
          )
        })
      } finally {
        wrapper.unmount()
      }
    }
  )
})
