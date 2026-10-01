<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { useAcpExtensionsStore } from '@/stores/acpExtensions'
import { createAcpExtensionsClient } from '@api/AcpExtensionsClient'
import MarkdownRenderer from '@/components/markdown/MarkdownRenderer.vue'
import MessageBlockToolCall from '@/components/message/MessageBlockToolCall.vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import type { AcpSubagentRun } from '@shared/types/acp-extensions'
import { sumModelUsage, type ModelUsage } from 'acp-extension-core'

const props = defineProps<{ sessionId: string; agentId: string }>()
const { t, locale } = useI18n()
const store = useAcpExtensionsStore()
const client = createAcpExtensionsClient()
const state = computed(() => store.states[props.sessionId])
const inheritedUsage = computed(() =>
  state.value?.usage?.inheritedBaseline
    ? sumModelUsage(state.value.usage.inheritedBaseline)
    : undefined
)
const objective = ref('')
const busy = ref(false)
const tokenTotal = (usage: ModelUsage) =>
  usage.inputTokens +
  usage.outputTokens +
  usage.cacheReadInputTokens +
  (usage.cacheCreationInputTokens ?? 0) +
  (usage.reasoningOutputTokens ?? 0)
function canGoal(action: 'set' | 'resume' | 'pause' | 'clear') {
  const capability = state.value?.capabilities.goal
  return (
    state.value?.connected &&
    capability?.actions.includes(action) &&
    (action === 'set' || action === 'resume'
      ? capability.promptActions
      : capability.controlActions
    )?.includes(action)
  )
}
const error = ref(false)
const outputs = ref<Record<string, string>>({})
const label = (key: string) => t(`chat.acpExtensions.${key}`)
const number = (value: number | undefined | null) =>
  value == null ? '—' : new Intl.NumberFormat(locale.value).format(value)
const date = (seconds: number | undefined | null) =>
  seconds == null ? '—' : new Date(seconds * 1000).toLocaleString(locale.value)
const cost = (usage: ModelUsage) =>
  usage.costUSD === undefined
    ? label('unknownCost')
    : new Intl.NumberFormat(locale.value, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 6
      }).format(usage.costUSD)
watch(
  () => [props.sessionId, props.agentId],
  () => {
    outputs.value = {}
    void store.inspect(props.sessionId, props.agentId)
  },
  { immediate: true }
)
async function perform(operation: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = false
  try {
    await operation()
  } catch {
    error.value = true
  } finally {
    busy.value = false
  }
}
async function controlTask(taskId: string, action: 'output' | 'cancel') {
  const sessionId = props.sessionId
  const { output } = await client.controlTask(sessionId, taskId, action)
  if (sessionId !== props.sessionId) return
  if (action === 'output') outputs.value[taskId] = output
  else if (state.value?.capabilities.subagents?.list) await client.listTasks(sessionId)
}
const tasks = computed(() => {
  const snapshot = state.value
  if (!snapshot) return []
  const rows = Object.values(snapshot.tasks).map((task) => ({
    id: task.taskId,
    kind: task.kind,
    description: task.description,
    status: String(task.status),
    summary: task.summary ?? task.error,
    parentTaskId: task.parentTaskId,
    usage: task.usage
  }))
  for (const task of snapshot.remoteTasks) {
    const row = rows.find((row) => row.id === task.taskId)
    if (row) Object.assign(row, { description: task.description, status: task.status })
    else
      rows.push({
        id: task.taskId,
        kind: 'subagent',
        description: task.description,
        status: task.status,
        summary: task.stopReason,
        parentTaskId: undefined,
        usage: undefined
      })
  }
  return rows
})
const unlinkedTasks = computed(() =>
  tasks.value.filter(
    (task) => !Object.values(state.value?.runs ?? {}).some((run) => run.taskId === task.id)
  )
)
const linkedTask = (run: AcpSubagentRun) => tasks.value.find((task) => task.id === run.taskId)
function canControl(taskId: string, action: 'output' | 'cancel') {
  const snapshot = state.value
  if (
    !snapshot?.connected ||
    !snapshot.freshTaskIds?.includes(taskId) ||
    !snapshot.capabilities.subagents?.[action]
  )
    return false
  const task = tasks.value.find((task) => task.id === taskId)
  if (
    !task ||
    task.kind !== 'subagent' ||
    (action === 'cancel' && !['pending', 'in_progress', 'running'].includes(task.status))
  )
    return false
  return Object.values(snapshot.runs)
    .filter((run) => run.taskId === taskId)
    .every(
      (run) =>
        run.snapshot &&
        (action === 'cancel'
          ? run.snapshot.support.cancel && ['pending', 'running'].includes(run.snapshot.state)
          : run.snapshot.support.outputRead !== 'none' &&
            (run.snapshot.support.outputRead !== 'final_tail' ||
              !['pending', 'running'].includes(run.snapshot.state)))
    )
}
function blocks(run: AcpSubagentRun): DisplayAssistantMessageBlock[] {
  return run.blocks as DisplayAssistantMessageBlock[]
}
</script>

<template>
  <Popover v-if="state && Object.keys(state.capabilities).length">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="flex h-6 items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        :aria-label="label('sessionStatus')"
      >
        <Icon icon="lucide:activity" class="h-3.5 w-3.5" />
        <span>{{ label('sessionStatus') }}</span>
        <span v-if="state.goal">· {{ label(state.goal.status) }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      class="w-[min(34rem,90vw)] max-h-[70vh] overflow-y-auto p-4 text-sm space-y-4"
    >
      <p v-if="!state.connected || state.tasksStale" class="text-muted-foreground">
        {{ label('staleSnapshot') }}
      </p>
      <p v-if="error" role="alert" class="text-destructive">{{ label('operationFailed') }}</p>
      <p v-if="state.title" class="font-medium">{{ state.title }}</p>
      <p v-if="state.notice" :role="state.notice.level === 'error' ? 'alert' : 'status'">
        {{ state.notice.message }}
      </p>
      <div v-if="state.activity" class="text-muted-foreground">
        {{ label(state.activity.kind) }} · {{ number(state.activity.usedTokensBefore) }} →
        {{ number(state.activity.usedTokensAfter) }}
        <p v-if="state.activity.failureReason">{{ state.activity.failureReason }}</p>
      </div>
      <section v-if="state.capabilities.sessionHistory" class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="font-medium">{{ label('history') }}</h3>
          <button
            type="button"
            :disabled="busy || !state.connected"
            class="underline"
            @click="perform(() => client.readHistory(sessionId))"
          >
            {{ label('readHistory') }}
          </button>
        </div>
        <template v-if="state.history">
          <p v-if="!state.history.verifiedComplete" class="text-muted-foreground">
            {{ label('historyPreviewOnly') }}
          </p>
          <button
            v-else
            type="button"
            :disabled="busy || !state.connected"
            class="underline"
            @click="perform(() => client.importHistory(sessionId))"
          >
            {{ label('importHistory') }}
          </button>
          <details>
            <summary class="cursor-pointer">{{ label('historyPreview') }}</summary>
            <div v-for="entry in state.history.entries" :key="entry.id" class="my-3 border-t pt-2">
              <p class="text-xs text-muted-foreground">{{ label(entry.role) }}</p>
              <p v-if="entry.role === 'user'" class="whitespace-pre-wrap">{{ entry.text }}</p>
              <template v-else
                ><div v-for="(block, index) in entry.blocks" :key="index">
                  <MessageBlockToolCall
                    v-if="block.type === 'tool_call'"
                    :block="block as DisplayAssistantMessageBlock"
                    read-only
                  /><MarkdownRenderer
                    v-else-if="block.content"
                    :content="block.content"
                    mode="minimal"
                    :smooth-streaming="false"
                  /></div
              ></template>
            </div>
          </details>
        </template>
      </section>
      <p v-if="state.inheritedUsageUnknown" class="text-muted-foreground">
        {{ label('unknownBaseline') }}
      </p>
      <section v-if="state.usage" class="space-y-2">
        <h3 class="font-medium">{{ label('usage') }}</h3>
        <p v-if="state.usage.incomplete" class="text-muted-foreground">
          {{ label('incompleteUsage') }}
        </p>
        <table class="w-full text-left text-xs tabular-nums">
          <thead>
            <tr>
              <th>{{ label('model') }}</th>
              <th>{{ label('input') }}</th>
              <th>{{ label('output') }}</th>
              <th>{{ label('cache') }}</th>
              <th>{{ label('cost') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(usage, model) in state.usage.modelUsage" :key="model">
              <td class="max-w-44 break-all py-1">{{ model }}</td>
              <td>{{ number(usage.inputTokens) }}</td>
              <td>{{ number(usage.outputTokens) }}</td>
              <td>{{ number(usage.cacheReadInputTokens) }}</td>
              <td>{{ cost(usage) }}</td>
            </tr>
            <tr class="border-t">
              <th class="py-1">{{ label('total') }}</th>
              <td>{{ number(state.usage.total.inputTokens) }}</td>
              <td>{{ number(state.usage.total.outputTokens) }}</td>
              <td>{{ number(state.usage.total.cacheReadInputTokens) }}</td>
              <td>{{ cost(state.usage.total) }}</td>
            </tr>
          </tbody>
        </table>
        <details>
          <summary class="cursor-pointer">{{ label('usageDetails') }}</summary>
          <div v-for="(usage, model) in state.usage.modelUsage" :key="model" class="mt-2 text-xs">
            <p class="break-all">{{ model }}</p>
            <p>
              {{ label('cacheWrite') }} {{ number(usage.cacheCreationInputTokens) }} ·
              {{ label('reasoning') }} {{ number(usage.reasoningOutputTokens) }} ·
              {{ label('webSearch') }} {{ number(usage.webSearchRequests) }} ·
              {{ label('contextWindow') }} {{ number(usage.contextWindow) }}
            </p>
          </div>
          <p v-if="state.usage.latest" class="mt-2 text-xs">
            {{ label('latestUsage') }}: {{ number(tokenTotal(state.usage.latest)) }}
            {{ label('tokens') }} · {{ cost(state.usage.latest) }}
          </p>
        </details>
        <p v-if="inheritedUsage" class="text-xs">
          {{ label('forkBaseline') }}: {{ number(tokenTotal(inheritedUsage)) }}
          {{ label('tokens') }} · {{ cost(inheritedUsage) }}
        </p>
        <p v-if="state.usage.sinceFork" class="text-xs">
          {{ label('forkUsage') }}: {{ number(tokenTotal(state.usage.sinceFork)) }}
          {{ label('tokens') }} · {{ cost(state.usage.sinceFork) }}
        </p>
      </section>
      <section v-if="state.capabilities.rateLimits" class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="font-medium">{{ label('rateLimits') }}</h3>
          <button
            v-if="state.connected && state.capabilities.rateLimits.query"
            type="button"
            :disabled="busy"
            class="underline"
            @click="perform(() => client.refreshRateLimits(sessionId))"
          >
            {{ label('refresh') }}
          </button>
        </div>
        <p v-if="!state.rateLimits?.rateLimits.length" class="text-muted-foreground">
          {{ label('noData') }}
        </p>
        <div v-for="(limit, index) in state.rateLimits?.rateLimits" :key="index" class="space-y-1">
          <p>
            {{ limit.limitName ?? limit.limitId }} · {{ limit.scope.providerId }}
            {{ limit.scope.accountId }} {{ limit.scope.modelId }} {{ limit.planName }}
          </p>
          <p
            v-for="(window, windowIndex) in limit.windows"
            :key="windowIndex"
            class="text-xs text-muted-foreground"
          >
            {{ window.label }} · {{ number(window.windowDurationSeconds) }} s ·
            {{ number(window.usedPercent) }}% · {{ label('resetsAt') }}
            {{ date(window.resetsAtEpochSeconds) }}
          </p>
          <p v-if="limit.wallet" class="text-xs">
            {{ label('balance') }} {{ number(limit.wallet.balanceCents / 100) }}
            {{ limit.wallet.currency }} · {{ label('monthlyUsed') }}
            {{ number(limit.wallet.monthlyUsedCents / 100)
            }}<template v-if="limit.wallet.monthlyChargeLimitEnabled">
              / {{ number(limit.wallet.monthlyChargeLimitCents / 100) }}</template
            >
          </p>
        </div>
        <p v-if="state.rateLimits?.fetchedAtEpochSeconds" class="text-xs text-muted-foreground">
          {{ date(state.rateLimits.fetchedAtEpochSeconds) }}
        </p>
      </section>
      <section v-if="state.capabilities.goal" class="space-y-2">
        <form
          v-if="canGoal('set')"
          class="flex items-end gap-2"
          @submit.prevent="
            perform(async () => {
              await client.controlGoal(sessionId, 'set', objective)
              objective = ''
            })
          "
        >
          <label class="flex-1"
            >{{ label('goal')
            }}<textarea
              v-model="objective"
              required
              maxlength="65536"
              class="mt-1 w-full rounded border bg-background p-2"
              :placeholder="label('goalObjective')"
            /></label
          ><button type="submit" :disabled="busy || !objective.trim()" class="underline">
            {{ label('setGoal') }}
          </button>
        </form>
        <div v-if="state.goal" class="flex gap-3">
          <button
            v-if="canGoal('pause') && state.goal.status === 'active'"
            type="button"
            :disabled="busy"
            class="underline"
            @click="perform(() => client.controlGoal(sessionId, 'pause'))"
          >
            {{ label('pause') }}</button
          ><button
            v-if="canGoal('resume') && state.goal.status !== 'active'"
            type="button"
            :disabled="busy"
            class="underline"
            @click="perform(() => client.controlGoal(sessionId, 'resume'))"
          >
            {{ label('resume') }}</button
          ><button
            v-if="canGoal('clear')"
            type="button"
            :disabled="busy"
            class="underline"
            @click="perform(() => client.controlGoal(sessionId, 'clear'))"
          >
            {{ label('clear') }}
          </button>
        </div>
      </section>
      <section v-if="state.goal" class="space-y-1">
        <h3 class="font-medium">{{ label('goal') }} · {{ label(state.goal.status) }}</h3>
        <p>{{ state.goal.objective }}</p>
        <p class="text-xs text-muted-foreground">
          {{ label('tokens') }} {{ number(state.goal.tokensUsed) }} /
          {{ number(state.goal.tokenBudget) }} · {{ label('iterations') }}
          {{ number(state.goal.iterations) }} · {{ number(state.goal.timeUsedSeconds) }} s
        </p>
        <p v-if="state.goal.lastReason">{{ state.goal.lastReason }}</p>
      </section>
      <section v-if="tasks.length || state.capabilities.subagents?.list" class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="font-medium">{{ label('tasks') }}</h3>
          <button
            v-if="state.connected && state.capabilities.subagents?.list"
            type="button"
            :disabled="busy"
            class="underline"
            @click="perform(() => client.listTasks(sessionId))"
          >
            {{ label('refresh') }}
          </button>
        </div>
        <p v-if="!tasks.length" class="text-muted-foreground">{{ label('noData') }}</p>
        <details v-for="task in unlinkedTasks" :key="task.id" class="border-t pt-2">
          <summary class="cursor-pointer">
            {{ task.description ?? task.id }} · {{ label(task.kind) }} · {{ label(task.status) }}
          </summary>
          <p v-if="task.parentTaskId" class="text-xs">
            {{ label('parentTask') }}: {{ task.parentTaskId }}
          </p>
          <p class="mt-1 whitespace-pre-wrap">{{ task.summary }}</p>
          <p v-if="task.usage" class="text-xs text-muted-foreground">
            {{ number(task.usage.totalTokens) }} {{ label('tokens') }} ·
            {{ number(task.usage.toolUses) }} {{ label('toolCalls') }} ·
            {{ number(task.usage.durationMs) }} ms
          </p>
          <div class="flex gap-3">
            <button
              v-if="canControl(task.id, 'output')"
              type="button"
              :disabled="busy"
              class="underline"
              @click="perform(() => controlTask(task.id, 'output'))"
            >
              {{ label('readOutput') }}</button
            ><button
              v-if="canControl(task.id, 'cancel')"
              type="button"
              :disabled="busy"
              class="underline"
              @click="perform(() => controlTask(task.id, 'cancel'))"
            >
              {{ label('cancelTask') }}
            </button>
          </div>
          <pre
            v-if="outputs[task.id]"
            class="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs"
            >{{ outputs[task.id] }}</pre
          >
        </details>
      </section>
      <section v-if="Object.keys(state.runs).length" class="space-y-2">
        <h3 class="font-medium">{{ label('subagentOutput') }}</h3>
        <details v-for="run in state.runs" :key="run.runId" class="border-t pt-2">
          <summary class="cursor-pointer">
            {{ run.snapshot?.name ?? run.runId }} · {{ label(run.snapshot?.state ?? 'unknown') }}
          </summary>
          <p>{{ run.snapshot?.description }}</p>
          <p v-if="run.snapshot?.parentRunId" class="text-xs">
            {{ label('parentRun') }}: {{ run.snapshot.parentRunId }}
          </p>
          <template v-if="linkedTask(run)">
            <p class="text-xs">
              {{ linkedTask(run)?.description }} · {{ label(linkedTask(run)!.status) }}
            </p>
            <p v-if="linkedTask(run)?.parentTaskId" class="text-xs">
              {{ label('parentTask') }}: {{ linkedTask(run)?.parentTaskId }}
            </p>
            <p>{{ linkedTask(run)?.summary }}</p>
            <div class="flex gap-3">
              <button
                v-if="canControl(run.taskId!, 'output')"
                type="button"
                :disabled="busy"
                class="underline"
                @click="perform(() => controlTask(run.taskId!, 'output'))"
              >
                {{ label('readOutput') }}
              </button>
              <button
                v-if="canControl(run.taskId!, 'cancel')"
                type="button"
                :disabled="busy"
                class="underline"
                @click="perform(() => controlTask(run.taskId!, 'cancel'))"
              >
                {{ label('cancelTask') }}
              </button>
            </div>
            <pre
              v-if="outputs[run.taskId!]"
              class="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs"
              >{{ outputs[run.taskId!] }}</pre
            >
          </template>
          <p class="text-xs text-muted-foreground">{{ run.snapshot?.modelId }}</p>
          <p>{{ run.progress?.summary ?? run.snapshot?.summary }}</p>
          <p v-if="run.progress" class="text-xs text-muted-foreground">
            {{ number(run.progress.totalTokens) }} {{ label('tokens') }} ·
            {{ number(run.progress.toolCallCount) }} {{ label('toolCalls') }} ·
            {{ number(run.progress.durationMs) }} ms · {{ run.progress.lastToolName }}
          </p>
          <p
            v-if="run.outputIncomplete || run.snapshot?.outputIncomplete"
            class="text-muted-foreground"
          >
            {{ label('incompleteOutput') }}
          </p>
          <p v-if="run.snapshot?.reason?.message">{{ run.snapshot.reason.message }}</p>
          <div v-for="(block, index) in blocks(run)" :key="block.id ?? index" class="my-2">
            <MessageBlockToolCall v-if="block.type === 'tool_call'" :block="block" read-only />
            <details v-else-if="block.type === 'reasoning_content'">
              <summary>{{ label('reasoning') }}</summary>
              <MarkdownRenderer
                :content="block.content ?? ''"
                mode="minimal"
                :smooth-streaming="false"
              />
            </details>
            <ul v-else-if="block.type === 'plan'">
              <li v-for="(entry, entryIndex) in block.extra?.plan_entries" :key="entryIndex">
                {{ label(entry.status ?? 'unknown') }} · {{ entry.step ?? entry.content }}
              </li>
            </ul>
            <MarkdownRenderer
              v-else-if="block.content"
              :content="block.content"
              mode="minimal"
              :smooth-streaming="false"
            />
          </div>
        </details>
      </section>
    </PopoverContent>
  </Popover>
</template>
