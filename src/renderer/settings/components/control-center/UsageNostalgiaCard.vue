<template>
  <Card
    data-testid="summary-card-nostalgia"
    class="flex h-full flex-col overflow-hidden border-border/70 bg-card/90 backdrop-blur-sm"
  >
    <CardHeader class="space-y-1 pb-1">
      <CardTitle class="wrap-break-word whitespace-normal text-base leading-tight">
        {{ t('settings.dashboard.summary.nostalgiaLabel') }}
      </CardTitle>
    </CardHeader>
    <CardContent
      v-if="nostalgiaCard"
      class="flex flex-1 flex-col gap-3 pt-0 lg:grid lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:items-start lg:gap-4 xl:flex xl:flex-col"
    >
      <div class="flex min-h-18 items-start sm:min-h-20">
        <Transition name="nostalgia-fade" mode="out-in">
          <CardTitle
            :key="activeNostalgiaStat?.id ?? 'unavailable'"
            data-testid="nostalgia-rotating-value"
            class="wrap-break-word whitespace-normal text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
          >
            {{ activeNostalgiaStat?.value ?? t('settings.dashboard.unavailable') }}
          </CardTitle>
        </Transition>
      </div>

      <div data-testid="nostalgia-details" class="space-y-2 lg:pt-0.5">
        <div
          v-for="item in nostalgiaCard.details"
          :key="item.id"
          :data-testid="`nostalgia-detail-${item.id}`"
          class="rounded-lg border border-border/30 bg-muted/5 px-3 py-2.5"
        >
          <p class="wrap-break-word whitespace-normal text-sm leading-6">
            {{ item.content }}
          </p>
        </div>
      </div>
    </CardContent>
    <CardContent v-else-if="isPending" class="flex flex-1 flex-col justify-center gap-4 pt-0">
      <div class="h-9 w-32 animate-pulse rounded-md bg-muted"></div>
      <div class="space-y-2">
        <div class="h-9 animate-pulse rounded-lg bg-muted/70"></div>
        <div class="h-9 animate-pulse rounded-lg bg-muted/50"></div>
        <div class="h-9 animate-pulse rounded-lg bg-muted/30"></div>
      </div>
    </CardContent>
    <CardContent v-else class="flex flex-1 flex-col justify-center gap-3 pt-0">
      <CardTitle
        data-testid="nostalgia-rotating-value"
        class="wrap-break-word whitespace-normal text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
      >
        {{ t('settings.dashboard.unavailable') }}
      </CardTitle>
      <p class="text-sm leading-6 text-muted-foreground">
        {{ t('settings.dashboard.empty.description') }}
      </p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Card, CardContent, CardHeader, CardTitle } from '@shadcn/components/ui/card'
import type { UsageDashboardData } from '@shared/types/agent-interface'

type NostalgiaRotatingStat = {
  id: 'days' | 'sessions' | 'messages'
  value: string
}
type NostalgiaDetailItem = {
  id: 'days' | 'sessions' | 'messages' | 'most-active-day'
  content: string
}

const props = defineProps<{
  dashboard: UsageDashboardData | null
}>()

const { t, locale } = useI18n()
const nostalgiaStatIndex = ref(0)
let nostalgiaRotationTimer: number | null = null

const MS_PER_DAY = 24 * 60 * 60 * 1000
const NOSTALGIA_ROTATION_INTERVAL = 4000

const isPending = computed(() => !props.dashboard)

const nostalgiaCard = computed(() => {
  if (!props.dashboard || props.dashboard.summary.messageCount <= 0) {
    return null
  }

  const days = getDaysWithDeepChat(props.dashboard.recordingStartedAt)
  const summary = props.dashboard.summary
  const formattedDays = days === null ? t('settings.dashboard.unavailable') : formatCount(days)
  const formattedSessions = formatCount(summary.sessionCount)
  const formattedMessages = formatCount(summary.messageCount)
  const mostActiveDayText = summary.mostActiveDay.date
    ? t('settings.dashboard.summary.nostalgiaMostActiveDayDetail', {
        date: formatDateKey(summary.mostActiveDay.date),
        count: formatCount(summary.mostActiveDay.messageCount)
      })
    : t('settings.dashboard.unavailable')
  const rotatingStats = [
    days === null
      ? null
      : ({
          id: 'days',
          value: t('settings.dashboard.summary.nostalgiaDaysValue', {
            days: formattedDays
          })
        } satisfies NostalgiaRotatingStat),
    {
      id: 'sessions',
      value: t('settings.dashboard.summary.nostalgiaSessionsValue', {
        count: formattedSessions
      })
    } satisfies NostalgiaRotatingStat,
    {
      id: 'messages',
      value: t('settings.dashboard.summary.nostalgiaMessagesValue', {
        count: formattedMessages
      })
    } satisfies NostalgiaRotatingStat
  ].filter((item): item is NostalgiaRotatingStat => item !== null)

  return {
    rotatingStats,
    details: [
      {
        id: 'days',
        content:
          days === null
            ? t('settings.dashboard.unavailable')
            : t('settings.dashboard.summary.nostalgiaDaysDetail', {
                days: formattedDays
              })
      },
      {
        id: 'sessions',
        content: t('settings.dashboard.summary.nostalgiaSessionsDetail', {
          count: formattedSessions
        })
      },
      {
        id: 'messages',
        content: t('settings.dashboard.summary.nostalgiaMessagesDetail', {
          count: formattedMessages
        })
      },
      {
        id: 'most-active-day',
        content: mostActiveDayText
      }
    ] satisfies NostalgiaDetailItem[]
  }
})

const activeNostalgiaStat = computed<NostalgiaRotatingStat | null>(() => {
  const stats = nostalgiaCard.value?.rotatingStats ?? []
  if (stats.length === 0) {
    return null
  }

  return stats[nostalgiaStatIndex.value % stats.length]
})

watch(() => nostalgiaCard.value?.rotatingStats.length ?? 0, syncNostalgiaRotation, {
  immediate: true
})

onBeforeUnmount(() => {
  clearNostalgiaRotation()
})

function syncNostalgiaRotation(): void {
  const statCount = nostalgiaCard.value?.rotatingStats.length ?? 0

  if (statCount > 1) {
    nostalgiaStatIndex.value %= statCount

    if (nostalgiaRotationTimer === null) {
      nostalgiaRotationTimer = window.setInterval(() => {
        const currentCount = nostalgiaCard.value?.rotatingStats.length ?? 0
        if (currentCount > 1) {
          nostalgiaStatIndex.value = (nostalgiaStatIndex.value + 1) % currentCount
        }
      }, NOSTALGIA_ROTATION_INTERVAL)
    }

    return
  }

  clearNostalgiaRotation()
  nostalgiaStatIndex.value = 0
}

function clearNostalgiaRotation(): void {
  if (nostalgiaRotationTimer !== null) {
    window.clearInterval(nostalgiaRotationTimer)
    nostalgiaRotationTimer = null
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value)
}

function formatDateKey(dateKey: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(
    new Date(`${dateKey}T00:00:00`)
  )
}

function getDaysWithDeepChat(value: number | null): number | null {
  if (value === null) {
    return null
  }

  const startedAt = new Date(value)
  const today = new Date()
  const startedAtDay = new Date(startedAt.getFullYear(), startedAt.getMonth(), startedAt.getDate())
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diffDays = Math.floor((todayDay.getTime() - startedAtDay.getTime()) / MS_PER_DAY) + 1

  return Math.max(1, diffDays)
}
</script>

<style scoped>
.nostalgia-fade-enter-active,
.nostalgia-fade-leave-active {
  transition: opacity 220ms ease;
}

.nostalgia-fade-enter-from,
.nostalgia-fade-leave-to {
  opacity: 0;
}
</style>
