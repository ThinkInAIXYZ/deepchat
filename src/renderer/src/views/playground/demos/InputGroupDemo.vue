<template>
  <div class="space-y-4">
    <InputGroup>
      <InputGroupAddon>
        <Icon icon="lucide:search" class="w-4 h-4" />
        <InputGroupText>Search docs</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput placeholder="Ask anything..." />
      <InputGroupButton size="icon-sm" variant="ghost">
        <Icon icon="lucide:command" class="w-4 h-4" />
      </InputGroupButton>
    </InputGroup>

    <InputGroup class="w-full">
      <InputGroupAddon align="block-start" class="border-b">
        <InputGroupText class="font-medium text-foreground">Invite message</InputGroupText>
        <InputGroupText class="text-xs text-muted-foreground">Shared with the team</InputGroupText>
      </InputGroupAddon>
      <InputGroupTextarea rows="3" placeholder="Hi team! Here's what changed in this release..." />
      <InputGroupAddon align="block-end" class="border-t justify-between">
        <InputGroupText class="text-xs text-muted-foreground">Markdown supported</InputGroupText>
        <InputGroupButton size="xs" variant="outline">Send</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea
} from '@shadcn/components/ui/input-group'
</script>
