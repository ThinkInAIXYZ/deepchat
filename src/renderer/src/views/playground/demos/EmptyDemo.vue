<template>
  <Empty class="border border-dashed border-muted-foreground/40 bg-muted/20">
    <EmptyMedia>
      <Icon icon="lucide:inbox" class="w-10 h-10 text-muted-foreground" />
    </EmptyMedia>
    <EmptyHeader>
      <EmptyTitle>No conversations yet</EmptyTitle>
      <EmptyDescription>
        Start a new thread to keep track of customer questions and follow-ups.
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent class="flex flex-col sm:flex-row gap-2">
      <Button>New conversation</Button>
      <Button variant="outline">Import history</Button>
    </EmptyContent>
  </Empty>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@shadcn/components/ui/empty'
</script>
