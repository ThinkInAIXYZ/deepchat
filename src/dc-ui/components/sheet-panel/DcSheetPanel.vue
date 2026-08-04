<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@shadcn/components/ui/sheet'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { cn } from '@shadcn/lib/utils'

type DcSheetPanelAppearance = 'panel' | 'plain'

interface Props {
  open?: boolean
  title: string
  description?: string
  icon?: string
  appearance?: DcSheetPanelAppearance
  widthClass?: string
  scrollBody?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  appearance: 'panel'
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const isPlain = computed(() => props.appearance === 'plain')

const resolvedWidthClass = computed(
  () => props.widthClass ?? (isPlain.value ? 'sm:max-w-xl' : 'sm:w-[min(48rem,92vw)]')
)

const shouldScrollBody = computed(() => props.scrollBody ?? !isPlain.value)
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent v-if="isPlain" :class="cn('flex w-full flex-col', resolvedWidthClass)">
      <SheetHeader>
        <SheetTitle>{{ title }}</SheetTitle>
        <SheetDescription>{{ description }}</SheetDescription>
      </SheetHeader>

      <ScrollArea v-if="shouldScrollBody" class="flex-1 overflow-hidden">
        <slot />
      </ScrollArea>
      <slot v-else />

      <SheetFooter v-if="$slots.footer">
        <slot name="footer" />
      </SheetFooter>
    </SheetContent>

    <SheetContent
      v-else
      :class="
        cn(
          'flex h-screen w-full max-w-4xl flex-col border-l border-border bg-background p-0',
          resolvedWidthClass
        )
      "
    >
      <SheetHeader class="shrink-0 border-b border-border bg-background/80 px-5 py-4 backdrop-blur">
        <SheetTitle class="flex items-center gap-2">
          <Icon v-if="icon" :icon="icon" class="size-4 text-muted-foreground" />
          <span>{{ title }}</span>
        </SheetTitle>
        <SheetDescription v-if="description">{{ description }}</SheetDescription>
      </SheetHeader>

      <ScrollArea v-if="shouldScrollBody" class="flex-1 overflow-hidden">
        <slot />
      </ScrollArea>
      <slot v-else />

      <SheetFooter
        v-if="$slots.footer"
        class="shrink-0 border-t border-border bg-background/80 px-5 py-4 backdrop-blur"
      >
        <slot name="footer" />
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
