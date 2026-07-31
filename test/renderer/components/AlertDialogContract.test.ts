import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, mergeProps, nextTick, ref, withModifiers } from 'vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogAsyncAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '../../../src/shadcn/components/ui/alert-dialog'

type SubjectKind = 'action' | 'async' | 'cancel'

type HarnessOptions = {
  kind?: SubjectKind
  acceptClose?: boolean
  subjectProps?: Record<string, unknown>
  asChild?: boolean
}

const mountedWrappers: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

function mountHarness(options: HarnessOptions = {}) {
  const events: string[] = []
  const open = ref(true)
  const target = ref<string | null>('m1')
  const Subject =
    options.kind === 'cancel'
      ? AlertDialogCancel
      : options.kind === 'async'
        ? AlertDialogAsyncAction
        : AlertDialogAction
  const subjectProps = mergeProps(
    {
      'data-testid': 'dialog-subject',
      asChild: options.asChild
    },
    options.subjectProps ?? {}
  )

  const Host = defineComponent({
    setup() {
      return () =>
        h(
          AlertDialog,
          {
            open: open.value,
            'onUpdate:open': (value: boolean) => {
              events.push(`update:${value}`)
              if (options.acceptClose !== false) {
                open.value = value
                if (!value) target.value = null
              }
            }
          },
          {
            default: () =>
              h(
                AlertDialogContent,
                {},
                {
                  default: () => [
                    h(AlertDialogTitle, {}, { default: () => 'Confirmation' }),
                    h(AlertDialogDescription, {}, { default: () => 'Confirm the operation' }),
                    ...(options.kind === 'async'
                      ? [
                          h(
                            AlertDialogCancel,
                            { 'data-testid': 'dialog-cancel' },
                            { default: () => 'Cancel' }
                          )
                        ]
                      : []),
                    h(Subject, subjectProps, {
                      default: () =>
                        options.asChild
                          ? h('button', {}, [
                              h('span', { 'data-testid': 'dialog-subject-child' }, 'Confirm')
                            ])
                          : h('span', { 'data-testid': 'dialog-subject-child' }, 'Confirm')
                    })
                  ]
                }
              )
          }
        )
    }
  })

  const wrapper = mount(Host, { attachTo: document.body })
  mountedWrappers.push(wrapper)

  return {
    events,
    open,
    target,
    subject(): HTMLButtonElement {
      const element = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="dialog-subject"]'
      )
      if (!element) throw new Error('alert dialog subject was not rendered')
      return element
    },
    child(): HTMLSpanElement {
      const element = document.body.querySelector<HTMLSpanElement>(
        '[data-testid="dialog-subject-child"]'
      )
      if (!element) throw new Error('alert dialog subject child was not rendered')
      return element
    }
  }
}

function dispatchClick(target: Element, detail = 1): MouseEvent {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail
  })
  target.dispatchEvent(event)
  return event
}

describe.each([
  ['Action', 'action'],
  ['Cancel', 'cancel']
] as const)('AlertDialog%s click contract', (_label, kind) => {
  it('runs the component click before the primitive closes', async () => {
    const harness = mountHarness({
      kind,
      subjectProps: {
        onClick: () => harness.events.push(`click:${harness.target.value}`)
      }
    })
    await nextTick()

    dispatchClick(harness.subject())

    expect(harness.events).toEqual(['click:m1', 'update:false'])
    expect(harness.open.value).toBe(false)
  })

  it('keeps an explicit capture listener ahead of the component click without duplication', async () => {
    const harness = mountHarness({
      kind,
      subjectProps: {
        onClickCapture: () => harness.events.push('capture'),
        onClick: () => harness.events.push('click')
      }
    })
    await nextTick()

    dispatchClick(harness.child())

    expect(harness.events).toEqual(['capture', 'click', 'update:false'])
  })

  it('preserves component once semantics when the controlled owner remains open', async () => {
    const harness = mountHarness({
      kind,
      acceptClose: false,
      subjectProps: {
        onClickOnce: () => harness.events.push('click')
      }
    })
    await nextTick()

    dispatchClick(harness.subject())
    dispatchClick(harness.subject())

    expect(harness.events).toEqual(['click', 'update:false', 'update:false'])
    expect(harness.open.value).toBe(true)
  })

  it('preserves preventDefault without treating it as a close guard', async () => {
    const harness = mountHarness({
      kind,
      subjectProps: {
        onClick: withModifiers(
          (event: MouseEvent) => harness.events.push(`click:${event.defaultPrevented}`),
          ['prevent']
        )
      }
    })
    await nextTick()

    const event = dispatchClick(harness.subject())

    expect(event.defaultPrevented).toBe(true)
    expect(harness.events).toEqual(['click:true', 'update:false'])
  })

  it.each([
    ['button', (harness: ReturnType<typeof mountHarness>) => harness.subject()],
    ['descendant', (harness: ReturnType<typeof mountHarness>) => harness.child()]
  ])('preserves native stop propagation from the %s target', async (_label, target) => {
    // This documents native event behavior only. The source guard forbids application call sites
    // from using `.stop` as a dialog lifecycle API.
    const harness = mountHarness({
      kind,
      subjectProps: {
        onClick: withModifiers(() => harness.events.push('click'), ['stop'])
      }
    })
    await nextTick()

    dispatchClick(target(harness))

    expect(harness.events).toEqual(['click'])
    expect(harness.open.value).toBe(true)
  })

  it('does not invoke or close from a disabled native button', async () => {
    const harness = mountHarness({
      kind,
      subjectProps: {
        disabled: true,
        onClick: () => harness.events.push('click')
      }
    })
    await nextTick()

    harness.subject().click()

    expect(harness.events).toEqual([])
    expect(harness.open.value).toBe(true)
  })

  it('uses the same ordering for a keyboard-style click', async () => {
    const harness = mountHarness({
      kind,
      subjectProps: {
        onClick: (event: MouseEvent) => harness.events.push(`click:${event.detail}`)
      }
    })
    await nextTick()

    dispatchClick(harness.subject(), 0)

    expect(harness.events).toEqual(['click:0', 'update:false'])
  })

  it('forwards native attributes and the click contract through asChild', async () => {
    const harness = mountHarness({
      kind,
      asChild: true,
      subjectProps: {
        'aria-label': 'Confirm operation',
        'data-contract-value': 'forwarded',
        onClick: () => harness.events.push('click')
      }
    })
    await nextTick()

    const subject = harness.subject()
    expect(subject.tagName).toBe('BUTTON')
    expect(subject.getAttribute('aria-label')).toBe('Confirm operation')
    expect(subject.dataset.contractValue).toBe('forwarded')

    dispatchClick(harness.child())

    expect(harness.events).toEqual(['click', 'update:false'])
  })
})

describe('AlertDialogAsyncAction contract', () => {
  it('runs the native click without closing the dialog', async () => {
    const harness = mountHarness({
      kind: 'async',
      subjectProps: {
        onClick: () => harness.events.push(`click:${harness.target.value}`)
      }
    })
    await nextTick()

    dispatchClick(harness.child())

    expect(harness.events).toEqual(['click:m1'])
    expect(harness.open.value).toBe(true)
    expect(harness.subject().type).toBe('button')
  })

  it('keeps native attributes and disabled behavior', async () => {
    const harness = mountHarness({
      kind: 'async',
      subjectProps: {
        'aria-label': 'Run async operation',
        disabled: true,
        onClick: () => harness.events.push('click')
      }
    })
    await nextTick()

    harness.subject().click()

    expect(harness.subject().getAttribute('aria-label')).toBe('Run async operation')
    expect(harness.events).toEqual([])
    expect(harness.open.value).toBe(true)
  })

  it('forwards attributes and click handling through asChild without closing', async () => {
    const harness = mountHarness({
      kind: 'async',
      asChild: true,
      subjectProps: {
        'aria-label': 'Run nested async operation',
        onClick: () => harness.events.push('click')
      }
    })
    await nextTick()

    dispatchClick(harness.child())

    expect(harness.subject().getAttribute('aria-label')).toBe('Run nested async operation')
    expect(harness.events).toEqual(['click'])
    expect(harness.open.value).toBe(true)
  })
})
