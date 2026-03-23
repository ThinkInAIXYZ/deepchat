import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MessageBlockAudio from '@/components/message/MessageBlockAudio.vue'
import MessageBlockImage from '@/components/message/MessageBlockImage.vue'
import type { DisplayAssistantMessageBlock } from '@/components/chat/messageListItems'

const createBlock = (
  overrides: Partial<DisplayAssistantMessageBlock> = {}
): DisplayAssistantMessageBlock => ({
  type: 'image',
  status: 'success',
  timestamp: Date.now(),
  ...overrides
})

describe('MessageBlock media', () => {
  it('renders image from image_data url payload', () => {
    const wrapper = mount(MessageBlockImage, {
      props: {
        block: createBlock({
          type: 'image',
          image_data: {
            data: 'https://example.com/image.png',
            mimeType: 'deepchat/image-url'
          }
        })
      }
    })

    expect(wrapper.find('img').attributes('src')).toBe('https://example.com/image.png')
  })

  it('renders image from legacy persisted payload', () => {
    const wrapper = mount(MessageBlockImage, {
      props: {
        block: createBlock({
          type: 'image',
          content: {
            data: 'data:image/png;base64,AAAA',
            mimeType: 'image/png'
          } as never
        })
      }
    })

    expect(wrapper.find('img').attributes('src')).toBe('data:image/png;base64,AAAA')
  })

  it('renders audio from image_data payload', () => {
    const wrapper = mount(MessageBlockAudio, {
      props: {
        block: createBlock({
          type: 'audio',
          image_data: {
            data: 'data:audio/wav;base64,BBBB',
            mimeType: 'audio/wav'
          }
        })
      }
    })

    expect(wrapper.find('audio').attributes('src')).toBe('data:audio/wav;base64,BBBB')
  })

  it('renders audio from legacy persisted payload', () => {
    const wrapper = mount(MessageBlockAudio, {
      props: {
        block: createBlock({
          type: 'audio',
          content: {
            data: 'CCCC',
            mimeType: 'audio/mpeg'
          } as never
        })
      }
    })

    expect(wrapper.find('audio').attributes('src')).toBe('data:audio/mpeg;base64,CCCC')
  })
})
