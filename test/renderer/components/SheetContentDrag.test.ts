import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@shadcn/components/ui/sheet'

describe('SheetContent drag region', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps the close button outside the Electron drag region', async () => {
    const TestHost = defineComponent({
      components: {
        Sheet,
        SheetContent,
        SheetDescription,
        SheetTitle
      },
      template: `
        <Sheet :open="true">
          <SheetContent>
            <SheetTitle>Test sheet</SheetTitle>
            <SheetDescription>Test description</SheetDescription>
            <div>Body</div>
          </SheetContent>
        </Sheet>
      `
    })

    const wrapper = mount(TestHost, {
      attachTo: document.body
    })
    await flushPromises()

    const closeButton = document.body.querySelector(
      'button.window-no-drag-region'
    ) as HTMLButtonElement | null

    expect(closeButton).not.toBeNull()
    expect(closeButton?.type).toBe('button')

    wrapper.unmount()
  })
})
