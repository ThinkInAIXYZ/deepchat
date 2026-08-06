import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import DcButton from '../../../src/dc-ui/components/button/DcButton.vue'
import DcForm from '../../../src/dc-ui/components/form/DcForm.vue'
import { TooltipProvider } from '../../../src/shadcn/components/ui/tooltip'

const mountedWrappers: Array<ReturnType<typeof mount>> = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const mountDcForm = (onSubmit: (values: unknown, ctx: unknown) => void | Promise<void>) => {
  const wrapper = mount(DcForm, {
    attrs: {
      'data-testid': 'dc-form',
      onSubmit
    },
    slots: {
      default: '<button type="submit">Submit</button>'
    }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

const mountDcButton = (props: InstanceType<typeof DcButton>['$props']) => {
  const wrapper = mount(TooltipProvider, {
    props: { delayDuration: 200 },
    slots: {
      default: () => h(DcButton, props)
    }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

const collectVueFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name)
      if (entry.isDirectory()) return collectVueFiles(entryPath)
      return entry.isFile() && entry.name.endsWith('.vue') ? [entryPath] : []
    })
  )
  return nested.flat()
}

describe('DcForm submit contract', () => {
  it('forwards native submit exactly once without Vue listener warnings', async () => {
    const onSubmit = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const wrapper = mountDcForm(onSubmit)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(wrapper.get('form').attributes('data-testid')).toBe('dc-form')
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Invalid prop: type check failed for prop "onSubmit"')
    )
  })

  it('suppresses duplicate submissions while a submit handler is pending', async () => {
    let resolveSubmit!: () => void
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve
        })
    )
    const wrapper = mountDcForm(onSubmit)

    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(onSubmit).toHaveBeenCalledTimes(1)

    resolveSubmit()
    await flushPromises()
  })

  it('emits an error and consumes rejected submit handlers', async () => {
    const error = new Error('Submit failed')
    const onSubmit = vi.fn().mockRejectedValue(error)
    const unhandledRejection = vi.fn()
    window.addEventListener('unhandledrejection', unhandledRejection)
    const wrapper = mountDcForm(onSubmit)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('error')).toEqual([[error]])
    expect(unhandledRejection).not.toHaveBeenCalled()
    window.removeEventListener('unhandledrejection', unhandledRejection)
  })
})

describe('DcButton accessible-name contract', () => {
  it('preserves a caller-provided aria-label for an icon-only button', () => {
    const wrapper = mountDcButton({
      size: 'icon',
      icon: 'lucide:plus',
      'aria-label': 'Increase timeout'
    })

    expect(wrapper.get('button').attributes('aria-label')).toBe('Increase timeout')
  })

  it('uses label and tooltip before a caller-provided aria-label', () => {
    const labelWrapper = mountDcButton({
      size: 'icon',
      label: 'Delete',
      tooltip: 'Delete item',
      'aria-label': 'Caller label'
    })
    const tooltipWrapper = mountDcButton({
      size: 'icon',
      tooltip: 'Delete item',
      'aria-label': 'Caller label'
    })

    expect(labelWrapper.get('button').attributes('aria-label')).toBe('Delete')
    expect(tooltipWrapper.get('button').attributes('aria-label')).toBe('Delete item')
  })

  it('warns for icon-only buttons without an accessible name even with slot content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const wrapper = mount(TooltipProvider, {
      props: { delayDuration: 200 },
      slots: {
        default: () =>
          h(
            DcButton,
            { size: 'icon' },
            { default: () => h('span', { 'aria-hidden': 'true' }, '×') }
          )
      }
    })
    mountedWrappers.push(wrapper)

    expect(warn).toHaveBeenCalledWith('[DcButton] icon-only button requires an accessible name')
  })
})

describe('confirmation dialog i18n bindings', () => {
  it('does not contain literal t(...) confirmation-label attributes', async () => {
    const rendererRoot = resolve('src/renderer')
    const sources = await Promise.all(
      (await collectVueFiles(rendererRoot)).map(async (file) => ({
        file,
        source: await readFile(file, 'utf8')
      }))
    )
    const unboundLabels = sources.flatMap(({ file, source }) =>
      Array.from(
        source.matchAll(/\s(?<!:)(?:confirm-label|cancel-label)\s*=\s*"t\('/g),
        (match) => `${file}:${source.slice(0, match.index).split('\n').length}`
      )
    )

    expect(unboundLabels).toEqual([])
  })
})
