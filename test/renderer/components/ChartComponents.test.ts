import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import {
  ChartContainer,
  ChartTooltipContent,
  componentToString,
  useChart
} from '@shadcn/components/ui/chart'

describe('chart components', () => {
  it('uses the computed chart id for both context and slot props', () => {
    const config = {
      input: {
        label: 'Input',
        color: '#2563eb'
      }
    }

    const ChartIdProbe = defineComponent({
      setup() {
        const { id } = useChart()
        return { id }
      },
      template: '<div data-testid="context-id">{{ id }}</div>'
    })

    const wrapper = mount(
      defineComponent({
        components: {
          ChartContainer,
          ChartIdProbe
        },
        setup() {
          return { config }
        },
        template: `
          <ChartContainer id="usage" :config="config">
            <template #default="{ id }">
              <div data-testid="slot-id">{{ id }}</div>
              <ChartIdProbe />
            </template>
          </ChartContainer>
        `
      })
    )

    expect(wrapper.get('[data-slot="chart"]').attributes('data-chart')).toBe('chart-usage')
    expect(wrapper.get('[data-testid="slot-id"]').text()).toBe('chart-usage')
    expect(wrapper.get('[data-testid="context-id"]').text()).toBe('chart-usage')
    expect(wrapper.html()).toContain('[data-chart="chart-usage"]')
  })

  it('renders zero values inside tooltip content', () => {
    const wrapper = mount(ChartTooltipContent, {
      props: {
        payload: {
          input: 0
        },
        config: {
          input: {
            label: 'Input',
            color: '#2563eb'
          }
        },
        x: new Date('2026-03-17T00:00:00Z')
      }
    })

    expect(wrapper.text()).toContain('Input')
    expect(wrapper.text()).toContain('0')
  })

  it('stably serializes nested payloads for tooltip caching', () => {
    const renderSpy = vi.fn()
    let tooltipRenderer: ReturnType<typeof componentToString> | undefined

    const TooltipProbe = defineComponent({
      props: {
        payload: {
          type: Object,
          required: true
        }
      },
      setup(props) {
        renderSpy(props.payload)
        return () => h('div', JSON.stringify(props.payload))
      }
    })

    mount(
      defineComponent({
        setup() {
          tooltipRenderer = componentToString(
            {
              input: {
                label: 'Input',
                color: '#2563eb'
              }
            },
            TooltipProbe as never
          )

          return () => null
        }
      })
    )

    const firstPayload = {
      nested: {
        beta: 2,
        alpha: 1
      },
      list: [{ delta: 4, gamma: 3 }]
    }
    const secondPayload = {
      list: [{ gamma: 3, delta: 4 }],
      nested: {
        alpha: 1,
        beta: 2
      }
    }

    expect(tooltipRenderer).toBeTypeOf('function')
    expect(tooltipRenderer?.(firstPayload, 0)).toBe(tooltipRenderer?.(secondPayload, 0))
    expect(renderSpy).toHaveBeenCalledTimes(1)
  })
})
