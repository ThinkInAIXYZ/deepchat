<template>
  <ItemGroup class="w-full space-y-3">
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Icon icon="lucide:palette" class="w-4 h-4" />
      </ItemMedia>
      <ItemContent>
        <ItemHeader>
          <ItemTitle>Brand refresh</ItemTitle>
          <ItemDescription>Update the marketing site with the new palette.</ItemDescription>
        </ItemHeader>
        <ItemFooter class="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1">
            <Icon icon="lucide:user" class="w-3 h-3" />
            Design team
          </span>
          <span class="inline-flex items-center gap-1">
            <Icon icon="lucide:calendar" class="w-3 h-3" />
            Due Friday
          </span>
        </ItemFooter>
      </ItemContent>
      <ItemActions class="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm">Preview</Button>
        <Button size="sm">Open</Button>
      </ItemActions>
    </Item>

    <Item variant="muted" size="sm">
      <ItemMedia variant="icon">
        <Icon icon="lucide:bell" class="w-4 h-4" />
      </ItemMedia>
      <ItemContent>
        <ItemHeader>
          <ItemTitle>Notifications paused</ItemTitle>
          <ItemDescription>You're in focus mode until 4:00 PM.</ItemDescription>
        </ItemHeader>
      </ItemContent>
    </Item>
  </ItemGroup>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { Button } from '@shadcn/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemTitle
} from '@shadcn/components/ui/item'
</script>
