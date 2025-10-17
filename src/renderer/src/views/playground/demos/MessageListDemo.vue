<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end gap-4">
      <div class="grid gap-2 min-w-[220px] flex-1">
        <Label for="typing-speed" class="text-xs font-medium uppercase tracking-wide">
          Typing Speed (ms / char)
        </Label>
        <input
          id="typing-speed"
          v-model.number="speedMs"
          type="range"
          min="20"
          max="1000"
          step="20"
          class="w-full accent-primary"
        />
        <div class="flex justify-between text-[11px] text-muted-foreground">
          <span>{{ charsPerSecond }} chars/s</span>
          <span>{{ (speedMs / 1000).toFixed(2) }} s/char</span>
        </div>
      </div>
      <div class="grid gap-2 w-28">
        <Label for="viewport-width" class="text-xs font-medium uppercase tracking-wide">
          Width (px)
        </Label>
        <Input
          id="viewport-width"
          v-model.number="width"
          type="number"
          min="360"
          max="960"
          step="20"
        />
      </div>
      <div class="grid gap-2 w-28">
        <Label for="viewport-height" class="text-xs font-medium uppercase tracking-wide">
          Height (px)
        </Label>
        <Input
          id="viewport-height"
          v-model.number="height"
          type="number"
          min="320"
          max="720"
          step="20"
        />
      </div>
      <div class="flex flex-wrap gap-2">
        <Button size="sm" @click="startSimulation">Restart</Button>
        <Button size="sm" variant="outline" :disabled="!canTogglePause" @click="togglePause">
          {{ streamingPaused ? 'Resume' : 'Pause' }}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          :disabled="streamingPhase === 'idle'"
          @click="completeImmediately"
        >
          Finish
        </Button>
        <Button size="sm" variant="secondary" @click="messageListRef?.scrollToBottom(true)">
          Scroll Bottom
        </Button>
      </div>
    </div>

    <div class="rounded-lg border border-border bg-background/60 p-3 shadow-inner">
      <div
        class="mx-auto overflow-hidden rounded-md border border-dashed border-border/80 bg-muted/40"
        :style="containerStyle"
      >
        <MessageList ref="messageListRef" :messages="messages" />
      </div>
    </div>

    <div class="grid gap-1 text-xs text-muted-foreground leading-relaxed">
      <div>Phase: {{ phaseLabel }}</div>
      <div>Thinking progress: {{ reasoningChars }} / {{ reasoningTotal }}</div>
      <div>Response progress: {{ responseChars }} / {{ responseTotal }}</div>
      <div>
        Auto-scroll anchor visible:
        {{ aboveThreshold ? 'No (user scrolled up)' : 'Yes (snap to bottom)' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MessageList from '@/components/message/MessageList.vue'
import type { AssistantMessage, AssistantMessageBlock, UserMessage } from '@shared/chat'
import { Button } from '@shadcn/components/ui/button'
import { Input } from '@shadcn/components/ui/input'
import { Label } from '@shadcn/components/ui/label'

type Phase = 'idle' | 'reasoning' | 'response' | 'done'

const conversationId = 'playground-thread-demo'

const messageListRef = ref<InstanceType<typeof MessageList>>()
const speedMs = ref(120)
const width = ref(560)
const height = ref(460)
const streamingPhase = ref<Phase>('idle')
const streamingPaused = ref(false)
const reasoningChars = ref(0)
const responseChars = ref(0)
const reasoningStartedAt = ref(0)

const fullReasoning = `
**Automatic scroll diagnostic**

- "阿萨德发送方把水淀粉"

1. Parse the user instruction and enumerate desired behaviours.
2. Draft a timeline for reasoning tokens so we can observe incremental layout changes.
   - Track when the list overflows the viewport.
   - Compare scroll anchoring between smooth and instant modes.
3. Anticipate regression cases:
   - User hovers toolbars and pauses scroll.
   - Minimap toggles or artifact drawer opens mid-stream.
   - Window resizes while the stream is still pending.
4. Prepare a checklist of measurements for after the response completes.

**Sanity checks before final answer**

- Ensure the thinking accordion remains expanded while status is loading.
- Confirm IntersectionObserver updates the \`aboveThreshold\` flag when we scroll away.
- Note the exact char offset when the anchor leaves the viewport for replication.

**Next action**

- Transition into final content streaming once the reasoning trace is stable.
`.trim()

const fullResponse = `
### Auto Scroll Simulation Report

We reproduced a conversation containing a single user prompt and an extensive assistant response to stress-test the MessageList component.

#### Key observations
- The reasoning block produces gradual vertical growth that should keep the scroll anchor in view.
- When the viewport height shrinks below 400px the anchor quickly leaves the screen, triggering the floating scroll button.
- Hover interactions remain accessible because toolbars only appear on demand.
  - The pause control in this playground helps verify how the UI looks when generation halts mid-stream.

#### Suggested experiments
1. Scroll upward while the stream is active to confirm the component stops auto-scrolling.
2. Resize the viewport to narrower than 420px width and watch the reflow behaviour.
3. Toggle between fast (20ms) and slow (1000ms) speeds to check for timing edge cases.

> Tip: use the \`Scroll Bottom\` button after manual adjustments to re-sync with the anchor.

| Metric | Observation |
| --- | --- |
| Reasoning characters | Refer to counter above |
| Response characters | Refer to counter above |
| Slowest speed | 1 character every 1.0s |

**Next steps**
- [ ] Capture flame chart with devtools performance tab.
- [ ] Compare smooth scroll behaviour against instant scroll.
- [ ] Document findings before adjusting production settings.
`.trim()

const reasoningTotal = fullReasoning.length
const responseTotal = fullResponse.length

const messages = ref<Array<UserMessage | AssistantMessage>>([])
const userMessage = ref<UserMessage>()
const assistantMessage = ref<AssistantMessage>()

let timerId: number | undefined

const charsPerSecond = computed(() => (1000 / speedMs.value).toFixed(2))
const containerStyle = computed(() => ({
  '--playground-target-width': `${Math.round(width.value)}px`,
  width: 'min(100%, var(--playground-target-width))',
  height: `${Math.round(height.value)}px`
}))

// @ts-ignore
const aboveThreshold = computed(() => messageListRef.value?.aboveThreshold?.value ?? false)

const phaseLabel = computed(() => {
  switch (streamingPhase.value) {
    case 'reasoning':
      return 'Streaming thinking'
    case 'response':
      return 'Streaming answer'
    case 'done':
      return 'Completed'
    default:
      return 'Idle'
  }
})

const canTogglePause = computed(
  () => streamingPhase.value !== 'idle' && streamingPhase.value !== 'done'
)

const createUserMessage = (timestamp: number): UserMessage => ({
  id: `playground-user-${timestamp}`,
  role: 'user',
  timestamp,
  avatar: '',
  name: '研究者',
  model_name: '',
  model_id: '',
  model_provider: '',
  status: 'sent',
  error: '',
  usage: {
    context_usage: 0,
    tokens_per_second: 0,
    total_tokens: 0,
    generation_time: 0,
    first_token_time: timestamp,
    reasoning_start_time: timestamp,
    reasoning_end_time: timestamp,
    input_tokens: 120,
    output_tokens: 0
  },
  conversationId,
  is_variant: 0,
  content: {
    text: '请帮我构造一个有超长思考过程的示例，方便我研究自动滚动行为。',
    files: [],
    links: [],
    think: true,
    search: false,
    content: [
      {
        type: 'text',
        content:
          '请生成一个可以在 Playground 中复现 MessageList 自动滚动逻辑的案例，包含很长的 thinking 和最终答案。'
      }
    ]
  }
})

const createAssistantMessage = (timestamp: number, parentId: string): AssistantMessage => ({
  id: `playground-assistant-${timestamp}`,
  role: 'assistant',
  timestamp,
  avatar: '',
  name: 'DeepChat Playground',
  model_name: 'Playground Research Model',
  model_id: 'playground-model',
  model_provider: 'playground',
  status: 'pending',
  error: '',
  usage: {
    context_usage: 0,
    tokens_per_second: 0,
    total_tokens: 0,
    generation_time: 0,
    first_token_time: timestamp,
    reasoning_start_time: timestamp,
    reasoning_end_time: timestamp,
    input_tokens: 0,
    output_tokens: 0
  },
  conversationId,
  parentId,
  is_variant: 0,
  content: [
    {
      type: 'reasoning_content',
      content: '',
      status: 'loading',
      timestamp,
      reasoning_time: {
        start: timestamp,
        end: timestamp
      }
    },
    {
      type: 'content',
      content: '',
      status: 'loading',
      timestamp: timestamp + 200
    }
  ]
})

const stopStreaming = () => {
  if (timerId !== undefined) {
    window.clearTimeout(timerId)
    timerId = undefined
  }
}

const scheduleTick = () => {
  stopStreaming()
  if (streamingPhase.value === 'idle' || streamingPhase.value === 'done' || streamingPaused.value) {
    return
  }
  timerId = window.setTimeout(() => {
    tick()
  }, speedMs.value)
}

const applyAssistantUpdate = (updater: (current: AssistantMessage) => AssistantMessage) => {
  if (!assistantMessage.value || !userMessage.value) return
  assistantMessage.value = updater(assistantMessage.value)
  messages.value = [userMessage.value, assistantMessage.value]
}

const tick = () => {
  if (!assistantMessage.value || !userMessage.value) return

  if (streamingPhase.value === 'reasoning') {
    reasoningChars.value = Math.min(reasoningChars.value + 1, reasoningTotal)
    const reasoningSlice = fullReasoning.slice(0, reasoningChars.value)
    const reasoningEnd = Date.now()
    applyAssistantUpdate((current) => {
      const [reasoningBlock, responseBlock] = current.content
      const updatedReasoning: AssistantMessageBlock = {
        ...reasoningBlock,
        content: reasoningSlice,
        status: reasoningChars.value === reasoningTotal ? 'success' : 'loading',
        reasoning_time: {
          start: reasoningBlock.reasoning_time?.start ?? reasoningStartedAt.value,
          end: reasoningEnd
        }
      }
      return {
        ...current,
        content: [updatedReasoning, responseBlock],
        usage: {
          ...current.usage,
          reasoning_end_time: reasoningEnd,
          output_tokens: reasoningChars.value + responseChars.value
        }
      }
    })
    if (reasoningChars.value === reasoningTotal) {
      streamingPhase.value = 'response'
    }
  } else if (streamingPhase.value === 'response') {
    responseChars.value = Math.min(responseChars.value + 1, responseTotal)
    const responseSlice = fullResponse.slice(0, responseChars.value)
    const finished = responseChars.value === responseTotal
    applyAssistantUpdate((current) => {
      const [reasoningBlock, responseBlock] = current.content
      const updatedResponse: AssistantMessageBlock = {
        ...responseBlock,
        content: responseSlice,
        status: finished ? 'success' : 'loading'
      }
      return {
        ...current,
        status: finished ? 'sent' : 'pending',
        content: [{ ...reasoningBlock, status: 'success' }, updatedResponse],
        usage: {
          ...current.usage,
          total_tokens: reasoningChars.value + responseChars.value,
          output_tokens: reasoningChars.value + responseChars.value,
          generation_time: finished
            ? Math.max(
                current.usage.generation_time,
                Math.round((Date.now() - reasoningStartedAt.value) / 1000)
              )
            : current.usage.generation_time
        }
      }
    })
    if (finished) {
      streamingPhase.value = 'done'
    }
  }

  if (streamingPhase.value !== 'done') {
    scheduleTick()
  }
}

const startSimulation = () => {
  stopStreaming()
  const now = Date.now()
  const user = createUserMessage(now)
  const assistant = createAssistantMessage(now + 500, user.id)
  userMessage.value = user
  assistantMessage.value = assistant
  messages.value = [user, assistant]
  streamingPhase.value = 'reasoning'
  streamingPaused.value = false
  reasoningChars.value = 0
  responseChars.value = 0
  reasoningStartedAt.value = assistant.timestamp
  nextTick(() => {
    messageListRef.value?.scrollToBottom(false)
  })
  scheduleTick()
}

const togglePause = () => {
  if (!canTogglePause.value) return
  streamingPaused.value = !streamingPaused.value
  if (streamingPaused.value) {
    stopStreaming()
  } else {
    scheduleTick()
  }
}

const completeImmediately = () => {
  if (!assistantMessage.value || !userMessage.value) return
  reasoningChars.value = reasoningTotal
  responseChars.value = responseTotal
  const end = Date.now()
  applyAssistantUpdate((current) => {
    const [reasoningBlock, responseBlock] = current.content
    const finishedReasoning: AssistantMessageBlock = {
      ...reasoningBlock,
      content: fullReasoning,
      status: 'success',
      reasoning_time: {
        start: reasoningBlock.reasoning_time?.start ?? reasoningStartedAt.value,
        end
      }
    }
    const finishedResponse: AssistantMessageBlock = {
      ...responseBlock,
      content: fullResponse,
      status: 'success'
    }
    return {
      ...current,
      status: 'sent',
      content: [finishedReasoning, finishedResponse],
      usage: {
        ...current.usage,
        reasoning_end_time: end,
        total_tokens: reasoningTotal + responseTotal,
        output_tokens: reasoningTotal + responseTotal
      }
    }
  })
  streamingPhase.value = 'done'
  stopStreaming()
}

watch(speedMs, () => {
  if (
    streamingPhase.value !== 'idle' &&
    streamingPhase.value !== 'done' &&
    !streamingPaused.value
  ) {
    scheduleTick()
  }
})

watch(width, (value) => {
  if (value < 360) width.value = 360
  if (value > 960) width.value = 960
})

watch(height, (value) => {
  if (value < 320) height.value = 320
  if (value > 720) height.value = 720
})

onMounted(() => {
  startSimulation()
})

onBeforeUnmount(() => {
  stopStreaming()
})
</script>
