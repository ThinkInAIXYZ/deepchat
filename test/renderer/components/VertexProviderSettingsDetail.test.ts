import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import VertexProviderSettingsDetail from '../../../src/renderer/settings/components/VertexProviderSettingsDetail.vue'

describe('VertexProviderSettingsDetail', () => {
  it('does not render the unused endpoint mode or a duplicate verification control', () => {
    const wrapper = shallowMount(VertexProviderSettingsDetail, {
      props: {
        provider: {
          id: 'vertex',
          name: 'Vertex',
          apiType: 'vertex',
          apiKey: '',
          baseUrl: '',
          enable: true,
          projectId: 'project',
          location: 'us-central1',
          endpointMode: 'express'
        }
      },
      global: {
        mocks: { $t: (key: string) => key }
      }
    })

    expect(wrapper.find('#vertex-endpointMode').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('settings.provider.vertexEndpointMode')
    expect(wrapper.text()).not.toContain('settings.provider.verifyKey')
  })
})
