<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="outline">Show popover</Button>
    </PopoverTrigger>
    <PopoverContent class="w-64">
      <div class="space-y-2">
        <h4 class="font-semibold leading-none tracking-tight">Saved searches</h4>
        <p class="text-sm text-muted-foreground">Quick access to the segments you visit most.</p>
      </div>
      <Separator class="my-2" />
      <div class="space-y-2">
        <Button variant="ghost" class="w-full justify-start">All customers</Button>
        <Button variant="ghost" class="w-full justify-start">VIP prospects</Button>
        <Button variant="ghost" class="w-full justify-start">Churn risk</Button>
      </div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { Popover, PopoverContent, PopoverTrigger } from '@shadcn/components/ui/popover'
import { Button } from '@shadcn/components/ui/button'
import { Separator } from '@shadcn/components/ui/separator'
</script>
