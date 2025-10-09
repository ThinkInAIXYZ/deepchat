<template>
  <div class="space-y-4">
    <ButtonGroup class="w-full">
      <Button variant="ghost" size="sm" class="flex-1">Day</Button>
      <Button size="sm" class="flex-1">Week</Button>
      <ButtonGroupSeparator />
      <Button variant="ghost" size="sm" class="flex-1">Month</Button>
      <Button variant="ghost" size="sm" class="flex-1">Year</Button>
    </ButtonGroup>

    <ButtonGroup orientation="vertical" class="w-full">
      <ButtonGroupText class="justify-between">
        <span class="text-xs uppercase tracking-wide text-muted-foreground">Team access</span>
        <span class="text-xs text-muted-foreground">4 members</span>
      </ButtonGroupText>
      <Button variant="ghost" class="justify-between">
        <span>Marketing</span>
        <span class="text-xs text-muted-foreground">Owner</span>
      </Button>
      <Button variant="ghost" class="justify-between">
        <span>Engineering</span>
        <span class="text-xs text-muted-foreground">Can edit</span>
      </Button>
      <Button variant="ghost" class="justify-between">
        <span>Support</span>
        <span class="text-xs text-muted-foreground">Can view</span>
      </Button>
    </ButtonGroup>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@shadcn/components/ui/button'
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText
} from '@shadcn/components/ui/button-group'
</script>
