<template>
  <div class="space-y-4">
    <div class="flex items-center gap-2">
      <Button size="sm" @click="expanded = !expanded">
        {{ expanded ? 'Collapse' : 'Expand' }}
      </Button>
      <Button size="sm" variant="outline" @click="toggleThinking">
        {{ thinking ? 'Stop thinking' : 'Simulate thinking' }}
      </Button>
      <Button size="sm" variant="ghost" @click="reset"> Reset </Button>
    </div>

    <ThinkContent
      :label="label"
      :expanded="expanded"
      :thinking="thinking"
      :content-html="contentHtml"
      @toggle="expanded = !expanded"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Button } from '@shadcn/components/ui/button'
import { ThinkContent } from '@/components/think-content'

const expanded = ref(true)
const thinking = ref(false)
const seconds = ref(12)
const contentHtml = `
  <p class="mb-2">Example reasoning output:</p>
  <ol class="list-decimal list-inside space-y-1">
    <li>Review the request.</li>
    <li>Break it into actionable steps.</li>
    <li>Draft a response and refine.</li>
  </ol>
`
let timer: number | undefined

const label = computed(() =>
  thinking.value ? `Thinking for ${seconds.value}s...` : `Thought for ${seconds.value}s`
)

const stopTimer = () => {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}

const toggleThinking = () => {
  thinking.value = !thinking.value
  if (thinking.value) {
    seconds.value = 0
    stopTimer()
    timer = window.setInterval(() => {
      seconds.value += 1
    }, 1000)
  } else {
    stopTimer()
  }
}

const reset = () => {
  stopTimer()
  thinking.value = false
  seconds.value = 12
  expanded.value = true
}

onBeforeUnmount(() => {
  stopTimer()
})
</script>
